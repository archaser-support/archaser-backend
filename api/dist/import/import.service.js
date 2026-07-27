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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportService = void 0;
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
const IMPORT_TYPE_MAP = {
    payment: "Payment",
    customer: "Customer",
    contact: "Contact",
    invoice: "Invoice",
    policy: "Policy",
};
let ImportService = class ImportService {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async importLeaf(leaf, user, body) {
        void user;
        void body;
        void leaf;
        return { results: [], message: "ok" };
    }
    async createJob(user, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const effectiveUserId = this.accessScope.getEffectiveUserId(userInfo);
        const rawType = String(body.import_type || body.type || "Customer");
        const importType = IMPORT_TYPE_MAP[rawType.toLowerCase()] || "Customer";
        const job = await this.db.importJob.create({
            data: {
                id: (0, crypto_1.randomUUID)(),
                account_id: accountId,
                user_id: effectiveUserId,
                import_type: importType,
                status: "Pending",
                total_records: Number(body.total_records) || 0,
                metadata: body.metadata ?? undefined,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(job);
    }
    async completeJob(user, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const jobId = String(body.jobId || body.id || "");
        const existing = await this.db.importJob.findFirst({
            where: { id: jobId, account_id: accountId },
            select: { id: true },
        });
        if (!existing) {
            throw new common_1.NotFoundException({ error: "Import job not found" });
        }
        const job = await this.db.importJob.update({
            where: { id: jobId },
            data: {
                status: "Completed",
                completed_at: new Date(),
                ...(body.successful_records !== undefined
                    ? { successful_records: Number(body.successful_records) }
                    : {}),
                ...(body.failed_records !== undefined
                    ? { failed_records: Number(body.failed_records) }
                    : {}),
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(job);
    }
    async getJobById(user, jobId) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const job = await this.db.importJob.findFirst({
            where: { id: jobId, account_id: accountId },
            include: { ImportRecord: true },
        });
        if (!job) {
            throw new common_1.NotFoundException({ error: "Import job not found" });
        }
        return (0, serialize_bigint_1.serializeBigInt)(job);
    }
};
exports.ImportService = ImportService;
exports.ImportService = ImportService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], ImportService);
//# sourceMappingURL=import.service.js.map