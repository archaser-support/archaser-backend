export declare function isPresignableKey(filePath: unknown): filePath is string;
export declare function clampExpiry(expiresIn: unknown): number;
export declare function presignS3Object(filePath: string, expiresIn?: number): Promise<string | null>;
