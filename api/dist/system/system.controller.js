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
exports.SystemCacheInvalidationController = exports.SystemController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const system_service_1 = require("./system.service");
let SystemController = class SystemController {
    constructor(system) {
        this.system = system;
    }
    async dashboard(user, query) {
        return this.system.getDashboard(user, query);
    }
    async chartDetails(user, query) {
        return this.system.getChartDetails(user, query);
    }
    async controlCenter(user, operation) {
        return this.system.getControlCenter(user, operation || "stats");
    }
    async controlCenterOp(user, operation) {
        return this.system.getControlCenter(user, operation);
    }
    async controlCenterPost(user, body, operation) {
        return this.system.postControlCenter(user, operation, body);
    }
    async controlCenterPostOp(user, operation, body) {
        return this.system.postControlCenter(user, operation, body);
    }
    async operationDashboard(user, query) {
        return this.system.getOperationDashboard(user, query);
    }
    async operationDashboardDetails(user, query) {
        return this.system.getOperationDashboardDetails(user, query);
    }
    async agents(user, query) {
        return this.system.getAgents(user, query);
    }
    async agentsStats(user, query) {
        return this.system.getAgentsStats(user, query);
    }
    async agentsFollowUp(user) {
        return this.system.getAgentsFollowUp(user);
    }
    async promiseToPay(user, query) {
        return this.system.getPromiseToPay(user, query);
    }
    async promiseToPayStats(user) {
        return this.system.getPromiseToPayStats(user);
    }
    async promiseToPayPost(user, body) {
        return this.system.postPromiseToPay(user, body);
    }
    async cronJobs(user) {
        return this.system.getCronJobs(user);
    }
    async cronJobsPost(user, body) {
        return this.system.postCronJobs(user, body);
    }
    async cronAlias(user) {
        return this.system.getCronJobs(user);
    }
    async cronAliasPost(user, body) {
        return this.system.postCronJobs(user, body);
    }
    async sharedStats(user, operation) {
        return this.system.getSharedStats(user, operation);
    }
};
exports.SystemController = SystemController;
__decorate([
    (0, common_1.Get)("dashboard"),
    (0, swagger_1.ApiOperation)({ summary: "Financial dashboard KPIs (Nest-native)" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "dashboard", null);
__decorate([
    (0, common_1.Get)("dashboard/chart-details"),
    (0, swagger_1.ApiOperation)({ summary: "Dashboard chart drilldown (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "chartDetails", null);
__decorate([
    (0, common_1.Get)("control-center"),
    (0, swagger_1.ApiOperation)({ summary: "Control center overview (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)("operation")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "controlCenter", null);
__decorate([
    (0, common_1.Get)("control-center/:operation"),
    (0, swagger_1.ApiOperation)({ summary: "Control center by operation (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("operation")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "controlCenterOp", null);
__decorate([
    (0, common_1.Post)("control-center"),
    (0, swagger_1.ApiOperation)({ summary: "Control center POST (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Query)("operation")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "controlCenterPost", null);
__decorate([
    (0, common_1.Post)("control-center/:operation"),
    (0, swagger_1.ApiOperation)({ summary: "Control center POST by operation" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("operation")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "controlCenterPostOp", null);
__decorate([
    (0, common_1.Get)("operation-dashboard"),
    (0, swagger_1.ApiOperation)({ summary: "Operation dashboard KPIs (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "operationDashboard", null);
__decorate([
    (0, common_1.Get)("operation-dashboard/details"),
    (0, swagger_1.ApiOperation)({ summary: "Operation dashboard drilldown (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "operationDashboardDetails", null);
__decorate([
    (0, common_1.Get)("agents"),
    (0, swagger_1.ApiOperation)({ summary: "Agents list (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "agents", null);
__decorate([
    (0, common_1.Get)("agents/stats"),
    (0, swagger_1.ApiOperation)({ summary: "Agents stats (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "agentsStats", null);
__decorate([
    (0, common_1.Get)("agents/follow-up"),
    (0, swagger_1.ApiOperation)({ summary: "Agents follow-up list (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "agentsFollowUp", null);
__decorate([
    (0, common_1.Get)("promise-to-pay"),
    (0, swagger_1.ApiOperation)({ summary: "Promise-to-pay list (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "promiseToPay", null);
__decorate([
    (0, common_1.Get)("promise-to-pay/stats"),
    (0, swagger_1.ApiOperation)({ summary: "Promise-to-pay stats (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "promiseToPayStats", null);
__decorate([
    (0, common_1.Post)("promise-to-pay"),
    (0, swagger_1.ApiOperation)({ summary: "Promise-to-pay POST (Nest-native stub)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "promiseToPayPost", null);
__decorate([
    (0, common_1.Get)("admin/cron-jobs"),
    (0, swagger_1.ApiOperation)({ summary: "List cron jobs (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "cronJobs", null);
__decorate([
    (0, common_1.Post)("admin/cron-jobs"),
    (0, swagger_1.ApiOperation)({ summary: "Trigger cron jobs (Nest stub ack)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "cronJobsPost", null);
__decorate([
    (0, common_1.Get)("cron"),
    (0, swagger_1.ApiOperation)({ summary: "Cron jobs alias (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "cronAlias", null);
__decorate([
    (0, common_1.Post)("cron"),
    (0, swagger_1.ApiOperation)({ summary: "Cron trigger alias (Nest stub ack)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "cronAliasPost", null);
__decorate([
    (0, common_1.Get)("shared-stats/:operation"),
    (0, swagger_1.ApiOperation)({ summary: "Shared stats by operation (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("operation")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "sharedStats", null);
exports.SystemController = SystemController = __decorate([
    (0, swagger_1.ApiTags)("system"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/system"),
    __metadata("design:paramtypes", [system_service_1.SystemService])
], SystemController);
let SystemCacheInvalidationController = class SystemCacheInvalidationController {
    constructor(system) {
        this.system = system;
    }
    async invalidate(body) {
        return this.system.cacheInvalidation(body);
    }
};
exports.SystemCacheInvalidationController = SystemCacheInvalidationController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: "Cache invalidation ack (Nest-native)" }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SystemCacheInvalidationController.prototype, "invalidate", null);
exports.SystemCacheInvalidationController = SystemCacheInvalidationController = __decorate([
    (0, swagger_1.ApiTags)("system"),
    (0, common_1.Controller)("api/system/cache-invalidation"),
    __metadata("design:paramtypes", [system_service_1.SystemService])
], SystemCacheInvalidationController);
//# sourceMappingURL=system.controller.js.map