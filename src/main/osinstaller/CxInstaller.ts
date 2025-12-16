import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import * as unzipper from 'unzipper';
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
    private readonly resourceDirPath: string;
    private readonly installedCLIVersionFileName = 'cli-version';
    private readonly cliDefaultVersion = '2.3.41'; // Update this with the latest version.
    private readonly client: AstClient;

    private static readonly PLATFORMS: Record<SupportedPlatforms, PlatformData> = {
        win32: { platform: 'windows', extension: 'zip' },
        darwin: { platform: macOS, extension: 'tar.gz' },
        linux: { platform: linuxOS, extension: 'tar.gz' }
    };

    constructor(platform: string, client: AstClient) {
        this.platform = platform as SupportedPlatforms;
        this.resourceDirPath = path.join(__dirname, '../wrapper/resources');
        this.client = client;
    }

    async getDownloadURL(): Promise<string> {
        const cliVersion = await this.readASTCLIVersion();
        const platformData = CxInstaller.PLATFORMS[this.platform];

        if (!platformData) {
            throw new CxError('Unsupported platform or architecture');
        }

        const architecture = this.getArchitecture();

        const envVar = process.env.CX_CLI_LOCATION;
        if (envVar !== undefined) {
            return `${envVar}/ast-cli_${cliVersion}_${platformData.platform}_${architecture}.${platformData.extension}`;
        }

        return `https://download.checkmarx.com/CxOne/CLI/${cliVersion}/ast-cli_${cliVersion}_${platformData.platform}_${architecture}.${platformData.extension}`;
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
            const cliVersion = await this.readASTCLIVersion();

            if (this.checkExecutableExists()) {
                const installedVersion = await this.readInstalledVersionFile(this.resourceDirPath);
                if (installedVersion === cliVersion) {
                    logger.info('Executable already installed.');
                    return;
                }
            }

            await this.cleanDirectoryContents(this.resourceDirPath);
            const url = await this.getDownloadURL();
            const zipPath = path.join(this.resourceDirPath, this.getCompressFolderName());

            await this.client.downloadFile(url, zipPath);

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

    async readASTCLIVersion(): Promise<string> {
        if (this.cliVersion) {
            return this.cliVersion;
        }
        try {
            const versionFilePath = this.getVersionFilePath();
            const versionContent = await fsPromises.readFile(versionFilePath, 'utf-8');
            return versionContent.trim();
        } catch (error) {
            logger.warn('Error reading AST CLI version: ' + error.message);
            return this.cliDefaultVersion;
        }
    }

    private getVersionFilePath(): string {
        return path.join(__dirname, '../../../checkmarx-ast-cli.version');
    }

    private getCompressFolderName(): string {
        return `ast-cli.${this.platform === winOS ? 'zip' : 'tar.gz'}`;
    }
    
    public getPlatform(): SupportedPlatforms {
        return this.platform;
    }
}
