export type EnvironmentType = "localhost" | "preprod" | "production" | "unknown";
/** Detect deploy environment for non-prod email subject prefixes (staging parity). */
export declare function detectServerEnvironment(): EnvironmentType;
export declare function getEmailSubjectPrefix(environment: EnvironmentType): string;
export declare function addEnvironmentPrefixToEmailSubject(subject: string): string;
