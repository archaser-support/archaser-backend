export type CustomerPolicyHistoryChipKind =
    | "previous_policy"
    | "previous_version";

export type UserAuditDisplaySource = {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
} | null | undefined;

export function resolveUserAuditDisplayName(
    user: UserAuditDisplaySource
): string | null {
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

export function resolveCustomerPolicyHistoryChipKind(args: {
    inactiveInsurancePolicyId: number | null | undefined;
    activeInsurancePolicyId: number | null | undefined;
}): CustomerPolicyHistoryChipKind | null {
    const inactive = args.inactiveInsurancePolicyId ?? null;
    const active = args.activeInsurancePolicyId ?? null;
    if (inactive === active) {
        return "previous_version";
    }
    return "previous_policy";
}

export function buildPolicyHistoryHeaderAuditSegment(args: {
    modifiedAt: Date | string | null | undefined;
    modifiedByDisplayName: string | null | undefined;
    formatDate: (value: Date | string) => string;
}): string | null {
    if (
        args.modifiedAt == null ||
        args.modifiedAt === "" ||
        !args.modifiedByDisplayName?.trim()
    ) {
        return null;
    }
    return `${args.formatDate(args.modifiedAt)} · ${args.modifiedByDisplayName.trim()}`;
}
