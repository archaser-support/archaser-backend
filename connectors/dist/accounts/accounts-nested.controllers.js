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
exports.NotificationRuleSetsController = exports.BillingConnectorController = exports.CheckUsernameController = exports.AccountsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const accounts_nested_service_1 = require("./accounts-nested.service");
let AccountsController = class AccountsController {
    constructor(service) {
        this.service = service;
    }
    async byId(user, accountId) {
        return this.service.getAccount(user, accountId);
    }
    async listSmsPrefs(user, accountId, countryId) {
        return this.service.listSmsPreferences(user, accountId, countryId);
    }
    async createSmsPref(user, accountId, body) {
        return this.service.createSmsPreference(user, accountId, body);
    }
    async getSmsPref(user, accountId, preferenceId) {
        return this.service.getSmsPreference(user, accountId, preferenceId);
    }
    async updateSmsPref(user, accountId, preferenceId, body) {
        return this.service.updateSmsPreference(user, accountId, preferenceId, body);
    }
    async deleteSmsPref(user, accountId, preferenceId) {
        return this.service.deleteSmsPreference(user, accountId, preferenceId);
    }
    async genericFieldConfig(user, accountId, body) {
        return this.service.updateGenericFieldConfig(user, accountId, body);
    }
};
exports.AccountsController = AccountsController;
__decorate([
    (0, common_1.Get)(":accountId"),
    (0, swagger_1.ApiOperation)({ summary: "Account by id (Nest-native)" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], AccountsController.prototype, "byId", null);
__decorate([
    (0, common_1.Get)(":accountId/sms-preferences"),
    (0, swagger_1.ApiOperation)({ summary: "List account SMS preferences" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Query)("country_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, String]),
    __metadata("design:returntype", Promise)
], AccountsController.prototype, "listSmsPrefs", null);
__decorate([
    (0, common_1.Post)(":accountId/sms-preferences"),
    (0, swagger_1.ApiOperation)({ summary: "Create account SMS preference" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], AccountsController.prototype, "createSmsPref", null);
__decorate([
    (0, common_1.Get)(":accountId/sms-preferences/:preferenceId"),
    (0, swagger_1.ApiOperation)({ summary: "Get SMS preference by id" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)("preferenceId", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Number]),
    __metadata("design:returntype", Promise)
], AccountsController.prototype, "getSmsPref", null);
__decorate([
    (0, common_1.Put)(":accountId/sms-preferences/:preferenceId"),
    (0, swagger_1.ApiOperation)({ summary: "Update SMS preference" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)("preferenceId", common_1.ParseIntPipe)),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Number, Object]),
    __metadata("design:returntype", Promise)
], AccountsController.prototype, "updateSmsPref", null);
__decorate([
    (0, common_1.Delete)(":accountId/sms-preferences/:preferenceId"),
    (0, swagger_1.ApiOperation)({ summary: "Delete SMS preference" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)("preferenceId", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Number]),
    __metadata("design:returntype", Promise)
], AccountsController.prototype, "deleteSmsPref", null);
__decorate([
    (0, common_1.Put)(":accountId/generic-field-config"),
    (0, swagger_1.ApiOperation)({ summary: "Update generic field config" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], AccountsController.prototype, "genericFieldConfig", null);
exports.AccountsController = AccountsController = __decorate([
    (0, swagger_1.ApiTags)("accounts"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/accounts"),
    __metadata("design:paramtypes", [accounts_nested_service_1.AccountsNestedService])
], AccountsController);
let CheckUsernameController = class CheckUsernameController {
    constructor(service) {
        this.service = service;
    }
    async check(username, excludeUserId) {
        if (!username || typeof username !== "string") {
            return {
                success: false,
                error: "Username is required",
            };
        }
        return this.service.checkUsername(username, excludeUserId);
    }
};
exports.CheckUsernameController = CheckUsernameController;
__decorate([
    (0, common_1.Get)("check-username"),
    (0, swagger_1.ApiOperation)({ summary: "Check username availability (Nest-native)" }),
    __param(0, (0, common_1.Query)("username")),
    __param(1, (0, common_1.Query)("excludeUserId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], CheckUsernameController.prototype, "check", null);
exports.CheckUsernameController = CheckUsernameController = __decorate([
    (0, swagger_1.ApiTags)("entities"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/entities/users"),
    __metadata("design:paramtypes", [accounts_nested_service_1.AccountsNestedService])
], CheckUsernameController);
let BillingConnectorController = class BillingConnectorController {
    constructor(service) {
        this.service = service;
    }
    async get(user, accountId) {
        return this.service.getBillingConnector(user, accountId);
    }
    async put(user, accountId, body) {
        return this.service.upsertBillingConnector(user, accountId, body);
    }
    async test(user, accountId, body) {
        return this.service.billingConnectorAction(user, accountId, "test", body);
    }
    async sync(user, accountId, body, mode) {
        return this.service.billingConnectorAction(user, accountId, "sync", {
            ...(body ?? {}),
            ...(mode ? { mode } : {}),
        });
    }
    async syncRuns(user, accountId) {
        return this.service.billingConnectorAction(user, accountId, "sync-runs");
    }
    async backfillReset(user, accountId) {
        return this.service.billingConnectorAction(user, accountId, "backfill-reset");
    }
    async getMappings(user, accountId, importType) {
        return this.service.getBillingMappings(user, accountId, importType);
    }
    async putMappings(user, accountId, importType, body) {
        return this.service.putBillingMappings(user, accountId, importType, body);
    }
    async discover(user, accountId, importType) {
        return this.service.discoverBillingFields(user, accountId, importType);
    }
};
exports.BillingConnectorController = BillingConnectorController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: "Get billing connector config" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BillingConnectorController.prototype, "get", null);
__decorate([
    (0, common_1.Put)(),
    (0, swagger_1.ApiOperation)({ summary: "Upsert billing connector config" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], BillingConnectorController.prototype, "put", null);
__decorate([
    (0, common_1.Post)("test"),
    (0, swagger_1.ApiOperation)({ summary: "Test billing connector connection" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], BillingConnectorController.prototype, "test", null);
__decorate([
    (0, common_1.Post)("sync"),
    (0, swagger_1.ApiOperation)({ summary: "Trigger billing connector sync" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Query)("mode")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object, String]),
    __metadata("design:returntype", Promise)
], BillingConnectorController.prototype, "sync", null);
__decorate([
    (0, common_1.Get)("sync-runs"),
    (0, swagger_1.ApiOperation)({ summary: "List billing connector sync runs" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BillingConnectorController.prototype, "syncRuns", null);
__decorate([
    (0, common_1.Post)("backfill/reset"),
    (0, swagger_1.ApiOperation)({ summary: "Reset billing connector backfill" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BillingConnectorController.prototype, "backfillReset", null);
__decorate([
    (0, common_1.Get)("mappings/:importType"),
    (0, swagger_1.ApiOperation)({ summary: "Get field mappings for import type" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)("importType")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, String]),
    __metadata("design:returntype", Promise)
], BillingConnectorController.prototype, "getMappings", null);
__decorate([
    (0, common_1.Put)("mappings/:importType"),
    (0, swagger_1.ApiOperation)({ summary: "Upsert field mappings for import type" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)("importType")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, String, Object]),
    __metadata("design:returntype", Promise)
], BillingConnectorController.prototype, "putMappings", null);
__decorate([
    (0, common_1.Get)("discover-fields/:importType"),
    (0, swagger_1.ApiOperation)({ summary: "Discover fields for import type" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)("importType")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, String]),
    __metadata("design:returntype", Promise)
], BillingConnectorController.prototype, "discover", null);
exports.BillingConnectorController = BillingConnectorController = __decorate([
    (0, swagger_1.ApiTags)("billing-connector"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/entities/accounts/:accountId/billing-connector"),
    __metadata("design:paramtypes", [accounts_nested_service_1.AccountsNestedService])
], BillingConnectorController);
let NotificationRuleSetsController = class NotificationRuleSetsController {
    constructor(service) {
        this.service = service;
    }
    async list(user, accountId) {
        return this.service.listNotificationRuleSets(user, accountId);
    }
    async update(user, accountId, setId, body) {
        return this.service.updateNotificationRuleSet(user, accountId, setId, body);
    }
};
exports.NotificationRuleSetsController = NotificationRuleSetsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: "List credit insurance notification rule sets" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], NotificationRuleSetsController.prototype, "list", null);
__decorate([
    (0, common_1.Put)(":setId"),
    (0, swagger_1.ApiOperation)({ summary: "Update a notification rule set" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)("setId", common_1.ParseIntPipe)),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Number, Object]),
    __metadata("design:returntype", Promise)
], NotificationRuleSetsController.prototype, "update", null);
exports.NotificationRuleSetsController = NotificationRuleSetsController = __decorate([
    (0, swagger_1.ApiTags)("notification-rule-sets"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/entities/accounts/:accountId/notification-rule-sets"),
    __metadata("design:paramtypes", [accounts_nested_service_1.AccountsNestedService])
], NotificationRuleSetsController);
