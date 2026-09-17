import { detectServerEnvironment } from "./email/emailSubjectPrefix";

/**
 * Staging / preprod deploy only. Local and production are not staging for
 * Demo-account gating (outreach mute + import catalog).
 */
export function isStagingDeploy(): boolean {
    return detectServerEnvironment() === "preprod";
}

/**
 * Customer Email/SMS/WhatsApp may send when not on staging, or when the
 * account is marked Demo on staging.
 */
export function accountAllowsCustomerOutreach(isDemo: boolean): boolean {
    if (!isStagingDeploy()) {
        return true;
    }
    return isDemo === true;
}

/**
 * File-import permissions appear in the roles catalog only on staging with
 * Demo ON. Outside staging they stay hidden.
 */
export function accountAllowsImportCatalog(isDemo: boolean): boolean {
    return isStagingDeploy() && isDemo === true;
}

/** Stable reason for skipped customer outreach when Demo is OFF on staging. */
export const DEMO_DISABLED_OUTREACH_REASON = "Demo disabled";
