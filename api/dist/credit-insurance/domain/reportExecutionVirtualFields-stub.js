"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAccountDisplayLanguage = resolveAccountDisplayLanguage;
function resolveAccountDisplayLanguage(_accountLanguage) {
    return typeof _accountLanguage === "string" && _accountLanguage.trim()
        ? _accountLanguage.trim()
        : "en";
}
//# sourceMappingURL=reportExecutionVirtualFields-stub.js.map