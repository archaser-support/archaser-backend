"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectPragmaticChannel = selectPragmaticChannel;
function selectPragmaticChannel(input) {
    const current = (input.activityType || "Email");
    if (!input.intelligentSelectionEnabled) {
        return {
            selectedChannel: current,
            reason: "intelligent_selection_disabled",
            changed: false,
        };
    }
    const preferredFromContact = input.contacts.find((c) => c.communication_channel)?.communication_channel ||
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
    let selected = "Email";
    if (current === "SMS" && hasMobile) {
        selected = "SMS";
    }
    else if (current === "Email" && hasEmail) {
        selected = "Email";
    }
    else if (hasEmail) {
        selected = "Email";
    }
    else if (hasMobile) {
        selected = "SMS";
    }
    else {
        selected = current || "Email";
    }
    return {
        selectedChannel: selected,
        reason: "nest_pragmatic_default",
        changed: selected !== current,
    };
}
