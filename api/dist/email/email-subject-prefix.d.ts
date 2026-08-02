export type EnvironmentType = "localhost" | "preprod" | "production" | "unknown";
export declare function detectServerEnvironment(): EnvironmentType;
export declare function getEmailSubjectPrefix(environment: EnvironmentType): string;
export declare function addEnvironmentPrefixToEmailSubject(subject: string): string;
