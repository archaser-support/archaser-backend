/**
 * Pragmatic channel selection (matches Nest communication-intelligence controller).
 * Full historical ML CommunicationIntelligenceService is not ported; this uses
 * account flag + contact availability.
 */
export type PragmaticChannel = "Email" | "SMS" | "WhatsApp";

export function selectPragmaticChannel(input: {
    intelligentSelectionEnabled: boolean | null | undefined;
    activityType: string | null | undefined;
    contacts: Array<{
        email?: string | null;
        mobile?: string | null;
        communication_channel?: string | null;
    }>;
}): {
    selectedChannel: PragmaticChannel | string;
    reason: string;
    changed: boolean;
} {
    const current = (input.activityType || "Email") as string;
    if (!input.intelligentSelectionEnabled) {
        return {
            selectedChannel: current,
            reason: "intelligent_selection_disabled",
            changed: false,
        };
    }

    const preferredFromContact =
        input.contacts.find((c) => c.communication_channel)?.communication_channel ||
        null;

    if (preferredFromContact) {
        return {
            selectedChannel: preferredFromContact,
            reason: "nest_pragmatic_contact_channel",
            changed: preferredFromContact !== current,
        };
    }

    const hasEmail = input.contacts.some((c) => Boolean(c.email?.trim()));
    const hasMobile = input.contacts.some((c) => Boolean(c.mobile?.trim()));

    let selected: PragmaticChannel = "Email";
    if (current === "SMS" && hasMobile) {
        selected = "SMS";
    } else if (current === "Email" && hasEmail) {
        selected = "Email";
    } else if (hasEmail) {
        selected = "Email";
    } else if (hasMobile) {
        selected = "SMS";
    } else {
        selected = (current as PragmaticChannel) || "Email";
    }

    return {
        selectedChannel: selected,
        reason: "nest_pragmatic_default",
        changed: selected !== current,
    };
}
