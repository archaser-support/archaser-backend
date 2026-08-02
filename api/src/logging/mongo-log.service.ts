import { Injectable, Logger } from "@nestjs/common";
import { Log } from "./log.model";
import { LokiTransportService } from "./loki-transport.service";
import { CreateLogData } from "./mongo-log.types";
import { ensureMongoConnection } from "./mongoose.connection";
import mongoose from "mongoose";

/**
 * Minimal Nest port of staging MongoLogService — enough for welcome-email events.
 */
@Injectable()
export class MongoLogService {
    private readonly logger = new Logger(MongoLogService.name);

    constructor(private readonly loki: LokiTransportService) {}

    async logMessage(
        logData: CreateLogData
    ): Promise<mongoose.Types.ObjectId | null> {
        void this.loki.sendLog(logData).catch(() => undefined);

        if (process.env.NODE_ENV === "development") {
            return null;
        }

        try {
            await ensureMongoConnection();
            const log = new Log({
                timestamp: logData.timestamp || new Date(),
                level: logData.level,
                message: logData.message,
                source: logData.source,
                details: logData.details,
                account_id: logData.account_id,
                user_id: logData.user_id,
                job_id: logData.job_id,
                correlation_id: logData.correlation_id,
                sub_source: logData.sub_source,
            });
            const saved = await log.save();
            return saved._id;
        } catch (error) {
            this.logger.error(
                `Failed to create log entry: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return null;
        }
    }
}
