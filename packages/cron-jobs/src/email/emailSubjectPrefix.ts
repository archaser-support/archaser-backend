export type EnvironmentType =
    | "localhost"
    | "preprod"
    | "production"
    | "unknown";

/** Detect deploy environment for non-prod email subject prefixes (staging parity). */
export function detectServerEnvironment(): EnvironmentType {
    const nodeEnv = process.env.NODE_ENV;
    const isProduction = nodeEnv === "production";
    const serverPort = process.env.PORT;

    if (isProduction) {
        if (serverPort === "3001") {
            return "preprod";
        }
        if (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL) {
            try {
                const url = new URL(
                    process.env.NEXTAUTH_URL ||
                        process.env.NEXT_PUBLIC_BASE_URL ||
                        ""
                );
                const hostname = url.hostname;
                const urlPort = url.port;
                if (
                    urlPort === "3001" ||
                    hostname.startsWith("preprod.") ||
                    hostname === "preprod" ||
                    hostname.startsWith("staging.") ||
                    hostname === "staging"
                ) {
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

    if (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL) {
        try {
            const url = new URL(
                process.env.NEXTAUTH_URL ||
                    process.env.NEXT_PUBLIC_BASE_URL ||
                    ""
            );
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
