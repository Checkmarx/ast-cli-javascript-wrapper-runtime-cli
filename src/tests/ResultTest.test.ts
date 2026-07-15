import {CxCommandOutput} from "../main/wrapper/CxCommandOutput";
import {BaseTest} from "./BaseTest";
import * as fs from "fs";
import CxWrapperFactory from "../main/wrapper/CxWrapperFactory";
import {CxParamType} from "../main/wrapper/CxParamType";

const cxWrapperFactory = new CxWrapperFactory();

describe("Results cases",() => {
    const cxScanConfig = new BaseTest();
    it('Result Test Successful case', async () => {
        const auth = await cxWrapperFactory.createWrapper(cxScanConfig);
        const cxCommandOutput: CxCommandOutput  = await auth.scanList("statuses=Completed");
        const sampleId  = cxCommandOutput.payload.pop().id;
        
        auth.getResults(sampleId,"json","jsonList", ".").then(() => {
           fileExists("./jsonList.json").then(file => expect(file).toBe(true));
        });
    });

    it('Result Test With Agent Flug Successful case', async () => {
        const auth = await cxWrapperFactory.createWrapper(cxScanConfig);
        const cxCommandOutput: CxCommandOutput  = await auth.scanList("statuses=Completed");
        const sampleId  = cxCommandOutput.payload.pop().id;
        
        auth.getResults(sampleId,"json","jsonList", ".", "jswrapper").then(() => {
           fileExists("./jsonList.json").then(file => expect(file).toBe(true));
        });
    });

    it('Result List Successful case', async () => {
        const auth = await cxWrapperFactory.createWrapper(cxScanConfig);
        const params = new Map();
        params.set(CxParamType.PROJECT_NAME, "ast-cli-javascript-integration-success");
        params.set(CxParamType.S, "./tsc/tests/data");
        params.set(CxParamType.FILTER, "*.py");
        params.set(CxParamType.BRANCH, "master");
        params.set(CxParamType.SCAN_TYPES, "sast");
        const scanCreateOutput: CxCommandOutput = await auth.scanCreate(params);
        const scanId = scanCreateOutput.payload.pop().id;

        const output = await auth.getResultsList(scanId);
        expect(output.status).toBeUndefined();
        expect(output.payload.length).toBeGreaterThan(0);
    });

    it('Result summary html file generation successful case', async () => {
        const auth = await cxWrapperFactory.createWrapper(cxScanConfig);
        const cxCommandOutput: CxCommandOutput = await auth.scanList("statuses=Completed");
        const sampleId  = cxCommandOutput.payload.pop().id;
        await auth.getResults(sampleId,"summaryHTML","test", ".");
        const file = await fileExists("./test.html");
        expect(file).toBe(true);
    });

    it('Result summary html string successful case', async () => {
        const auth = await cxWrapperFactory.createWrapper(cxScanConfig);
        const cxCommandOutput: CxCommandOutput = await auth.scanList("statuses=Completed");
        const sampleId  = cxCommandOutput.payload.pop().id;
        const written = await auth.getResultsSummary(sampleId);
        expect(written.payload.length).toBeGreaterThan(0);
    });

    it('Result codebashing successful case', async () => {
        const auth = await cxWrapperFactory.createWrapper(cxScanConfig);
        const cxCommandOutput: CxCommandOutput = await auth.codeBashingList("79","PHP","Reflected XSS All Clients");
        expect(cxCommandOutput.payload.length).toBeGreaterThan(0);
    });
});

const fileExists = (file:string) => {
    return new Promise((resolve) => {
        fs.access(file, fs.constants.F_OK, (err) => {
            err ? resolve(false) : resolve(true)
        });
    })
}