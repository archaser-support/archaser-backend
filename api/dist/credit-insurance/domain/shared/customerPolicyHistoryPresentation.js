"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveUserAuditDisplayName = resolveUserAuditDisplayName;
exports.resolveCustomerPolicyHistoryChipKind = resolveCustomerPolicyHistoryChipKind;
exports.buildPolicyHistoryHeaderAuditSegment = buildPolicyHistoryHeaderAuditSegment;
function resolveUserAuditDisplayName(user) {
    if (!user) {
        return null;
    }
    const fromName = user.name?.trim();
    if (fromName) {
        return fromName;
    }
    const fullName = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
    if (fullName) {
        return fullName;
    }
    const email = user.email?.trim();
    return email || null;
}
function resolveCustomerPolicyHistoryChipKind(args) {
    const inactive = args.inactiveInsurancePolicyId ?? null;
    const active = args.activeInsurancePolicyId ?? null;
    if (inactive === active) {
        return "previous_version";
    }
    return "previous_policy";
}
function buildPolicyHistoryHeaderAuditSegment(args) {
    if (args.modifiedAt == null ||
        args.modifiedAt === "" ||
        !args.modifiedByDisplayName?.trim()) {
        return null;
    }
    return `${args.formatDate(args.modifiedAt)} · ${args.modifiedByDisplayName.trim()}`;
}
//# sourceMappingURL=customerPolicyHistoryPresentation.js.map