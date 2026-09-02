/**
 * Pragmatic channel selection (matches Nest communication-intelligence controller).
 * Full historical ML CommunicationIntelligenceService is not ported; this uses
 * account flag + contact availability.
 */
export type PragmaticChannel = "Email" | "SMS" | "WhatsApp";
export declare function selectPragmaticChannel(input: {
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
};
