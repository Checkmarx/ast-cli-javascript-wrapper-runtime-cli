import {CxConfig} from "./CxConfig";
import {CxParamType} from "./CxParamType";
import {CxConstants} from "./CxConstants";
import {ExecutionService} from "./ExecutionService";
import {CxCommandOutput} from "./CxCommandOutput";
import {getLoggerWithFilePath, logger} from "./loggerConfig";
import * as os from "os";
import CxBFL from "../bfl/CxBFL";
import {CxInstaller} from "../osinstaller/CxInstaller";
import {Semaphore} from "async-mutex";
import {AstClient} from "../client/AstClient";


type ParamTypeMap = Map<CxParamType, string>;

export class CxWrapper {
    private static instances =new Map<string, CxWrapper>(); // Multiton pattern
    private static semaphore = new Semaphore(1);  // Semaphore with 1 slot
    config: CxConfig;
    cxInstaller: CxInstaller;
    private constructor(cxScanConfig: CxConfig, logFilePath?: string) {
        this.cxInstaller = new CxInstaller(process.platform, new AstClient());
        this.config = new CxConfig();
        getLoggerWithFilePath(logFilePath)
        if (cxScanConfig.apiKey) {
            this.config.apiKey = cxScanConfig.apiKey;
        } else if (cxScanConfig.clientId && cxScanConfig.clientSecret) {
            logger.info("Received clientId and clientSecret");
            this.config.clientId = cxScanConfig.clientId;
            this.config.clientSecret = cxScanConfig.clientSecret;
        } else {
            logger.info("Did not receive ClientId/Secret or ApiKey from cli arguments");
        }
        if (cxScanConfig.pathToExecutable) {
            this.config.pathToExecutable = cxScanConfig.pathToExecutable;
        } else {
            this.config.pathToExecutable = this.cxInstaller.getExecutablePath();
        }
        if (cxScanConfig.baseUri) {
            this.config.baseUri = cxScanConfig.baseUri;
        }
        if (cxScanConfig.baseAuthUri) {
            this.config.baseAuthUri = cxScanConfig.baseAuthUri;
        }
        if (cxScanConfig.tenant) {
            this.config.tenant = cxScanConfig.tenant;
        }
        if (cxScanConfig.additionalParameters) {
            this.config.additionalParameters = cxScanConfig.additionalParameters;
        }
    }

    static async getInstance(cxScanConfig: CxConfig, logFilePath: string): Promise<CxWrapper> {
        const [, release] = await this.semaphore.acquire();
        const key = this.generateKey(cxScanConfig, logFilePath);
        let wrapper = CxWrapper.instances.get(key);
        if (!wrapper) {
            wrapper = new CxWrapper(cxScanConfig, logFilePath);
            CxWrapper.instances.set(key, wrapper);
        }
        release();

        return wrapper;
    }
    
    static generateKey(config:CxConfig,logFilePath:string): string {
        return `${config.baseUri}${config.baseAuthUri}${config.clientId}${config.clientSecret}${config.apiKey}${config.tenant}${config.additionalParameters}${config.pathToExecutable}${logFilePath}`.toLowerCase();
    }

    async init(): Promise<void> {
        return await this.cxInstaller.downloadIfNotInstalledCLI();
    }
    
    public cloneWithNewConfig(scanConfig: CxConfig): CxWrapper {
        return new CxWrapper(scanConfig);
    }

    initializeCommands(formatRequired: boolean): string[] {
        this.config.pathToExecutable = this.cxInstaller.getExecutablePath();

        const list: string[] = [];
        if (this.config.clientId) {
            list.push(CxConstants.CLIENT_ID);
            list.push(this.config.clientId);
        }
        if (this.config.clientSecret) {
            list.push(CxConstants.CLIENT_SECRET);
            list.push(this.config.clientSecret);
        }
        if (this.config.apiKey) {
            list.push(CxConstants.API_KEY);
            list.push(this.config.apiKey);
        }
        if (this.config.baseUri) {
            list.push(CxConstants.BASE_URI);
            list.push(this.config.baseUri);
        }
        if (this.config.baseAuthUri) {
            list.push(CxConstants.BASE_AUTH_URI);
            list.push(this.config.baseAuthUri);
        }
        if (this.config.tenant) {
            list.push(CxConstants.TENANT);
            list.push(this.config.tenant);
        }
        if (this.config.additionalParameters) {
            this.prepareAdditionalParams(this.config.additionalParameters).forEach(function (param) {
                list.push(param)
            })
        }
        if (formatRequired) {
            list.push(CxConstants.FORMAT);
            list.push(CxConstants.FORMAT_JSON);
        }
        return list;
    }

    async authValidate(): Promise<CxCommandOutput> {
        const commands: string[] = [CxConstants.CMD_AUTH, CxConstants.SUB_CMD_VALIDATE];
        commands.push(...this.initializeCommands(false));
        const exec = new ExecutionService();
        return await exec.executeCommands(this.config.pathToExecutable, commands);
    }

    async scanCreate(params: ParamTypeMap): Promise<CxCommandOutput> {
        const commands: string[] = [CxConstants.CMD_SCAN, CxConstants.SUB_CMD_CREATE];
        commands.push(...this.initializeCommands(false));
        commands.push(CxConstants.SCAN_INFO_FORMAT);
        commands.push(CxConstants.FORMAT_JSON);

        params.forEach((value: string, key: CxParamType) => {
            if (key !== CxParamType.ADDITIONAL_PARAMETERS && key.length !== 1 && value) {
                commands.push("--" + key.toString().replace(/_/g, "-").toLowerCase());
                commands.push(value);
            } else if (key.length === 1 && value) {
                commands.push("-" + key.toString().replace(/_/g, "-").toLowerCase());
                commands.push(value);
            } else if (key === CxParamType.ADDITIONAL_PARAMETERS) {
                this.prepareAdditionalParams(value).forEach((element) => {
                    logger.info("Additional parameter: " + element)
                    commands.push(element);
                });
            }
        });
        const exec = new ExecutionService();
        return await exec.executeCommands(this.config.pathToExecutable, commands, CxConstants.SCAN_TYPE);
    }

    async scanAsca(sourceFile: string, updateVersion = false, agent?: string | null): Promise<CxCommandOutput> {
        const commands: string[] = [CxConstants.CMD_SCAN, CxConstants.CMD_ASCA, CxConstants.SOURCE_FILE, sourceFile];

        if (updateVersion) {
            commands.push(CxConstants.ASCA_UPDATE_VERSION);
        }
        if (agent) {
            commands.push(CxConstants.AGENT);
            commands.push(agent);
        } else {
            commands.push(CxConstants.AGENT);
            // if we don't send any parameter in the flag
            // then in the cli takes the default and this is not true
            commands.push('"js-wrapper"');
        }

        commands.push(...this.initializeCommands(false));
        const exec = new ExecutionService();
        return await exec.executeCommands(this.config.pathToExecutable, commands, CxConstants.SCAN_ASCA);
    }

    async scanCancel(id: string): Promise<CxCommandOutput> {
        const commands: string[] = [CxConstants.CMD_SCAN, CxConstants.SUB_CMD_CANCEL, CxConstants.SCAN_ID, id];
        commands.push(...this.initializeCommands(false));
        const exec = new ExecutionService();
        return await exec.executeCommands(this.config.pathToExecutable, commands, CxConstants.SCAN_TYPE);
    }

    async scanShow(id: string): Promise<CxCommandOutput> {
        const commands: string[] = [CxConstants.CMD_SCAN, CxConstants.SUB_CMD_SHOW, CxConstants.SCAN_ID, id];
        commands.push(...this.initializeCommands(true));
        const exec = new ExecutionService();
        return await exec.executeCommands(this.config.pathToExecutable, commands, CxConstants.SCAN_TYPE);
    }

    async scanList(filters: string): Promise<CxCommandOutput> {
        const validated_filters = this.filterArguments(filters);
        const commands: string[] = [CxConstants.CMD_SCAN, "list"].concat(validated_filters);
        commands.push(...this.initializeCommands(true));
        const exec = new ExecutionService();
        return await exec.executeCommands(this.config.pathToExecutable, commands, CxConstants.SCAN_TYPE);
    }

    async projectList(filters: string): Promise<CxCommandOutput> {
        const validated_filters = this.filterArguments(filters);
        const commands: string[] = [CxConstants.CMD_PROJECT, "list"].concat(validated_filters);
        commands.push(...this.initializeCommands(true));
        const exec = new ExecutionService();
        return await exec.executeCommands(this.config.pathToExecutable, commands, CxConstants.PROJECT_TYPE);
    }

    async projectBranches(projectId: string, filters: string): Promise<CxCommandOutput> {
        // Verify and add possible branch filter by name
        const validated_filters = this.filterArguments(CxConstants.BRANCH_NAME + filters)
        const commands: string[] = [CxConstants.CMD_PROJECT, CxConstants.SUB_CMD_BRANCHES, CxConstants.PROJECT_ID, projectId].concat(validated_filters);
        commands.push(...this.initializeCommands(false));
        const exec = new ExecutionService();
        return await exec.executeCommands(this.config.pathToExecutable, commands);
    }

    async projectShow(projectId: string): Promise<CxCommandOutput> {
        const commands: string[] = [CxConstants.CMD_PROJECT, CxConstants.SUB_CMD_SHOW, CxConstants.PROJECT_ID, projectId];
        commands.push(...this.initializeCommands(true));
        const exec = new ExecutionService();
        return await exec.executeCommands(this.config.pathToExecutable, commands, CxConstants.PROJECT_TYPE);
    }

    async triageShow(projectId: string, similarityId: string, scanType: string): Promise<CxCommandOutput> {
        const commands: string[] = [CxConstants.CMD_TRIAGE, CxConstants.SUB_CMD_SHOW, CxConstants.PROJECT_ID, projectId, CxConstants.SIMILARITY_ID, similarityId, CxConstants.SCAN_TYPES_SUB_CMD, scanType];
        commands.push(...this.initializeCommands(true));
        const exec = new ExecutionService();
        return await exec.executeCommands(this.config.pathToExecutable, commands, CxConstants.PREDICATE_TYPE);
    }

    async triageUpdate(projectId: string, similarityId: string, scanType: string, state: string, comment: string, severity: string): Promise<CxCommandOutput> {
        const commands: string[] = [CxConstants.CMD_TRIAGE, CxConstants.SUB_CMD_UPDATE, CxConstants.PROJECT_ID, projectId, CxConstants.SIMILARITY_ID, similarityId, CxConstants.SCAN_TYPES_SUB_CMD, scanType, CxConstants.STATE, state, CxConstants.COMMENT, comment, CxConstants.SEVERITY, severity];
        commands.push(...this.initializeCommands(false));
        const exec = new ExecutionService();
        return await exec.executeCommands(this.config.pathToExecutable, commands);
    }

    async getResultsList(scanId: string) {
        const exec = new ExecutionService();
        const fileName = new Date().getTime().toString();
        const commands = await this.resultsShow(scanId, CxConstants.FORMAT_JSON, fileName, os.tmpdir())
        // Executes the command and creates a result file
        await exec.executeResultsCommands(this.config.pathToExecutable, commands)
        // Reads the result file and retrieves the results
        return exec.executeResultsCommandsFile(scanId, CxConstants.FORMAT_JSON, CxConstants.FORMAT_JSON_FILE, commands, this.config.pathToExecutable, fileName);
    }

    async getResultsSummary(scanId: string): Promise<CxCommandOutput> {
        const exec = new ExecutionService();
        const fileName = new Date().getTime().toString();
        const commands = await this.resultsShow(scanId, CxConstants.FORMAT_HTML_CLI, fileName, os.tmpdir());
        // Executes the command and creates a result file
        await exec.executeResultsCommands(this.config.pathToExecutable, commands);
        // Reads the result file and retrieves the results
        return exec.executeResultsCommandsFile(scanId, CxConstants.FORMAT_HTML, CxConstants.FORMAT_HTML_FILE, commands, this.config.pathToExecutable, fileName);
    }

    async getResults(scanId: string, resultType: string, outputFileName: string, outputFilePath: string, agent?: string | null) {
        const commands = await this.resultsShow(scanId, resultType, outputFileName, outputFilePath, agent)
        const exec = new ExecutionService();
        return await exec.executeCommands(this.config.pathToExecutable, commands);
    }

    async codeBashingList(cweId: string, language: string, queryName: string): Promise<CxCommandOutput> {
        const commands: string[] = [CxConstants.CMD_RESULT, CxConstants.CMD_CODE_BASHING, CxConstants.LANGUAGE, language, CxConstants.VULNERABILITY_TYPE, queryName, CxConstants.CWE_ID, cweId];
        commands.push(...this.initializeCommands(true));
        const exec = new ExecutionService();
        return await exec.executeCommands(this.config.pathToExecutable, commands, CxConstants.CODE_BASHING_TYPE);
    }

    async resultsShow(scanId: string, reportFormat: string, outputFileName: string, outputPath: string, agent?: string | null): Promise<string[]> {
        const commands: string[] = [CxConstants.CMD_RESULT, CxConstants.SUB_CMD_SHOW, CxConstants.SCAN_ID, scanId, CxConstants.REPORT_FORMAT, reportFormat];
        if (outputFileName) {
            commands.push(CxConstants.OUTPUT_NAME);
            commands.push(outputFileName);
        }
        if (outputPath) {
            commands.push(CxConstants.OUTPUT_PATH);
            commands.push(outputPath);
        }
        if (agent) {
            commands.push(CxConstants.AGENT);
            commands.push(agent);
        }
        commands.push(...this.initializeCommands(false));
        return commands;
    }

    async getResultsBfl(scanId: string, queryId: string, resultNodes: any[]) {
        const commands: string[] = [CxConstants.CMD_RESULT, CxConstants.SUB_CMD_BFL, CxConstants.SCAN_ID, scanId, CxConstants.QUERY_ID, queryId];
        commands.push(...this.initializeCommands(true));
        const exec = new ExecutionService();
        const response = await exec.executeCommands(this.config.pathToExecutable, commands, CxConstants.BFL_TYPE);
        if (response) {
            const bflNodeIndex = this.getIndexOfBflNode(response.payload, resultNodes)
            response.payload[0] = bflNodeIndex;
        }
        return response;
    }

    async kicsRealtimeScan(fileSources: string, engine: string, additionalParams: string): Promise<[Promise<CxCommandOutput>, any]> {
        const commands: string[] = [CxConstants.CMD_SCAN, CxConstants.CMD_KICS_REALTIME, CxConstants.FILE_SOURCES, fileSources, CxConstants.ADDITONAL_PARAMS, additionalParams];
        if (engine.length > 0) {
            commands.push(CxConstants.ENGINE, engine)
        }
        commands.push(...this.initializeCommands(false));
        const exec = new ExecutionService();
        return exec.executeKicsCommands(this.config.pathToExecutable, commands, CxConstants.KICS_REALTIME_TYPE);
    }

    /**
     * Run SCA Realtime for a specific directory
     *
     * @param projectDirPath
     */
    async runScaRealtimeScan(projectDirPath: string): Promise<CxCommandOutput> {
        const commands: string[] = [CxConstants.CMD_SCAN, CxConstants.CMD_SCA_REALTIME, CxConstants.CMD_SCA_REALTIME_PROJECT_DIR, projectDirPath];
        commands.push(...this.initializeCommands(false));
        return new ExecutionService().executeCommands(this.config.pathToExecutable, commands, CxConstants.SCA_REALTIME_TYPE);
    }


    async learnMore(queryId: string) {
        const commands: string[] = [CxConstants.CMD_UTILS, CxConstants.CMD_LEARN_MORE, CxConstants.QUERY_ID, queryId]
        commands.push(...this.initializeCommands(true))
        const exec = new ExecutionService();
        return exec.executeCommands(this.config.pathToExecutable, commands, CxConstants.LEARN_MORE_DESCRIPTIONS_TYPE);
    }

    async kicsRemediation(resultsFile: string, kicsFile: string, engine: string, similarityIds?: string): Promise<[Promise<CxCommandOutput>, any]> {
        const commands: string[] = [CxConstants.CMD_UTILS, CxConstants.CMD_REMEDIATION, CxConstants.KICS, CxConstants.KICS_REMEDIATION_RESULTS_FILE, resultsFile, CxConstants.KICS_REMEDIATION_KICS_FILE, kicsFile];
        if (engine.length > 0) {
            commands.push(CxConstants.ENGINE, engine)
        }
        if (similarityIds) {
            commands.push(CxConstants.KICS_REMEDIATION_SIMILARITY_IDS, similarityIds)
        }
        commands.push(...this.initializeCommands(false));
        const exec = new ExecutionService();
        return exec.executeKicsCommands(this.config.pathToExecutable, commands, CxConstants.KICS_REMEDIATION_TYPE);
    }

    async scaRemediation(packageFiles: string, packages: string, packageVersion: string): Promise<CxCommandOutput> {
        const commands: string[] = [CxConstants.CMD_UTILS, CxConstants.CMD_REMEDIATION, CxConstants.SUB_CMD_REMEDIATION_SCA, CxConstants.SCA_REMEDIATION_PACKAGE_FILES, packageFiles, CxConstants.SCA_REMEDIATION_PACKAGE, packages, CxConstants.SCA_REMEDIATION_PACKAGE_VERSION, packageVersion];
        commands.push(...this.initializeCommands(false));
        const exec = new ExecutionService();
        return exec.executeCommands(this.config.pathToExecutable, commands);
    }

    async ideScansEnabled(): Promise<boolean> {
        const commands: string[] = [CxConstants.CMD_UTILS, CxConstants.SUB_CMD_TENANT];
        commands.push(...this.initializeCommands(false));
        const exec = new ExecutionService();
        const output = await exec.executeMapTenantOutputCommands(this.config.pathToExecutable, commands);
        return output.has(CxConstants.IDE_SCANS_KEY) && output.get(CxConstants.IDE_SCANS_KEY).toLowerCase() === " true";
    }

    async guidedRemediationEnabled(): Promise<boolean> {
        const commands: string[] = [CxConstants.CMD_UTILS, CxConstants.SUB_CMD_TENANT];
        commands.push(...this.initializeCommands(false));
        const exec = new ExecutionService();
        const output = await exec.executeMapTenantOutputCommands(this.config.pathToExecutable, commands);
        return output.has(CxConstants.AI_GUIDED_REMEDIATION_KEY) && output.get(CxConstants.AI_GUIDED_REMEDIATION_KEY).toLowerCase() === " true";
    }

    async kicsChat(apikey: string, file: string, line: number, severity: string, vulnerability: string, input: string, conversationId?: string, model?: string): Promise<CxCommandOutput> {
        const commands: string[] = [
            CxConstants.CMD_CHAT,
            CxConstants.KICS,
            CxConstants.CMD_CHAT_APIKEY, apikey,
            CxConstants.CMD_CHAT_FILE, file,
            CxConstants.CMD_CHAT_LINE, line.toString(),
            CxConstants.CMD_CHAT_SEVERITY, severity,
            CxConstants.CMD_CHAT_VULNERABILITY, vulnerability,
            CxConstants.CMD_CHAT_INPUT, input,
        ];
        if (conversationId) {
            commands.push(CxConstants.CMD_CHAT_CONVERSATION_ID, conversationId)
        }
        if (model) {
            commands.push(CxConstants.CMD_CHAT_MODEL, model)
        }
        commands.push(...this.initializeCommands(false));
        return new ExecutionService().executeCommands(this.config.pathToExecutable, commands, CxConstants.CHAT_TYPE);
    }

    async sastChat(apikey: string, sourceFile: string, resultsFile: string, resultID: string, input: string, conversationId?: string, model?: string): Promise<CxCommandOutput> {
        const commands: string[] = [
            CxConstants.CMD_CHAT,
            CxConstants.SAST,
            CxConstants.CMD_SAST_CHAT_RESULT_ID, resultID,
            CxConstants.CMD_SAST_CHAT_RESULT_RESULTS_FILE, resultsFile,
            CxConstants.CMD_SAST_CHAT_RESULT_SOURCE_FILE, sourceFile,
            CxConstants.CMD_CHAT_APIKEY, apikey,
            CxConstants.CMD_CHAT_INPUT, input,
        ];
        if (conversationId) {
            commands.push(CxConstants.CMD_CHAT_CONVERSATION_ID, conversationId)
        }
        if (model) {
            commands.push(CxConstants.CMD_CHAT_MODEL, model)
        }
        commands.push(...this.initializeCommands(false));
        return new ExecutionService().executeCommands(this.config.pathToExecutable, commands, CxConstants.CHAT_TYPE);
    }

    async maskSecrets(file: string): Promise<CxCommandOutput> {
        const commands: string[] = [
            CxConstants.CMD_UTILS,
            CxConstants.CMD_MASK_SECRETS,
            CxConstants.CMD_CHAT_FILE, file,
        ];

        commands.push(...this.initializeCommands(false));
        return new ExecutionService().executeCommands(this.config.pathToExecutable, commands, CxConstants.MASK_TYPE);
    }


    /**
     * Splits additional CLI parameters into an array of tokens,
     * correctly handling quoted values and key=value pairs.
     *
     * @param additionalParameters - A single string containing extra parameters
     * @returns Array of cleaned tokens ready to pass to the CLI
     */
    private prepareAdditionalParams(additionalParameters: string): string[] {
        if (!additionalParameters) {
            return [];
        }

        // Trim whitespace and remove surrounding quotes if present
        let trimmed = additionalParameters.trim();
        if (
            (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))
        ) {
            trimmed = trimmed.slice(1, -1);
        }

        // Regex matches sequences without whitespace or quoted segments
        const regex = /(?:[^\s'"]+|'[^']*'|"[^"]*")+/g;
        const rawTokens = trimmed.match(regex) || [];

        // Process tokens: remove quotes and handle key=value syntax
        return rawTokens.map(token => {
            // Remove surrounding quotes
            if (
                (token.startsWith('"') && token.endsWith('"')) ||
                (token.startsWith("'") && token.endsWith("'"))
            ) {
                token = token.slice(1, -1);
            }

            // If token contains '=', split and clean value
            const eqIndex = token.indexOf('=');
            if (eqIndex !== -1) {
                const key = token.substring(0, eqIndex);
                let value = token.substring(eqIndex + 1);
                if (
                    (value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))
                ) {
                    value = value.slice(1, -1);
                }
                return `${key}=${value}`;
            }

            return token;
        });
    }



    getIndexOfBflNode(bflNodes: CxBFL[], resultNodes: any[]): number {
        const bflNodeNotFound = -1;

        if (!bflNodes) {
            return bflNodeNotFound
        }

        for (const bflNode of bflNodes) {
            for (const resultNode of resultNodes) {

                if (this.compareNodes(bflNode, resultNode)) {
                    return resultNodes.indexOf(resultNode);
                }
            }

        }
        return bflNodeNotFound;

    }

    compareNodes(bflNode: CxBFL, resultNode: any): boolean {

        return bflNode.line == resultNode.line &&
            bflNode.column == resultNode.column &&
            bflNode.length == resultNode.length &&
            bflNode.name == resultNode.name &&
            bflNode.method == resultNode.method &&
            bflNode.domType == resultNode.domType &&
            bflNode.fileName == resultNode.fileName &&
            bflNode.fullName == resultNode.fullName &&
            bflNode.methodLine == resultNode.methodLine;
    }

    filterArguments(filters: string): string[] {
        const r = [];
        if (filters.length > 0) {
            r.push(CxConstants.FILTER);
            r.push(filters);
        }
        return r;
    }
}