import {CxCommandOutput} from "../main/wrapper/CxCommandOutput";
import {BaseTest} from "./BaseTest";
import CxResult from '../main/results/CxResult';
import {CxConstants} from '../main/wrapper/CxConstants';
import CxWrapperFactory from "../main/wrapper/CxWrapperFactory";

const cxWrapperFactory = new CxWrapperFactory();

describe("Triage cases", () => {
    const cxScanConfig = new BaseTest();

    const getScanAndResult = async (auth: any): Promise<{ scan: any, result: CxResult }> => {
        const scanList: CxCommandOutput = await auth.scanList("statuses=Completed,limit=100");
        let scan, output, result;

        while (!output && scanList?.payload?.length > 0) {
            scan = scanList.payload.pop();
            output = await auth.getResultsList(scan.id);
            if (output?.status === "Error in the json file.") {
                output = undefined;
            } else {
                result = output?.payload?.find((res: CxResult) => res.type === CxConstants.SAST);
                if (!result?.similarityId) {
                    output = undefined;
                }
            }
        }

        if (!scan) {
            const scanShow = await auth.scanShow("d4354650-4ee1-4e10-9b1d-0feaf6c187a7");
            scan = scanShow?.payload?.pop();
            output = await auth.getResultsList(scan.id);
            result = output?.payload?.find((res: CxResult) => res.type === CxConstants.SAST);
        }

        return { scan, result };
    };

    it('Triage Successful case', async () => {
        const auth = await cxWrapperFactory.createWrapper(cxScanConfig);
        const { scan, result } = await getScanAndResult(auth);

        const cxShow: CxCommandOutput = await auth.triageShow(scan.projectID, result.similarityId, result.type);
        expect(cxShow.exitCode).toEqual(0);

        const cxUpdate: CxCommandOutput = await auth.triageUpdate(
            scan.projectID, result.similarityId, result.type, result.state,
            "Edited via JavascriptWrapper",
            result.severity.toLowerCase() === "high" ? CxConstants.SEVERITY_MEDIUM : CxConstants.SEVERITY_HIGH
        );
        expect(cxUpdate.exitCode).toEqual(0);
    });
});