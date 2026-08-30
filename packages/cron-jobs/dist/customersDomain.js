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
exports.recalculateCustomerAmountsViaApi = recalculateCustomerAmountsViaApi;
exports.calculateOutstandingAmountsForCustomersViaApi = calculateOutstandingAmountsForCustomersViaApi;
const path = __importStar(require("path"));
/**
 * Customer AR rollups still live in the api service (`api/src/customers/domain`)
 * and are reached by path. Unlike the credit-insurance domain, they have not
 * been extracted into a shared leaf package yet, so this loader is the last
 * remaining cross-service path require. See the slice 04 implementation notes.
 */
function resolveCustomersDomainRoot() {
    if (process.env.CUSTOMERS_DOMAIN_ROOT?.trim()) {
        return path.resolve(process.env.CUSTOMERS_DOMAIN_ROOT.trim());
    }
    // packages/cron-jobs/dist → ../../../api/dist/customers
    return path.resolve(__dirname, "../../../api/dist/customers");
}
function loadRecalculateCustomerAmounts() {
    const full = path.join(resolveCustomersDomainRoot(), "domain/recalculateCustomerAmounts.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(full);
}
async function recalculateCustomerAmountsViaApi(customerIds, prisma) {
    if (customerIds.length === 0) {
        return;
    }
    await loadRecalculateCustomerAmounts().recalculateCustomerAmounts(customerIds, prisma);
}
async function calculateOutstandingAmountsForCustomersViaApi(customerIds, prisma) {
    return loadRecalculateCustomerAmounts().calculateOutstandingAmountsForCustomers(customerIds, prisma);
}
