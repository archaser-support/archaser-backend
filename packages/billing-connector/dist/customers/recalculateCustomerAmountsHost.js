"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.recalculateCustomerAmountsViaHost = recalculateCustomerAmountsViaHost;
const path = __importStar(require("path"));
/**
 * Resolves api customers domain (same layout as cron-jobs) so connector sync
 * can refresh denormalized due/overdue without a hard package dependency on api.
 */
function resolveCustomersDomainRoot() {
    if (process.env.CUSTOMERS_DOMAIN_ROOT?.trim()) {
        return path.resolve(process.env.CUSTOMERS_DOMAIN_ROOT.trim());
    }
    // packages/billing-connector/dist/customers → ../../../api/dist/customers
    return path.resolve(__dirname, "../../../api/dist/customers");
}
/**
 * Default post-ingest rollup refresh used when the host does not pass
 * onCustomerBalancesFinal (queue worker, scheduled sync, internal inline).
 */
async function recalculateCustomerAmountsViaHost(customerIds, prisma) {
    if (customerIds.length === 0) {
        return;
    }
    const full = path.join(resolveCustomersDomainRoot(), "domain/recalculateCustomerAmounts.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(full);
    await mod.recalculateCustomerAmounts(customerIds, prisma);
}
