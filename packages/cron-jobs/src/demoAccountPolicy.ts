import { detectServerEnvironment } from "./email/emailSubjectPrefix";

function envUrlLooksLocal(): boolean {
    const candidates = [
        process.env.NEST_PUBLIC_URL,
        process.env.NEXT_PUBLIC_NEST_API_BASE_URL,
        process.env.NEXTAUTH_URL,
        process.env.NEXT_PUBLIC_BASE_URL,
    ].filter((v): v is string => !!v);

    for (const raw of candidates) {
        try {
            const hostname = new URL(raw).hostname.toLowerCase();
            if (hostname === "localhost" || hostname === "127.0.0.1") {
                return true;
            }
        } catch {
            /* ignore invalid URLs */
        }
    }
    return false;
}

/**
 * Staging/preprod **and local/dev** — so Demo toggle, outreach mute, and
 * import catalog can be verified outside real production.
 *
 * Nest often runs with NODE_ENV=production locally; detectServerEnvironment
 * then returns "production" even when NEXTAUTH_URL is localhost. Treat those
 * local URLs as Demo-gated too.
 */
export function isStagingDeploy(): boolean {
    const env = detectServerEnvironment();
    if (env === "preprod" || env === "localhost") {
        return true;
    }
    return envUrlLooksLocal();
}

/**
 * Customer Email/SMS/WhatsApp may send when not on a Demo-gated deploy, or
 * when the account is marked Demo on staging/local.
 */
export function accountAllowsCustomerOutreach(isDemo: boolean): boolean {
    if (!isStagingDeploy()) {
        return true;
    }
    return isDemo === true;
}

/**
 * File-import permissions appear in the roles catalog only on staging/local
 * with Demo ON. Production never shows them.
 */
export function accountAllowsImportCatalog(isDemo: boolean): boolean {
    return isStagingDeploy() && isDemo === true;
}

/** Stable reason for skipped customer outreach when Demo is OFF on staging. */
export const DEMO_DISABLED_OUTREACH_REASON = "Demo disabled";
