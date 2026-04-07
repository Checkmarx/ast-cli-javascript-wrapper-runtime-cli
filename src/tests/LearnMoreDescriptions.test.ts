import {BaseTest} from "./BaseTest";
import {CxCommandOutput} from "../main/wrapper/CxCommandOutput";
import CxWrapperFactory from "../main/wrapper/CxWrapperFactory";

const cxWrapperFactory = new CxWrapperFactory();

describe("LearnMoreDescriptions cases",() => {
    const cxScanConfig = new BaseTest();
    it.skip('LearnMoreDescriptions Successful case', async () => {
        const auth = await cxWrapperFactory.createWrapper(cxScanConfig);
        const queryId = process.env.CX_TEST_QUERY_ID;
        const data = await auth.learnMore(queryId !== undefined? queryId : "16772998409937314312")
        const cxCommandOutput: CxCommandOutput = data;
        expect(cxCommandOutput.payload.length).toBeGreaterThan(0);
    })
    
    it.skip('LearnMoreDescriptions Failure case', async () => {
        const auth = await cxWrapperFactory.createWrapper(cxScanConfig);
        const data = await auth.learnMore("")
        const cxCommandOutput: CxCommandOutput = data;
        expect(cxCommandOutput.status.trim()).toBe("Value of query-id is invalid");
    })
})
