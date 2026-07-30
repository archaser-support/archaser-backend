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
exports.CustomerCheckpointService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const access_scope_service_1 = require("../auth/access-scope.service");
const domain_db_1 = require("../credit-insurance/domain-db");
const syncCustomerInsuranceFields_1 = require("../credit-insurance/domain/syncCustomerInsuranceFields");
const database_service_1 = require("../database/database.service");
const recalculateCustomerAmounts_1 = require("./domain/recalculateCustomerAmounts");
const CHECKPOINT_SCHEMA_VERSION = 1;
const RESTORE_TRANSACTION_TIMEOUT_MS = 120_000;
const RESTORE_TRANSACTION_MAX_WAIT_MS = 15_000;
const SNAPSHOT_TABLES = [
    {
        key: "contacts",
        model: client_1.Prisma.ModelName.Contact,
        client: "contact",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "customerBanks",
        model: client_1.Prisma.ModelName.CustomerBanks,
        client: "customerBanks",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "collectionPeriods",
        model: client_1.Prisma.ModelName.CustomerCollectionPeriod,
        client: "customerCollectionPeriod",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "invoices",
        model: client_1.Prisma.ModelName.Invoice,
        client: "invoice",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "payments",
        model: client_1.Prisma.ModelName.Payment,
        client: "payment",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "invoicePayments",
        model: client_1.Prisma.ModelName.InvoicePayment,
        client: "invoicePayment",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "activities",
        model: client_1.Prisma.ModelName.Activity,
        client: "activity",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "activityContacts",
        model: client_1.Prisma.ModelName.ActivityContact,
        client: "activityContact",
        where: (s) => ({ activity_id: { in: s.activityIds } }),
    },
    {
        key: "disputes",
        model: client_1.Prisma.ModelName.CustomerDispute,
        client: "customerDispute",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "disputeInvoices",
        model: client_1.Prisma.ModelName.DisputeInvoice,
        client: "disputeInvoice",
        where: (s) => ({ dispute_id: { in: s.disputeIds } }),
    },
    {
        key: "aggregatedData",
        model: client_1.Prisma.ModelName.CustomerAggregatedData,
        client: "customerAggregatedData",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "customerPolicies",
        model: client_1.Prisma.ModelName.CustomerPolicy,
        client: "customerPolicy",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "customerTopUps",
        model: client_1.Prisma.ModelName.CustomerTopUp,
        client: "customerTopUp",
        where: (s) => ({ customer_id: s.customerId }),
    },
];
function delegateFor(db, client) {
    return db[client];
}
const fieldTypeCache = new Map();
function fieldTypes(model) {
    const cached = fieldTypeCache.get(model);
    if (cached) {
        return cached;
    }
    const definition = client_1.Prisma.dmmf.datamodel.models.find((m) => m.name === model);
    const types = new Map();
    for (const field of definition?.fields ?? []) {
        if (field.kind === "scalar" || field.kind === "enum") {
            types.set(field.name, field.type);
        }
    }
    fieldTypeCache.set(model, types);
    return types;
}
function toJsonValue(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (client_1.Prisma.Decimal.isDecimal(value)) {
        return value.toString();
    }
    if (Buffer.isBuffer(value)) {
        return value.toString("base64");
    }
    return value;
}
function toJsonRow(row) {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        out[key] = toJsonValue(value);
    }
    return out;
}
function fromJsonRow(model, row) {
    const types = fieldTypes(model);
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        const type = types.get(key);
        if (!type) {
            continue;
        }
        if (value === null || value === undefined) {
            out[key] = null;
            continue;
        }
        switch (type) {
            case "DateTime":
                out[key] = new Date(value);
                break;
            case "BigInt":
                out[key] = BigInt(value);
                break;
            case "Decimal":
                out[key] = new client_1.Prisma.Decimal(value);
                break;
            case "Bytes":
                out[key] = Buffer.from(value, "base64");
                break;
            default:
                out[key] = value;
        }
    }
    return out;
}
function rowsFor(payload, key) {
    const rows = payload.tables[key];
    return Array.isArray(rows) ? rows : [];
}
function countsFor(payload) {
    return {
        invoices: rowsFor(payload, "invoices").length,
        invoicePayments: rowsFor(payload, "invoicePayments").length,
        payments: rowsFor(payload, "payments").length,
        collectionPeriods: rowsFor(payload, "collectionPeriods").length,
        activities: rowsFor(payload, "activities").length,
        activityContacts: rowsFor(payload, "activityContacts").length,
        disputes: rowsFor(payload, "disputes").length,
        disputeInvoices: rowsFor(payload, "disputeInvoices").length,
        customerPolicies: rowsFor(payload, "customerPolicies").length,
        customerTopUps: rowsFor(payload, "customerTopUps").length,
        contacts: rowsFor(payload, "contacts").length,
        customerBanks: rowsFor(payload, "customerBanks").length,
        hasAggregatedData: rowsFor(payload, "aggregatedData").length > 0,
    };
}
let CustomerCheckpointService = class CustomerCheckpointService {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    onModuleInit() {
        (0, domain_db_1.bindCreditInsurancePrisma)(this.db);
    }
    async assertCheckpointAccess(user, customerId) {
        if (process.env.NODE_ENV === "production") {
            throw new common_1.ForbiddenException({
                error: "Customer checkpoints are disabled in production",
                code: "CHECKPOINT_PRODUCTION_DISABLED",
            });
        }
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const customer = await this.db.customer.findFirst({
            where: { id: customerId, account_id: accountId },
            select: {
                account_id: true,
                Account: { select: { enable_customer_checkpoints: true } },
            },
        });
        if (!customer) {
            throw new common_1.NotFoundException({
                error: "Customer not found",
                code: "CUSTOMER_NOT_FOUND",
            });
        }
        if (customer.Account?.enable_customer_checkpoints !== true) {
            throw new common_1.ForbiddenException({
                error: "Customer checkpoints are not enabled for this account",
                code: "CHECKPOINT_NOT_ENABLED",
            });
        }
        return {
            accountId: customer.account_id,
            effectiveUserId: this.accessScope.getEffectiveUserId(userInfo),
        };
    }
    async resolveScope(db, customerId) {
        const [activities, disputes] = await Promise.all([
            db.activity.findMany({
                where: { customer_id: customerId },
                select: { id: true },
            }),
            db.customerDispute.findMany({
                where: { customer_id: customerId },
                select: { id: true },
            }),
        ]);
        return {
            customerId,
            activityIds: activities.map((a) => a.id),
            disputeIds: disputes.map((d) => d.id),
        };
    }
    async capture(customerId) {
        const customer = await this.db.customer.findUnique({
            where: { id: customerId },
        });
        if (!customer) {
            throw new common_1.NotFoundException({
                error: "Customer not found",
                code: "CUSTOMER_NOT_FOUND",
            });
        }
        const scope = await this.resolveScope(this.db, customerId);
        const tables = {
            customer: toJsonRow(customer),
        };
        for (const table of SNAPSHOT_TABLES) {
            const rows = await delegateFor(this.db, table.client).findMany({
                where: table.where(scope),
            });
            tables[table.key] = rows.map(toJsonRow);
        }
        return {
            schemaVersion: CHECKPOINT_SCHEMA_VERSION,
            capturedAt: new Date().toISOString(),
            tables: tables,
        };
    }
    async getStatus(user, customerId) {
        await this.assertCheckpointAccess(user, customerId);
        const checkpoint = await this.db.customerCheckpoint.findUnique({
            where: { customer_id: customerId },
        });
        if (!checkpoint) {
            return { exists: false, savedAt: null, savedBy: null };
        }
        return {
            exists: true,
            savedAt: checkpoint.saved_at.toISOString(),
            savedBy: checkpoint.saved_by,
            rowCounts: countsFor(checkpoint.payload),
        };
    }
    async save(user, customerId) {
        const { accountId, effectiveUserId } = await this.assertCheckpointAccess(user, customerId);
        const payload = await this.capture(customerId);
        const savedAt = new Date();
        const checkpoint = await this.db.customerCheckpoint.upsert({
            where: { customer_id: customerId },
            create: {
                customer_id: customerId,
                account_id: accountId,
                payload: payload,
                saved_at: savedAt,
                saved_by: effectiveUserId,
            },
            update: {
                account_id: accountId,
                payload: payload,
                saved_at: savedAt,
                saved_by: effectiveUserId,
            },
        });
        return {
            exists: true,
            savedAt: checkpoint.saved_at.toISOString(),
            savedBy: checkpoint.saved_by,
            rowCounts: countsFor(payload),
        };
    }
    async restore(user, customerId) {
        await this.assertCheckpointAccess(user, customerId);
        const checkpoint = await this.db.customerCheckpoint.findUnique({
            where: { customer_id: customerId },
        });
        if (!checkpoint) {
            throw new common_1.NotFoundException({
                error: "No checkpoint saved for this customer",
                code: "CHECKPOINT_NOT_FOUND",
            });
        }
        const payload = checkpoint.payload;
        await this.db.$transaction(async (tx) => {
            const scope = await this.resolveScope(tx, customerId);
            for (const table of [...SNAPSHOT_TABLES].reverse()) {
                await delegateFor(tx, table.client).deleteMany({
                    where: table.where(scope),
                });
            }
            const customerRow = fromJsonRow(client_1.Prisma.ModelName.Customer, payload.tables.customer);
            delete customerRow.id;
            await tx.customer.update({
                where: { id: customerId },
                data: customerRow,
            });
            for (const table of SNAPSHOT_TABLES) {
                const rows = rowsFor(payload, table.key);
                if (!rows.length) {
                    continue;
                }
                await delegateFor(tx, table.client).createMany({
                    data: rows.map((row) => fromJsonRow(table.model, row)),
                });
            }
        }, {
            timeout: RESTORE_TRANSACTION_TIMEOUT_MS,
            maxWait: RESTORE_TRANSACTION_MAX_WAIT_MS,
        });
        await (0, recalculateCustomerAmounts_1.recalculateCustomerAmounts)([customerId], this.db);
        await (0, syncCustomerInsuranceFields_1.syncCustomerInsuranceFields)(customerId);
        return {
            restoredAt: new Date().toISOString(),
            rowCounts: countsFor(payload),
        };
    }
};
exports.CustomerCheckpointService = CustomerCheckpointService;
exports.CustomerCheckpointService = CustomerCheckpointService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], CustomerCheckpointService);
//# sourceMappingURL=customer-checkpoint.service.js.map