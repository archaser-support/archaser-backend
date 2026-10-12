const RESOLUTION_ENUMS = [
    "Accepted_Settled_in_full",
    "Accepted_Settled_partly",
    "Admin_Fixed_Balance_Unchanged",
    "Cancelled",
    "Denied",
    "Accepted",
] as const;

const RESOLUTION_DB_LABELS: Record<string, string> = {
    "Accepted -  Settled in full": "Accepted_Settled_in_full",
    "Accepted - Settled partly": "Accepted_Settled_partly",
    "Admin Fixed – Balance Unchanged": "Admin_Fixed_Balance_Unchanged",
};

export type DisputeOutreachContactInput = {
    id: number;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    mobile: string | null;
    phone: string | null;
    role: string | null;
    receives_standard_reminder: boolean | null;
};

export type DisputeOutreachContact = {
    id: number | null;
    email: string;
    first_name: string;
    last_name: string;
    mobile: string;
    phone: string;
    role: string;
};

export function toDisputeResolutionI18nPlaceholder(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        return value;
    }
    const enumName =
        RESOLUTION_DB_LABELS[trimmed] ||
        (RESOLUTION_ENUMS.includes(trimmed as (typeof RESOLUTION_ENUMS)[number])
            ? trimmed
            : null);
    if (!enumName) {
        return value;
    }
    return `{{disputes.values.status_${enumName.toLowerCase()}}}`;
}

export function pickDisputeOutreachContact(args: {
    disputeEmail?: string | null;
    disputeFirstName?: string | null;
    disputeLastName?: string | null;
    disputeMobile?: string | null;
    contacts: DisputeOutreachContactInput[];
    customerEmail?: string | null;
}): DisputeOutreachContact | null {
    const disputeEmail = args.disputeEmail?.trim();
    if (disputeEmail) {
        const match = args.contacts.find(
            (contact) =>
                contact.email?.trim().toLowerCase() ===
                disputeEmail.toLowerCase()
        );
        return {
            id: match?.id ?? null,
            email: disputeEmail,
            first_name:
                match?.first_name || args.disputeFirstName || "",
            last_name: match?.last_name || args.disputeLastName || "",
            mobile:
                match?.mobile ||
                match?.phone ||
                args.disputeMobile ||
                "",
            phone: match?.phone || match?.mobile || "",
            role: match?.role || "",
        };
    }

    const withEmail = args.contacts.filter((contact) =>
        Boolean(contact.email?.trim())
    );
    const preferred =
        withEmail.find(
            (contact) => contact.receives_standard_reminder === true
        ) || withEmail[0];
    if (preferred?.email?.trim()) {
        return {
            id: preferred.id,
            email: preferred.email.trim(),
            first_name: preferred.first_name || "",
            last_name: preferred.last_name || "",
            mobile: preferred.mobile || preferred.phone || "",
            phone: preferred.phone || preferred.mobile || "",
            role: preferred.role || "",
        };
    }

    const customerEmail = args.customerEmail?.trim();
    if (!customerEmail) {
        return null;
    }
    return {
        id: null,
        email: customerEmail,
        first_name: args.disputeFirstName || "",
        last_name: args.disputeLastName || "",
        mobile: args.disputeMobile || "",
        phone: "",
        role: "",
    };
}
