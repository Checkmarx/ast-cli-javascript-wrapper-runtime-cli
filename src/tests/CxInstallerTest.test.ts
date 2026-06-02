import { CxInstaller } from "../main/osinstaller/CxInstaller";
import { anyString, mock, instance, when, verify } from "ts-mockito";
import { AstClient } from "../main/client/AstClient";
import * as fs from "fs";
import * as crypto from "crypto";
import * as path from "path";

// Mock AstClient and set up an instance from it
const astClientMock = mock(AstClient);
const astClientInstance = instance(astClientMock);

// Create CxInstaller instances with the mocked AstClient
const cxInstallerLinux = new CxInstaller("linux", astClientInstance);
const cxInstallerMac = new CxInstaller("darwin", astClientInstance);
const cxInstallerWindows = new CxInstaller("win32", astClientInstance);

describe("CxInstaller cases", () => {
    it('CxInstaller getDownloadURL Linux Successful case', async () => {
        const testVersion = '2.3.48';
        jest.spyOn(cxInstallerLinux as any, 'readASTCLIVersion').mockResolvedValue({ version: testVersion, checksum: 'mock-checksum' });
        const { url } = await cxInstallerLinux.getDownloadURL();
        const architecture = getArchitecture(cxInstallerLinux.getPlatform());
        expect(url).toBe(`https://download.checkmarx.com/CxOne/CLI/${testVersion}/ast-cli_${testVersion}_linux_${architecture}.tar.gz`);
    });

    it('CxInstaller getDownloadURL Mac Successful case', async () => {
        const testVersion = '2.3.48';
        jest.spyOn(cxInstallerMac as any, 'readASTCLIVersion').mockResolvedValue({ version: testVersion, checksum: 'mock-checksum' });
        const { url } = await cxInstallerMac.getDownloadURL();
        const architecture = getArchitecture(cxInstallerMac.getPlatform());
        expect(url).toBe(`https://download.checkmarx.com/CxOne/CLI/${testVersion}/ast-cli_${testVersion}_darwin_${architecture}.tar.gz`);
    });

    it('CxInstaller getDownloadURL Windows Successful case', async () => {
        const testVersion = '2.3.48';
        jest.spyOn(cxInstallerWindows as any, 'readASTCLIVersion').mockResolvedValue({ version: testVersion, checksum: 'mock-checksum' });
        const { url } = await cxInstallerWindows.getDownloadURL();
        const architecture = getArchitecture(cxInstallerWindows.getPlatform());
        expect(url).toBe(`https://download.checkmarx.com/CxOne/CLI/${testVersion}/ast-cli_${testVersion}_windows_${architecture}.zip`);
    });
});

describe("CxInstaller getExecutablePath cases", () => {
    it('CxInstaller getExecutablePath Linux Successful case', () => {
        const executablePath = cxInstallerLinux.getExecutablePath();
        expect(executablePath).toContain(path.join('src', 'main', 'wrapper', 'resources', 'cx'));
    });

    it('CxInstaller getExecutablePath Mac Successful case', () => {
        const executablePath = cxInstallerMac.getExecutablePath();
        expect(executablePath).toContain(path.join('src', 'main', 'wrapper', 'resources', 'cx'));
    });

    it('CxInstaller getExecutablePath Windows Successful case', () => {
        const executablePath = cxInstallerWindows.getExecutablePath();
        expect(executablePath).toContain(path.join('src', 'main', 'wrapper', 'resources', 'cx.exe'));
    });
});

describe("CxInstaller checkExecutableExists cases", () => {
    beforeAll(async () => {
        when(astClientMock.downloadFile(anyString(), anyString())).thenResolve(); // Set up mock behavior here
        await cxInstallerWindows.downloadIfNotInstalledCLI();
    });

    it('CxInstaller checkExecutableExists Windows Successful case', () => {
        verify(astClientMock.downloadFile(anyString(), anyString())).called();
    });
});

describe("CxInstaller checksum verification cases", () => {
    let localMock: AstClient;
    let localInstance: AstClient;
    let localLinux: CxInstaller;
    let localMac: CxInstaller;
    let exitSpy: jest.SpyInstance;

    beforeEach(() => {
        localMock = mock(AstClient);
        localInstance = instance(localMock);
        localLinux = new CxInstaller('linux', localInstance);
        localMac = new CxInstaller('darwin', localInstance);
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    });

    afterEach(() => {
        exitSpy.mockRestore();
        delete process.env.CX_CLI_LOCATION;
    });

    it('CxInstaller checksum match does not call process.exit (linux)', async () => {
        const content = Buffer.from('test-binary-linux');
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        jest.spyOn(localLinux as any, 'readASTCLIVersion').mockResolvedValue({ version: '2.3.48', checksum: hash });
        when(localMock.downloadFile(anyString(), anyString())).thenCall((_url: string, dest: string) => {
            fs.writeFileSync(dest, content);
            return Promise.resolve();
        });
        await localLinux.downloadIfNotInstalledCLI();
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('CxInstaller checksum mismatch calls process.exit(1) (linux)', async () => {
        jest.spyOn(localLinux as any, 'readASTCLIVersion').mockResolvedValue({ version: '2.3.48', checksum: 'deadbeef'.repeat(8) });
        when(localMock.downloadFile(anyString(), anyString())).thenCall((_url: string, dest: string) => {
            fs.writeFileSync(dest, Buffer.from('tampered'));
            return Promise.resolve();
        });
        await localLinux.downloadIfNotInstalledCLI();
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('CxInstaller checksum match does not call process.exit (darwin)', async () => {
        const content = Buffer.from('test-binary-darwin');
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        jest.spyOn(localMac as any, 'readASTCLIVersion').mockResolvedValue({ version: '2.3.48', checksum: hash });
        when(localMock.downloadFile(anyString(), anyString())).thenCall((_url: string, dest: string) => {
            fs.writeFileSync(dest, content);
            return Promise.resolve();
        });
        await localMac.downloadIfNotInstalledCLI();
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('CxInstaller checksum match does not call process.exit for custom version', async () => {
        const content = Buffer.from('test-binary-custom-version');
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        jest.spyOn(localLinux as any, 'readASTCLIVersion').mockResolvedValue({ version: '9.9.99', checksum: hash });
        when(localMock.downloadFile(anyString(), anyString())).thenCall((_url: string, dest: string) => {
            fs.writeFileSync(dest, content);
            return Promise.resolve();
        });
        await localLinux.downloadIfNotInstalledCLI();
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('CxInstaller checksum mismatch calls process.exit(1) for custom version', async () => {
        jest.spyOn(localLinux as any, 'readASTCLIVersion').mockResolvedValue({ version: '9.9.99', checksum: 'deadbeef'.repeat(8) });
        when(localMock.downloadFile(anyString(), anyString())).thenCall((_url: string, dest: string) => {
            fs.writeFileSync(dest, Buffer.from('tampered'));
            return Promise.resolve();
        });
        await localLinux.downloadIfNotInstalledCLI();
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('CxInstaller CX_CLI_LOCATION skips checksum verification', async () => {
        process.env.CX_CLI_LOCATION = 'https://internal.example.com/cli';
        jest.spyOn(localLinux as any, 'readASTCLIVersion').mockResolvedValue({ version: '2.3.48', checksum: 'irrelevant' });
        when(localMock.downloadFile(anyString(), anyString())).thenResolve();
        await localLinux.downloadIfNotInstalledCLI();
        expect(exitSpy).not.toHaveBeenCalled();
    });
});

function getArchitecture(platform: string): string {
    if (platform !== 'linux') {
        return 'x64';
    }

    const archMap: Record<string, string> = {
        'arm64': 'arm64',
        'arm': 'armv6'
    };

    return archMap[process.arch] || 'x64';
}
