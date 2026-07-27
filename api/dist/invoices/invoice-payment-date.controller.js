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
exports.InvoicePaymentDateController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const access_scope_service_1 = require("../auth/access-scope.service");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
let InvoicePaymentDateController = class InvoicePaymentDateController {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async updateLastPaymentDate(user, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const actor = this.accessScope.getEffectiveUserId(userInfo);
        const invoiceId = typeof body.invoiceId === "number"
            ? body.invoiceId
            : typeof body.invoiceId === "string"
                ? Number.parseInt(body.invoiceId, 10)
                : NaN;
        if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
            throw new common_1.BadRequestException({ error: "Invalid invoiceId" });
        }
        const lastPaymentDate = body.lastPaymentDate;
        if (typeof lastPaymentDate !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(lastPaymentDate.trim())) {
            throw new common_1.BadRequestException({
                error: "lastPaymentDate must be a valid YYYY-MM-DD date",
            });
        }
        const invoice = await this.db.invoice.findUnique({
            where: { id: invoiceId },
            select: { id: true, customer_id: true, account_id: true },
        });
        if (!invoice) {
            throw new common_1.NotFoundException({ error: "Invoice not found" });
        }
        if (!invoice.customer_id) {
            throw new common_1.UnprocessableEntityException({
                error: "Invoice is not linked to a customer",
            });
        }
        if (invoice.account_id !== accountId &&
            userInfo.accountId !== 10013) {
            throw new common_1.BadRequestException({ error: "Access denied" });
        }
        const paymentDate = new Date(`${lastPaymentDate.trim()}T00:00:00.000Z`);
        const updated = await this.db.invoice.update({
            where: { id: invoiceId },
            data: {
                last_payment_date: paymentDate,
                modified_by: actor,
                modified_at: new Date(),
            },
            select: {
                id: true,
                last_payment_date: true,
                customer_id: true,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            success: true,
            invoice: updated,
        });
    }
};
exports.InvoicePaymentDateController = InvoicePaymentDateController;
__decorate([
    (0, common_1.Post)("update-last-payment-date"),
    (0, swagger_1.ApiOperation)({
        summary: "Update invoice last payment date (Nest-native)",
    }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], InvoicePaymentDateController.prototype, "updateLastPaymentDate", null);
exports.InvoicePaymentDateController = InvoicePaymentDateController = __decorate([
    (0, swagger_1.ApiTags)("invoices"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/invoices"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], InvoicePaymentDateController);
//# sourceMappingURL=invoice-payment-date.controller.js.map