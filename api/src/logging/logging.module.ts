import { Module } from "@nestjs/common";
import { LokiTransportService } from "./loki-transport.service";
import { MongoLogService } from "./mongo-log.service";

@Module({
    providers: [LokiTransportService, MongoLogService],
    exports: [LokiTransportService, MongoLogService],
})
export class LoggingModule {}
