import { LokiTransportService } from "./loki-transport.service";
import { CreateLogData } from "./mongo-log.types";
import mongoose from "mongoose";
export declare class MongoLogService {
    private readonly loki;
    private readonly logger;
    constructor(loki: LokiTransportService);
    logMessage(logData: CreateLogData): Promise<mongoose.Types.ObjectId | null>;
}
