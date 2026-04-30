import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import * as unzipper from 'unzipper';
import * as crypto from 'crypto';
import {logger} from "../wrapper/loggerConfig";
import {AstClient} from "../client/AstClient";
import {CxError} from "../errors/CxError";

const linuxOS = 'linux';
const macOS = 'darwin';
const winOS = 'win32';
type SupportedPlatforms = 'win32' | 'darwin' | 'linux';

interface PlatformData {
    platform: string;
    extension: string;
}

export class CxInstaller {
    private readonly platform: SupportedPlatforms;
    private cliVersion: string;
    private cliChecksum: string | null;
    private readonly resourceDirPath: string;
    private readonly installedCLIVersionFileName = 'cli-version';
    private readonly client: AstClient;

    private static readonly PLATFORMS: Record<SupportedPlatforms, PlatformData> = {
        win32: { platform: 'windows', extension: 'zip' },
        darwin: { platform: macOS, extension: 'tar.gz' },
        linux: { platform: linuxOS, extension: 'tar.gz' }
    };

    // Default version and its paired SHA-256 checksums, keyed by "platform_architecture".
    // Update both together when bumping the default CLI version.
    private readonly cliDefaultVersion = '2.3.48';
    private static readonly cliDefaultChecksums: Record<string, string> = {
        'windows_x64': '441ee8df46cc630ae000f8ba73925113aeed8c4d16cf274944aff3e7197e3470',
        'darwin_x64':  'b72f7e4ca14e5e56600b07d22c848a4b85e7c37d2e595424340cc699ea10006b',
        'linux_x64':   'eb3eb55add37f150188f5a8b36b2a659f902ad9569dcb7ee652531fe525022e2',
        'linux_arm64': '7df61689b3c2bbd4c27face5bdc0da97f63e4533229d6b53dd777f90d3904931',
        'linux_armv6': '99659f2e0804b197550efc6a9ddb6029babc980d32bdfeeb508199247ac95878'
    };

    constructor(platform: string, client: AstClient) {
        this.platform = platform as SupportedPlatforms;
        this.resourceDirPath = path.join(__dirname, '../wrapper/resources');
        this.client = client;
    }

    // Returns the CLI version and its platform-specific SHA-256 checksum.
    // Tries the version file and checksums file first; falls back to the
    // hardcoded defaults if the version file is absent or empty.
    // Result is cached after the first read.
    async readASTCLIVersion(): Promise<{ version: string; checksum: string | null }> {
        if (this.cliVersion) {
            return { version: this.cliVersion, checksum: this.cliChecksum };
        }

        const platformData = CxInstaller.PLATFORMS[this.platform];
        const architecture = this.getArchitecture();
        const key = `${platformData.platform}_${architecture}`;

        let version: string | null = null;
        try {
            const content = await fsPromises.readFile(this.getVersionFilePath(), 'utf-8');
            const trimmed = content.trim();
            if (trimmed) version = trimmed;
        } catch {
            // version file absent — fall through to defaults
        }

        let checksum: string | null;
        if (version === null) {
            version = this.cliDefaultVersion;
            checksum = CxInstaller.cliDefaultChecksums[key] ?? null;
        } else {
            try {
                const content = await fsPromises.readFile(this.getChecksumsFilePath(), 'utf-8');
                checksum = (JSON.parse(content) as Record<string, string>)[key] ?? null;
                if (checksum === null) {
                    logger.warn(`No checksum found for ${key} in checksums file. Download will not be verified.`);
                }
            } catch {
                logger.warn(`Checksums file not found. Download of version ${version} will not be verified.`);
                checksum = null;
            }
        }

        this.cliVersion = version;
        this.cliChecksum = checksum;
        return { version, checksum };
    }

    async getDownloadURL(): Promise<{ url: string; checksum: string | null }> {
        const { version, checksum } = await this.readASTCLIVersion();
        const platformData = CxInstaller.PLATFORMS[this.platform];

        if (!platformData) {
            throw new CxError('Unsupported platform or architecture');
        }

        const architecture = this.getArchitecture();

        const envVar = process.env.CX_CLI_LOCATION;
        if (envVar !== undefined) {
            return {
                url: `${envVar}/ast-cli_${version}_${platformData.platform}_${architecture}.${platformData.extension}`,
                checksum: null
            };
        }

        return {
            url: `https://download.checkmarx.com/CxOne/CLI/${version}/ast-cli_${version}_${platformData.platform}_${architecture}.${platformData.extension}`,
            checksum
        };
    }

    private getArchitecture(): string {
        // For non-linux platforms we default to x64.
        if (this.platform !== linuxOS) {
            return 'x64';
        }

        const archMap: Record<string, string> = {
            'arm64': 'arm64',
            'arm': 'armv6'
        };

        // Default to 'x64' if the current architecture is not found in the map.
        return archMap[process.arch] || 'x64';
    }

    public getExecutablePath(): string {
        const executableName = this.platform === winOS ? 'cx.exe' : 'cx';
        return path.join(this.resourceDirPath, executableName);
    }

    public async downloadIfNotInstalledCLI(): Promise<void> {
        try {
            await fs.promises.mkdir(this.resourceDirPath, {recursive: true});
            const { version: cliVersion } = await this.readASTCLIVersion();

            if (this.checkExecutableExists()) {
                const installedVersion = await this.readInstalledVersionFile(this.resourceDirPath);
                if (installedVersion === cliVersion) {
                    logger.info('Executable already installed.');
                    return;
                }
            }

            await this.cleanDirectoryContents(this.resourceDirPath);
            const { url, checksum } = await this.getDownloadURL();
            const zipPath = path.join(this.resourceDirPath, this.getCompressFolderName());

            await this.client.downloadFile(url, zipPath);

            if (checksum) {
                await this.verifyChecksum(zipPath, checksum);
            }

            await this.extractArchive(zipPath, this.resourceDirPath);
            await this.saveVersionFile(this.resourceDirPath, cliVersion);

            fs.unlink(zipPath, (err) => {
                if (err) {
                    logger.warn('Error deleting the file:', err);
                } else {
                    logger.info(`File ${zipPath} deleted.`);
                }
            });

            fs.chmodSync(this.getExecutablePath(), 0o755);
            logger.info('Extracted CLI to:', this.resourceDirPath);
        } catch (error) {
            logger.error('Error during installation:', error);
            if (error instanceof CxError) {
                process.exit(1);
            }
        }
    }

    private async cleanDirectoryContents(directoryPath: string): Promise<void> {
        try {
            const files = await fsPromises.readdir(directoryPath);

            await Promise.all(files.map(async (file) => {
                const filePath = path.join(directoryPath, file);
                const fileStat = await fsPromises.stat(filePath);

                if (fileStat.isDirectory()) {
                    await fsPromises.rm(filePath, {recursive: true, force: true});
                    logger.info(`Directory ${filePath} deleted.`);
                } else {
                    await fsPromises.unlink(filePath);
                    logger.info(`File ${filePath} deleted.`);
                }
            }));

            logger.info(`All contents in ${directoryPath} have been cleaned.`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info(`Directory at ${directoryPath} does not exist.`);
            } else {
                logger.error(`Failed to clean directory contents: ${error.message}`);
            }
        }
    }

    private async extractArchive(zipPath: string, extractPath: string): Promise<void> {
        if (zipPath.endsWith('.zip')) {
            await unzipper.Open.file(zipPath)
                .then(d => d.extract({path: extractPath}));
        } else if (zipPath.endsWith('.tar.gz')) {
            await tar.extract({file: zipPath, cwd: extractPath});
        } else {
            logger.error('Unsupported file type. Only .zip and .tar.gz are supported.');
        }
    }

    private async saveVersionFile(resourcePath: string, version: string): Promise<void> {
        const versionFilePath = path.join(resourcePath, this.installedCLIVersionFileName);
        try {
            await fsPromises.writeFile(versionFilePath, `${version}`, 'utf8');
            logger.info(`Version file created at ${versionFilePath} with version ${version}`);
        } catch (error) {
            logger.error(`Failed to create version file: ${error.message}`);
        }
    }

    private async readInstalledVersionFile(resourcePath: string): Promise<string | null> {
        const versionFilePath = path.join(resourcePath, this.installedCLIVersionFileName);
        try {
            const content = await fsPromises.readFile(versionFilePath, 'utf8');
            logger.info(`Version file content: ${content}`);
            return content;
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn(`Version file not found at ${versionFilePath}.`);
            } else {
                logger.error(`Failed to read version file: ${error.message}`);
            }
            return null;
        }
    }

    public checkExecutableExists(): boolean {
        return fs.existsSync(this.getExecutablePath());
    }

    private getVersionFilePath(): string {
        return path.join(__dirname, '../../../checkmarx-ast-cli.version');
    }

    private getChecksumsFilePath(): string {
        return path.join(__dirname, '../../../checkmarx-ast-cli.checksums');
    }

    private getCompressFolderName(): string {
        return `ast-cli.${this.platform === winOS ? 'zip' : 'tar.gz'}`;
    }

    private async verifyChecksum(zipPath: string, expected: string): Promise<void> {
        const actual = await this.computeSHA256(zipPath);
        if (actual !== expected) {
            throw new CxError(`Checksum mismatch for ${path.basename(zipPath)}: expected ${expected}, got ${actual}`);
        }
        logger.info(`Checksum verified for ${path.basename(zipPath)}.`);
    }

    private computeSHA256(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            fs.createReadStream(filePath)
                .on('data', chunk => hash.update(chunk))
                .on('end', () => resolve(hash.digest('hex')))
                .on('error', reject);
        });
    }

    public getPlatform(): SupportedPlatforms {
        return this.platform;
    }
}
