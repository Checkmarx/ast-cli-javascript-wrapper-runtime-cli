import {CxCommandOutput} from "./CxCommandOutput";
import CxScan from "../scan/CxScan";
import { logger } from "./loggerConfig";
import * as fs from "fs"
import * as os from "os";
import * as path from "path";
import CxResult from "../results/CxResult";
import CxProject from "../project/CxProject";
import CxCodeBashing from "../codebashing/CxCodeBashing";
import CxBFL from "../bfl/CxBFL";
import spawner = require('child_process');
import CxKicsRealTime from "../kicsRealtime/CxKicsRealTime";
import CxLearnMoreDescriptions from "../learnmore/CxLearnMoreDescriptions";
import {CxConstants} from "./CxConstants";
import CxData from "../results/CxData";
import CxScaPackageData from "../results/CxScaPackageData";
import CxVulnerabilityDetails from "../results/CxVulnerabilityDetails";
import CxCvss from "../results/CxCvss";
import CxNode from "../results/CxNode";
import CxPackageData from "../results/CxPackageData";
import CxKicsRemediation from "../remediation/CxKicsRemediation";
import CxScaRealTime from "../scaRealtime/CxScaRealTime";
import CxChat from "../chat/CxChat";
import CxMask from "../mask/CxMask";
import CxAsca from "../asca/CxAsca";

let skipValue = false;
const scaResolverParamsFlag = "--sca-resolver-params"

function isJsonString(s: string) {
    try {
        const stringObject = s.split('\n')[0];
        JSON.parse(stringObject);
    } catch (e) {
        return false;
    }
    return true;
}

function transformation(commands: string[]): string[] {
    skipValue = false; // Reset the flag before processing
    const result: string[] = commands.map(transform);
    return result;
}

function transform(n:string) {
    if (skipValue) {
        skipValue = false;
        let r = "";
        if(n) r = n.replace(/["]/g, "").replace("/[, ]/g",",");
        return r;
    }
    // If scaResolverParamsFlag contains a single quote inside a double-quoted string, we avoid removing single quotes to preserve the nested content.
    // Example: --sca-resolver-params "--gradle-parameters='-Prepository.proxy.url=123 -Prepository.proxy.username=123 -Prepository.proxy.password=123' --log-level Debug"
    if (n === scaResolverParamsFlag) {
        skipValue = true;
    }

    let r = "";
    if(n) r = n.replace(/["']/g, "").replace("/[, ]/g",",");
    return r;
}

export class ExecutionService {
    private fsObject  : any = undefined

    executeCommands(pathToExecutable: string, commands: string[], output? : string ): Promise<CxCommandOutput> {
        return (new Promise( (resolve, reject)=> {
            let stderr = "";
            let stdout ="";

            this.fsObject = spawner.spawn(pathToExecutable, transformation(commands));
            this.fsObject.on('error', (data: { toString: () => string; }) => {
                if (data) {
                    logger.error(data.toString().replace('\n', ''));
                    stderr += data.toString();
                }
                reject()
            });
            this.fsObject.on('exit',(code: number) => {

                logger.info("Exit code received from AST-CLI: " + code);
                if(code==1){
                    stderr = stdout
                }
                resolve(ExecutionService.onCloseCommand(code, stderr, stdout, output));
            });
            this.fsObject.stdout.on('data', (data: { toString: () => string; }) => {
                if (data) {
                  logger.info(data.toString().replace('\n', ''));
                  stdout += data.toString();
                }
            });
            this.fsObject.stderr.on('data', (data: { toString: () => string; }) => {
              if (data) {
                logger.error(data.toString().replace('\n', ''));
                stderr += data.toString();
              }
            });
        }));
    }

    executeKicsCommands(pathToExecutable: string, commands: string[], output? : string ): [Promise<CxCommandOutput>,any] {
        return [new Promise( (resolve, reject)=> {
            let stderr = "";
            let stdout ="";

            this.fsObject = spawner.spawn(pathToExecutable, transformation(commands));
            this.fsObject.on('error', (data: { toString: () => string; }) => {
                if (data) {
                    logger.error(data.toString().replace('\n', ''));
                    stderr += data.toString();
                }
                reject()
            });
            this.fsObject.on('exit',(code: number) => {
                logger.info("Exit code received from AST-CLI: " + code);
                if(code==1){
                    stderr = stdout
                }
                resolve(ExecutionService.onCloseCommand(code, stderr, stdout, output));
            });
            this.fsObject.stdout.on('data', (data: { toString: () => string; }) => {
                if (data) {
                    logger.info(data.toString().replace('\n', ''));
                    stdout += data.toString();
                }
            });
            this.fsObject.stderr.on('data', (data: { toString: () => string; }) => {
                if (data) {
                    logger.error(data.toString().replace('\n', ''));
                    stderr += data.toString();
                }
            });
        }), this.fsObject];
    }

    executeMapTenantOutputCommands(pathToExecutable: string, commands: string[]): Promise<Map<string,string>> {
        return (new Promise( (resolve, reject)=> {
            let stderr = "";
            let stdout ="";

            this.fsObject = spawner.spawn(pathToExecutable, transformation(commands));
            this.fsObject.on('error', (data: { toString: () => string; }) => {
                if (data) {
                    logger.error(data.toString().replace('\n', ''));
                    stderr += data.toString();
                }
                reject()
            });
            this.fsObject.on('exit',(code: number) => {
                logger.info("Exit code received from AST-CLI: " + code);
                if(code==1){
                    stderr = stdout
                }
                resolve(ExecutionService.onCloseMapTenantOutputCommand(code, stderr, stdout));
            });
            this.fsObject.stdout.on('data', (data: { toString: () => string; }) => {
                if (data) {
                    logger.info(data.toString().replace('\n', ''));
                    stdout += data.toString();
                }
            });
            this.fsObject.stderr.on('data', (data: { toString: () => string; }) => {
                if (data) {
                    logger.error(data.toString().replace('\n', ''));
                    stderr += data.toString();
                }
            });
        }));
    }

    private static onCloseMapTenantOutputCommand(code: number, stderr: string, stdout: string): Map<string,string> {
        const result = new Map<string,string>();
        if (code == 0) {
            const tenantSettingsList = stdout.split('\n');
            tenantSettingsList.forEach(tenantSetting => {
                tenantSetting.includes('Key') ? result.set(tenantSetting.split(':')[1],tenantSettingsList[tenantSettingsList.indexOf(tenantSetting) +1].split(':')[1]) : null;
            });
        } else {
            logger.error("Error occurred while executing command: " + stderr);
        }
        return result;
    }

    private static onCloseCommand(code: number, stderr: string, stdout: string, output: string) : CxCommandOutput {
      const cxCommandOutput = new CxCommandOutput();
      cxCommandOutput.exitCode = code;
      if (stderr) {
        cxCommandOutput.status = stderr;
      }
      if (stdout) {
            const stdoutSplit = stdout.split('\n');
            const data = stdoutSplit.find(isJsonString);
            if (data) {
              const resultObject = JSON.parse(data);
              switch (output) {
                case CxConstants.SCAN_TYPE:
                  const scans = CxScan.parseProject(resultObject);
                  cxCommandOutput.payload = scans;
                  break;
                case CxConstants.SCAN_ASCA:
                    const asca = CxAsca.parseScan(resultObject);
                    cxCommandOutput.payload = [asca];
                    break;
                case CxConstants.PROJECT_TYPE:
                  const projects = CxProject.parseProject(resultObject);
                  cxCommandOutput.payload = projects;
                  break;
                case CxConstants.CODE_BASHING_TYPE:
                  const codeBashing = CxCodeBashing.parseCodeBashing(resultObject);
                  cxCommandOutput.payload = codeBashing;
                  break;
                case CxConstants.BFL_TYPE:
                    const bflNode = CxBFL.parseBFLResponse(resultObject);
                    cxCommandOutput.payload = bflNode;
                    break;
                case CxConstants.KICS_REALTIME_TYPE:
                    const kicsResults = CxKicsRealTime.parseKicsRealTimeResponse(resultObject);
                    cxCommandOutput.payload = [kicsResults];
                    break;
                case CxConstants.SCA_REALTIME_TYPE:
                    const scaRealtimeResponse = CxScaRealTime.parseScaRealTimeResponse(resultObject);
                    cxCommandOutput.payload = [scaRealtimeResponse];
                    break;
              case CxConstants.LEARN_MORE_DESCRIPTIONS_TYPE:
                  const learnMore = CxLearnMoreDescriptions.parseLearnMoreDescriptionsResponse(resultObject);
                  cxCommandOutput.payload = learnMore;
                  break;
              case CxConstants.KICS_REMEDIATION_TYPE:
                  const kicsRemediationOutput = CxKicsRemediation.parseKicsRemediation(resultObject);
                  cxCommandOutput.payload = [kicsRemediationOutput];
                  break;
              case CxConstants.CHAT_TYPE:
                  const chatOutput = CxChat.parseChat(resultObject);
                  cxCommandOutput.payload = [chatOutput];
                  break;
              case CxConstants.MASK_TYPE:
                  const maskOutput = CxMask.parseMask(resultObject);
                  cxCommandOutput.payload = [maskOutput];
                  break;
              default:
                  cxCommandOutput.payload = resultObject;
              }
            }
      }

      return cxCommandOutput;
    }

    executeResultsCommands(pathToExecutable: string, commands: string[]): Promise<CxCommandOutput> {
        return new Promise(function (resolve, reject) {
            let stderr = '';
            const cxCommandOutput = new CxCommandOutput();
            const cp = spawner.spawn(pathToExecutable, commands);
            cp.stderr.on('data', function (chunk: string) {
                stderr += chunk;
            });
            cp.on('error', reject)
                .on('close', function (code: number) {
                    logger.info("Exit code received from AST-CLI: " + code);
                    logger.info(stderr);
                    cxCommandOutput.status = stderr;
                    cxCommandOutput.exitCode = code;
                    resolve(cxCommandOutput)
                });
            cp.stdout.on('data', (data: any) => {
                logger.info(`${data}`);
                cxCommandOutput.payload = data;
            });
        });
    }

    async executeResultsCommandsFile(scanId: string, resultType: string, fileExtension: string,commands: string[], pathToExecutable: string,fileName:string): Promise<CxCommandOutput> {
        const filePath = path.join(os.tmpdir(), fileName + fileExtension)
        const read = fs.readFileSync(filePath,'utf8');
        const cxCommandOutput = new CxCommandOutput();
        // Need to check if file output is json or html
        if(fileExtension.includes("json")){
            const read_json = JSON.parse(read.replace(/:([0-9]{15,}),/g, ':"$1",'));
            if (read_json.results){
                const r : CxResult[] = read_json.results.map((member:any)=>{
                    const cxScaPackageData = new CxScaPackageData(member.data.scaPackageData?.id,member.data.scaPackageData?.locations,member.data.scaPackageData?.dependencyPaths,member.data.scaPackageData?.outdated,member.data.scaPackageData?.fixLink,member.data.scaPackageData?.supportsQuickFix,member.data.scaPackageData?.typeOfDependency);
                    const cvss = new CxCvss(member.vulnerabilityDetails.cvss.version,member.vulnerabilityDetails.cvss.attackVector,member.vulnerabilityDetails.cvss.availability,member.vulnerabilityDetails.cvss.confidentiality,member.vulnerabilityDetails.cvss.attackComplexity,member.vulnerabilityDetails.cvss.integrityImpact,member.vulnerabilityDetails.cvss.scope,member.vulnerabilityDetails.cvss.privilegesRequired,member.vulnerabilityDetails.cvss.userInteraction);
                    const cxVulnerabilityDetails = new CxVulnerabilityDetails(member.vulnerabilityDetails.cweId,cvss,member.vulnerabilityDetails.compliances,member.vulnerabilityDetails.cvssScore,member.vulnerabilityDetails.cveName);
                    const nodes:CxNode[]=member.data.nodes?.map((node:any)=>{
                        return new CxNode(node.id,node.line,node.name,node.column,node.length,node.method,node.nodeID,node.domType,node.fileName,node.fullName,node.typeName,node.methodLine,node.definitions)
                    });
                    const cxPackageData:CxPackageData[]=member.data.packageData?.map((packages:any)=>{
                        return new CxPackageData(packages.comment,packages.type,packages.url);
                    });
                    const data = new CxData(cxPackageData,member.data.packageIdentifier,cxScaPackageData,member.data.queryId,member.data.queryName,member.data.group,member.data.resultHash,member.data.languageName,nodes,member.data.recommendedVersion);
                    return new CxResult(member.type,member.label,member.id,member.status,member.similarityId,member.state,member.severity,member.created,member.firstFoundAt,member.foundAt,member.firstScanId,member.description,data,member.comments,cxVulnerabilityDetails, member.descriptionHTML);
                });
                cxCommandOutput.payload = r;
            }
            else{
                cxCommandOutput.exitCode = 1;
                cxCommandOutput.status = "Error in the json file."
            }
        }
        // In case of html output
        else{
            const html_arrray:string[] = []
            html_arrray.push(read)
            cxCommandOutput.payload = html_arrray;
        }
        return cxCommandOutput;
    }
}
