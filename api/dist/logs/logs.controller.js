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
exports.LogsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const access_scope_service_1 = require("../auth/access-scope.service");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const soft_dual_auth_guard_1 = require("../auth/soft-dual-auth.guard");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
let LogsController = class LogsController {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async list(user, query) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        const allowed = await this.accessScope.hasPermission(accountId, role, "view_system_logs");
        if (!allowed) {
            throw new common_1.ForbiddenException({
                error: "Forbidden - view_system_logs permission required",
            });
        }
        if (query.operation === "sources") {
            const grouped = await this.db.log.groupBy({
                by: ["source"],
                where: { account_id: accountId },
            });
            return {
                sources: grouped
                    .map((g) => g.source)
                    .filter((s) => s && s.trim() !== ""),
            };
        }
        const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(query.limit || "25", 10) || 25));
        const where = { account_id: accountId };
        if (query.source)
            where.source = query.source;
        if (query.level)
            where.level = String(query.level).toUpperCase();
        if (query.search) {
            where.message = {
                contains: query.search,
                mode: "insensitive",
            };
        }
        const [logs, totalRecords] = await Promise.all([
            this.db.log.findMany({
                where,
                orderBy: { timestamp: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.log.count({ where }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({
            logs,
            totalRecords,
            page,
            limit,
            accountId,
        });
    }
    async create(body, req) {
        const user = req.user;
        const message = typeof body.message === "string" ? body.message : "";
        const source = typeof body.source === "string" ? body.source : "";
        if (!message || !source) {
            return {
                error: "Validation failed",
                errors: ["message and source are required"],
            };
        }
        const isLoginEvent = source === "Login" ||
            source === "Middleware-Auth" ||
            (body.details &&
                typeof body.details === "object" &&
                [
                    "login_attempt",
                    "authentication_failed",
                    "form_validation_failed",
                ].includes(String(body.details.action || "")));
        if (!user && !isLoginEvent) {
            return { error: "Unauthorized" };
        }
        const levelRaw = String(body.level || "INFO").toUpperCase();
        const level = [
            "DEBUG",
            "INFO",
            "WARNING",
            "ERROR",
            "CRITICAL",
        ].includes(levelRaw)
            ? levelRaw
            : "INFO";
        await this.db.log.create({
            data: {
                level,
                message: message.slice(0, 10000),
                source: source.slice(0, 255),
                details: body.details && typeof body.details === "object"
                    ? body.details
                    : undefined,
                account_id: user?.account_id ?? null,
                user_id: user?.sub ?? null,
            },
        });
        return { success: true };
    }
};
exports.LogsController = LogsController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: "Account system logs (Nest-native)" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LogsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)("create"),
    (0, common_1.UseGuards)(soft_dual_auth_guard_1.SoftDualAuthGuard),
    (0, swagger_1.ApiOperation)({
        summary: "Create a client/system log entry (Nest-native)",
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], LogsController.prototype, "create", null);
exports.LogsController = LogsController = __decorate([
    (0, swagger_1.ApiTags)("logs"),
    (0, common_1.Controller)("api/logs"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], LogsController);
//# sourceMappingURL=logs.controller.js.map