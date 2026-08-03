"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.freezeCustomerPolicyGapOnDeactivation = exports.syncCustomerPolicyGapAmountsForCustomer = exports.syncAllCustomerPolicyGapAmounts = exports.recomputeGapInBaseCurrencyForCustomer = exports.computeGapInBaseCurrency = void 0;
/**
 * @deprecated Import from syncCustomerPolicyGapAmounts instead.
 */
var syncCustomerPolicyGapAmounts_1 = require("./syncCustomerPolicyGapAmounts");
Object.defineProperty(exports, "computeGapInBaseCurrency", { enumerable: true, get: function () { return syncCustomerPolicyGapAmounts_1.computeGapInBaseCurrency; } });
Object.defineProperty(exports, "recomputeGapInBaseCurrencyForCustomer", { enumerable: true, get: function () { return syncCustomerPolicyGapAmounts_1.recomputeGapInBaseCurrencyForCustomer; } });
Object.defineProperty(exports, "syncAllCustomerPolicyGapAmounts", { enumerable: true, get: function () { return syncCustomerPolicyGapAmounts_1.syncAllCustomerPolicyGapAmounts; } });
Object.defineProperty(exports, "syncCustomerPolicyGapAmountsForCustomer", { enumerable: true, get: function () { return syncCustomerPolicyGapAmounts_1.syncCustomerPolicyGapAmountsForCustomer; } });
Object.defineProperty(exports, "freezeCustomerPolicyGapOnDeactivation", { enumerable: true, get: function () { return syncCustomerPolicyGapAmounts_1.freezeCustomerPolicyGapOnDeactivation; } });
