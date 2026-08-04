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
exports.InternalReportsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const internal_secret_guard_1 = require("../auth/internal-secret.guard");
const database_service_1 = require("../database/database.service");
const report_execution_service_1 = require("../reports/report-execution.service");
const report_export_util_1 = require("../reports/report-export.util");
const SCHEDULER_EXECUTION_ROLES = [
    "System_Administrator",
    "Account_Manager",
    "CFO",
    "Collection_Manager",
    "Data_Analyst",
];
let InternalReportsController = class InternalReportsController {
    constructor(db, execution) {
        this.db = db;
        this.execution = execution;
    }
    async execute(id, body) {
        const report = await this.db.report.findUnique({
            where: { id },
            select: { id: true, account_id: true },
        });
        if (!report) {
            throw new common_1.NotFoundException(`Report ${id} not found`);
        }
        const user = await this.resolveExecutionUser(report.account_id);
        const { triggeredBy: _triggeredBy, scheduleId: _scheduleId, ...executeBody } = body;
        return this.execution.execute(user, id, executeBody || {});
    }
    async export(id, body) {
        const report = await this.db.report.findUnique({
            where: { id },
            select: { id: true, account_id: true, name: true },
        });
        if (!report) {
            throw new common_1.NotFoundException(`Report ${id} not found`);
        }
        const format = body.format || "csv";
        let rows = body.executeResult?.data;
        if (!rows) {
            const user = await this.resolveExecutionUser(report.account_id);
            const { executeResult: _ignored, format: _fmt, ...executeBody } = body;
            const result = await this.execution.execute(user, id, executeBody || {});
            rows = result.data;
        }
        return (0, report_export_util_1.buildReportExport)(rows ?? [], report.name, format);
    }
    async resolveExecutionUser(accountId) {
        for (const role of SCHEDULER_EXECUTION_ROLES) {
            const activeUser = await this.db.user.findFirst({
                where: {
                    account_id: accountId,
                    status: "Active",
                    freeze: false,
                    role,
                },
                orderBy: { created_at: "asc" },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    name: true,
                    account_id: true,
                    role: true,
                    language: true,
                    time_zone: true,
                    locale: true,
                    currency: true,
                    sidebar_collapsed: true,
                },
            });
            if (activeUser?.account_id) {
                return {
                    sub: activeUser.id,
                    username: activeUser.username,
                    email: activeUser.email,
                    account_id: activeUser.account_id,
                    role: activeUser.role,
                    name: activeUser.name,
                    language: activeUser.language,
                    timezone: activeUser.time_zone,
                    locale: activeUser.locale,
                    currency: activeUser.currency,
                    sidebar_collapsed: activeUser.sidebar_collapsed,
                };
            }
        }
        throw new common_1.NotFoundException(`No active report executor user for account ${accountId}`);
    }
};
exports.InternalReportsController = InternalReportsController;
__decorate([
    (0, common_1.Post)(":id/execute"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Service-to-service report execute (x-internal-service-secret)",
    }),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], InternalReportsController.prototype, "execute", null);
__decorate([
    (0, common_1.Post)(":id/export"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Service-to-service report export (x-internal-service-secret)",
    }),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], InternalReportsController.prototype, "export", null);
exports.InternalReportsController = InternalReportsController = __decorate([
    (0, swagger_1.ApiTags)("internal-reports"),
    (0, common_1.UseGuards)(internal_secret_guard_1.InternalSecretGuard),
    (0, common_1.Controller)("internal/reports"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        report_execution_service_1.ReportExecutionService])
], InternalReportsController);
