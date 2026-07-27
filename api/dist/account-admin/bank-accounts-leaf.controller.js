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
exports.BankAccountsLeafController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const access_scope_service_1 = require("../auth/access-scope.service");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
let BankAccountsLeafController = class BankAccountsLeafController {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async list(user, accountIdRaw, include) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const sessionAccount = this.accessScope.getEffectiveAccountId(userInfo);
        const targetAccountId = accountIdRaw
            ? parseInt(accountIdRaw, 10)
            : sessionAccount;
        if (!targetAccountId || !Number.isFinite(targetAccountId)) {
            return { error: "Customer ID is required" };
        }
        const includeCountry = include?.includes("Country");
        const accounts = await this.db.accountBankAccounts.findMany({
            where: {
                account_id: targetAccountId,
                status: true,
            },
            include: includeCountry ? { Country: true } : undefined,
            orderBy: { bank_name: "asc" },
        });
        return (0, serialize_bigint_1.serializeBigInt)(accounts);
    }
};
exports.BankAccountsLeafController = BankAccountsLeafController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({
        summary: "Active account bank accounts leaf (Nest-native)",
    }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)("accountId")),
    __param(2, (0, common_1.Query)("include")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], BankAccountsLeafController.prototype, "list", null);
exports.BankAccountsLeafController = BankAccountsLeafController = __decorate([
    (0, swagger_1.ApiTags)("bank-accounts"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/bank-accounts"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], BankAccountsLeafController);
//# sourceMappingURL=bank-accounts-leaf.controller.js.map