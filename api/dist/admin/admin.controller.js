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
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
let AdminController = class AdminController {
    constructor(db) {
        this.db = db;
    }
    async customersWithEmail() {
        const customers = await this.db.customer.findMany({
            where: {
                Activity: {
                    some: {
                        type: "Email",
                        status: {
                            in: ["SENT", "DELIVERED", "FAILED", "BOUNCED"],
                        },
                        ActivityContact: {
                            some: {
                                Contact: { email: { not: null } },
                            },
                        },
                    },
                },
            },
            select: {
                id: true,
                customer_number: true,
                Person: {
                    select: {
                        first_name: true,
                        last_name: true,
                        full_name: true,
                    },
                },
                Company: { select: { name: true } },
            },
            orderBy: { customer_number: "asc" },
        });
        return customers.map((customer) => {
            let name = customer.customer_number || "Unknown";
            if (customer.Person) {
                name =
                    customer.Person.full_name ||
                        `${customer.Person.first_name || ""} ${customer.Person.last_name || ""}`.trim() ||
                        name;
            }
            else if (customer.Company) {
                name = customer.Company.name || name;
            }
            return { ...customer, name };
        });
    }
    async emailCampaignAccounts() {
        const accounts = await this.customersWithEmail();
        return (0, serialize_bigint_1.serializeBigInt)({ accounts });
    }
    async emailCampaignCustomers() {
        const customers = await this.customersWithEmail();
        return (0, serialize_bigint_1.serializeBigInt)({ customers });
    }
    async emailCampaignReport(customerIdRaw, accountIdRaw) {
        const customerId = customerIdRaw
            ? parseInt(customerIdRaw, 10)
            : accountIdRaw
                ? parseInt(accountIdRaw, 10)
                : null;
        const where = {
            type: "Email",
            status: { in: ["SENT", "DELIVERED", "FAILED", "BOUNCED"] },
        };
        if (customerId && Number.isFinite(customerId)) {
            where.customer_id = customerId;
        }
        const [total, delivered, failed, opened] = await Promise.all([
            this.db.activity.count({ where }),
            this.db.activity.count({
                where: { ...where, status: "DELIVERED" },
            }),
            this.db.activity.count({
                where: { ...where, status: { in: ["FAILED", "BOUNCED"] } },
            }),
            this.db.activityContact.count({
                where: {
                    communication_channel: "Email",
                    email_opened_at: { not: null },
                    ...(customerId && Number.isFinite(customerId)
                        ? { Activity: { customer_id: customerId } }
                        : {}),
                },
            }),
        ]);
        return {
            total,
            delivered,
            failed,
            opened,
            customerId: customerId || null,
        };
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Get)("email-campaign-accounts"),
    (0, swagger_1.ApiOperation)({
        summary: "Accounts/customers with email campaign data (alias)",
    }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "emailCampaignAccounts", null);
__decorate([
    (0, common_1.Get)("email-campaign-customers"),
    (0, swagger_1.ApiOperation)({ summary: "Customers with email campaign data" }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "emailCampaignCustomers", null);
__decorate([
    (0, common_1.Get)("email-campaign-report"),
    (0, swagger_1.ApiOperation)({ summary: "Email campaign report summary" }),
    __param(0, (0, common_1.Query)("customerId")),
    __param(1, (0, common_1.Query)("accountId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "emailCampaignReport", null);
exports.AdminController = AdminController = __decorate([
    (0, swagger_1.ApiTags)("admin"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/admin"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], AdminController);
//# sourceMappingURL=admin.controller.js.map