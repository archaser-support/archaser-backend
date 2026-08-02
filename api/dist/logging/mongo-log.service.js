"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var MongoLogService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MongoLogService = void 0;
const common_1 = require("@nestjs/common");
const log_model_1 = require("./log.model");
const loki_transport_service_1 = require("./loki-transport.service");
const mongoose_connection_1 = require("./mongoose.connection");
let MongoLogService = MongoLogService_1 = class MongoLogService {
    constructor(loki) {
        this.loki = loki;
        this.logger = new common_1.Logger(MongoLogService_1.name);
    }
    async logMessage(logData) {
        void this.loki.sendLog(logData).catch(() => undefined);
        if (process.env.NODE_ENV === "development") {
            return null;
        }
        try {
            await (0, mongoose_connection_1.ensureMongoConnection)();
            const log = new log_model_1.Log({
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
        }
        catch (error) {
            this.logger.error(`Failed to create log entry: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
};
exports.MongoLogService = MongoLogService;
exports.MongoLogService = MongoLogService = MongoLogService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [loki_transport_service_1.LokiTransportService])
], MongoLogService);
//# sourceMappingURL=mongo-log.service.js.map