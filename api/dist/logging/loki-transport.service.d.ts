import { CreateLogData } from "./mongo-log.types";
export declare class LokiTransportService {
    private readonly lokiUrl;
    private readonly enabled;
    private readonly serviceName;
    private readonly environment;
    constructor();
    sendLog(logData: CreateLogData): Promise<void>;
    private pushToLoki;
}
