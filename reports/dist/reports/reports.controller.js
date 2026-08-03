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
exports.ReportsByIdController = exports.ReportsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const execute_report_dto_1 = require("./dto/execute-report.dto");
const report_execution_service_1 = require("./report-execution.service");
const reports_service_1 = require("./reports.service");
let ReportsController = class ReportsController {
    constructor(reports, execution) {
        this.reports = reports;
        this.execution = execution;
    }
    async list(user, query) {
        return this.reports.list(user, query);
    }
    async create(user, body) {
        return this.reports.create(user, body);
    }
    async metadata(user) {
        return this.reports.metadata(user);
    }
    async getUserDefault(user, context) {
        return this.reports.getUserDefault(user, context);
    }
    async setUserDefault(user, body) {
        return this.reports.setUserDefault(user, body.context, Number(body.reportId));
    }
    async clearUserDefault(user, context) {
        return this.reports.clearUserDefault(user, context);
    }
    async syncSystem(user) {
        return this.reports.syncSystem(user);
    }
};
exports.ReportsController = ReportsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: "List reports / default view" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing auth" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: "Create report" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)("metadata"),
    (0, swagger_1.ApiOperation)({ summary: "Report builder metadata" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "metadata", null);
__decorate([
    (0, common_1.Get)("user-default"),
    (0, swagger_1.ApiOperation)({ summary: "Get user default view for context" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)("context")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "getUserDefault", null);
__decorate([
    (0, common_1.Post)("user-default"),
    (0, swagger_1.ApiOperation)({ summary: "Set user default view" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "setUserDefault", null);
__decorate([
    (0, common_1.Delete)("user-default"),
    (0, swagger_1.ApiOperation)({ summary: "Clear user default view" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)("context")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "clearUserDefault", null);
__decorate([
    (0, common_1.Post)("sync-system"),
    (0, swagger_1.ApiOperation)({ summary: "Sync system reports (admin)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "syncSystem", null);
exports.ReportsController = ReportsController = __decorate([
    (0, swagger_1.ApiTags)("reports"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/reports"),
    __metadata("design:paramtypes", [reports_service_1.ReportsService,
        report_execution_service_1.ReportExecutionService])
], ReportsController);
let ReportsByIdController = class ReportsByIdController {
    constructor(reports, execution) {
        this.reports = reports;
        this.execution = execution;
    }
    async byId(user, id) {
        return this.reports.getById(user, id);
    }
    async update(user, id, body) {
        return this.reports.update(user, id, body);
    }
    async remove(user, id) {
        return this.reports.remove(user, id);
    }
    async execute(user, id, body) {
        return this.execution.execute(user, id, body || {});
    }
    async export(user, id, body) {
        const result = await this.execution.execute(user, id, {
            page: 1,
            limit: 5000,
            filters: body.filters,
            search: body.search,
            sortField: body.sortField,
            sortDirection: body.sortDirection,
            replaceConfigFilters: body.replaceConfigFilters,
        });
        return {
            format: String(body.format || "csv"),
            rows: result.data,
            totalRecords: result.totalRecords,
            reportId: id,
        };
    }
    async listShares(user, id) {
        return this.reports.listShares(user, id);
    }
    async share(user, id, body) {
        return this.reports.upsertShare(user, id, body);
    }
    async listSchedules(user, id) {
        return this.reports.listSchedules(user, id);
    }
    async schedule(user, id, body) {
        return this.reports.upsertSchedule(user, id, body);
    }
};
exports.ReportsByIdController = ReportsByIdController;
__decorate([
    (0, common_1.Get)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Get report by id" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], ReportsByIdController.prototype, "byId", null);
__decorate([
    (0, common_1.Put)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Update report" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], ReportsByIdController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Delete report" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], ReportsByIdController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(":id/execute"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: "Execute report (grid data)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, execute_report_dto_1.ExecuteReportDto]),
    __metadata("design:returntype", Promise)
], ReportsByIdController.prototype, "execute", null);
__decorate([
    (0, common_1.Post)(":id/export"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: "Export report rows" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], ReportsByIdController.prototype, "export", null);
__decorate([
    (0, common_1.Get)(":id/share"),
    (0, swagger_1.ApiOperation)({ summary: "List report shares" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], ReportsByIdController.prototype, "listShares", null);
__decorate([
    (0, common_1.Post)(":id/share"),
    (0, swagger_1.ApiOperation)({ summary: "Share report" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], ReportsByIdController.prototype, "share", null);
__decorate([
    (0, common_1.Get)(":id/schedule"),
    (0, swagger_1.ApiOperation)({ summary: "List report schedules" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], ReportsByIdController.prototype, "listSchedules", null);
__decorate([
    (0, common_1.Post)(":id/schedule"),
    (0, swagger_1.ApiOperation)({ summary: "Create/update report schedule" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], ReportsByIdController.prototype, "schedule", null);
exports.ReportsByIdController = ReportsByIdController = __decorate([
    (0, swagger_1.ApiTags)("reports"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/reports"),
    __metadata("design:paramtypes", [reports_service_1.ReportsService,
        report_execution_service_1.ReportExecutionService])
], ReportsByIdController);
