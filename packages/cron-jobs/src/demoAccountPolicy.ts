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

function appEnvIsProduction(): boolean {
    const appEnv = (process.env.APP_ENV || "").toLowerCase();
    return appEnv === "production" || appEnv === "prod";
}

/**
 * Staging/preprod **and local/dev** — so Demo toggle, outreach mute, and
 * import catalog can be verified outside real production.
 *
 * `APP_ENV=production` (EC2 worker/api) always wins, even if leftover
 * localhost URLs are in `.env`. Nest `NODE_ENV=production` locally without
 * APP_ENV still Demo-gates when URLs point at localhost.
 */
export function isStagingDeploy(): boolean {
    if (appEnvIsProduction()) {
        return false;
    }
    const env = detectServerEnvironment();
    if (env === "preprod" || env === "localhost") {
        return true;
    }
    return envUrlLooksLocal();
}

/**
 * Production always sends customer Email/SMS. Staging/local send only when
 * the account has Demo ON.
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
