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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronQueueController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const cron_queue_service_1 = require("./cron-queue.service");
let CronQueueController = class CronQueueController {
    constructor(cronQueue) {
        this.cronQueue = cronQueue;
    }
    async syncSchedules(req) {
        const result = await this.cronQueue.enqueueSyncSchedules({
            reason: "manual",
        });
        return { triggeredBy: req.user?.sub, ...result };
    }
    async runNow(jobId, req) {
        const result = await this.cronQueue.enqueueRunNow({
            cronJobId: jobId,
            triggeredBy: req.user?.sub,
            accountId: req.user?.account_id ?? null,
        });
        return {
            cronJobId: jobId,
            ...result,
        };
    }
};
exports.CronQueueController = CronQueueController;
__decorate([
    (0, common_1.Post)("sync-schedules"),
    (0, swagger_1.ApiOperation)({
        summary: "Ask worker to resync BullMQ repeatables from CronJob config",
    }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CronQueueController.prototype, "syncSchedules", null);
__decorate([
    (0, common_1.Post)(":jobId/run-now"),
    (0, swagger_1.ApiOperation)({
        summary: "Enqueue CronJob run-now on BullMQ (worker executes; set ENABLE_CRON_JOBS=false on API after cutover)",
    }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing auth" }),
    __param(0, (0, common_1.Param)("jobId", common_1.ParseIntPipe)),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], CronQueueController.prototype, "runNow", null);
exports.CronQueueController = CronQueueController = __decorate([
    (0, swagger_1.ApiTags)("cron-queue"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/gateway/cron"),
    __metadata("design:paramtypes", [cron_queue_service_1.CronQueueService])
], CronQueueController);
//# sourceMappingURL=cron-queue.controller.js.map