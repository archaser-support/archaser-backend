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
exports.InternalConnectorsController = void 0;
const common_1 = require("@nestjs/common");
const internal_secret_guard_1 = require("../auth/internal-secret.guard");
const sync_queue_service_1 = require("../sync/sync-queue.service");
const billing_connector_1 = require("@archaser/billing-connector");
const database_service_1 = require("../database/database.service");
let InternalConnectorsController = class InternalConnectorsController {
    constructor(syncQueue, db) {
        this.syncQueue = syncQueue;
        this.db = db;
    }
    async sync(accountId, body) {
        const mode = String(body?.mode || "queue");
        if (mode === "inline") {
            const result = await (0, billing_connector_1.runInProcessSync)({
                prisma: this.db,
                accountId,
                trigger: String(body?.trigger || "internal-inline"),
            });
            return result;
        }
        return this.syncQueue.enqueue(accountId, String(body?.trigger || "internal"));
    }
};
exports.InternalConnectorsController = InternalConnectorsController;
__decorate([
    (0, common_1.Post)("accounts/:accountId/sync"),
    __param(0, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], InternalConnectorsController.prototype, "sync", null);
exports.InternalConnectorsController = InternalConnectorsController = __decorate([
    (0, common_1.Controller)("internal"),
    (0, common_1.UseGuards)(internal_secret_guard_1.InternalSecretGuard),
    __metadata("design:paramtypes", [sync_queue_service_1.SyncQueueService,
        database_service_1.DatabaseService])
], InternalConnectorsController);
