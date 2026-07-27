import { Response } from "express";
import { GatewayProxyService } from "./gateway-proxy.service";
export declare class GatewayPeelController {
    private readonly proxy;
    constructor(proxy: GatewayProxyService);
    smsSend(body: unknown, res: Response): Promise<void>;
    connectorSync(accountId: string, body: unknown, res: Response): Promise<void>;
    reportExecute(id: string, body: unknown, res: Response): Promise<void>;
}
