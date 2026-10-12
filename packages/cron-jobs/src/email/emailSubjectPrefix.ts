export type EnvironmentType =
    | "localhost"
    | "preprod"
    | "production"
    | "unknown";

function envUrlCandidates(): string[] {
    return [
        process.env.NEST_PUBLIC_URL,
        process.env.NEXT_PUBLIC_NEST_API_BASE_URL,
        process.env.NEXTAUTH_URL,
        process.env.NEXT_PUBLIC_BASE_URL,
    ].filter((v): v is string => !!v);
}

/** True for hosts like staging.archaser.com or api.staging.archaser.com. */
export function hostnameLooksPreprod(hostname: string): boolean {
    const parts = hostname.toLowerCase().split(".").filter(Boolean);
    return (
        parts.includes("staging") ||
        parts.includes("preprod") ||
        parts.includes("dev")
    );
}

function serviceNameLooksPreprod(): boolean {
    const name = (process.env.SERVICE_NAME || "").toLowerCase();
    return (
        name.includes("staging") ||
        name.includes("preprod") ||
        name.includes("-dev")
    );
}

/** Detect deploy environment for non-prod email subject prefixes (staging parity). */
export function detectServerEnvironment(): EnvironmentType {
    const appEnv = (process.env.APP_ENV || "").toLowerCase();
    if (appEnv === "production" || appEnv === "prod") {
        return "production";
    }
    if (appEnv === "staging" || appEnv === "preprod") {
        return "preprod";
    }
    if (
        appEnv === "local" ||
        appEnv === "localhost" ||
        appEnv === "development"
    ) {
        return "localhost";
    }

    const nodeEnv = process.env.NODE_ENV;
    const isProduction = nodeEnv === "production";
    const serverPort = process.env.PORT;

    if (isProduction) {
        if (serverPort === "3001" || serviceNameLooksPreprod()) {
            return "preprod";
        }
        for (const raw of envUrlCandidates()) {
            try {
                const url = new URL(raw);
                if (url.port === "3001" || hostnameLooksPreprod(url.hostname)) {
                    return "preprod";
                }
            } catch {
                /* ignore */
            }
        }
        return "production";
    }

    if (nodeEnv === "development") {
        return "localhost";
    }

    for (const raw of envUrlCandidates()) {
        try {
            const url = new URL(raw);
            if (
                url.hostname === "localhost" ||
                url.hostname === "127.0.0.1"
            ) {
                return "localhost";
            }
        } catch {
            /* ignore */
        }
    }

    return "production";
}

export function getEmailSubjectPrefix(
    environment: EnvironmentType
): string {
    switch (environment) {
        case "localhost":
            return "[LOCAL] ";
        case "preprod":
            return "[PRE-PROD] ";
        case "production":
            return "";
        default:
            return "[UNKNOWN] ";
    }
}

export function addEnvironmentPrefixToEmailSubject(subject: string): string {
    return getEmailSubjectPrefix(detectServerEnvironment()) + subject;
}
