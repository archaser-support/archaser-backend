/**
 * Server-side S3 presigning.
 *
 * Anonymous surfaces (the customer portal) cannot call the authenticated
 * attachments presign endpoint, and exposing that endpoint publicly would let
 * anyone sign an arbitrary object key. So those surfaces sign server-side and
 * hand the browser a ready-to-use URL instead.
 */

/** Object keys we are willing to sign. Mirrors the attachments API allow-list. */
const SAFE_OBJECT_KEY = /^[a-zA-Z0-9/\-_.]+$/;

const MIN_EXPIRY_SECONDS = 60;
const MAX_EXPIRY_SECONDS = 86400;

export function isPresignableKey(filePath: unknown): filePath is string {
    return typeof filePath === "string" && SAFE_OBJECT_KEY.test(filePath);
}

export function clampExpiry(expiresIn: unknown): number {
    return Math.min(
        Math.max(Number(expiresIn) || 3600, MIN_EXPIRY_SECONDS),
        MAX_EXPIRY_SECONDS
    );
}

function s3Config() {
    const bucket =
        process.env.NEXT_APP_AWS_S3_BUCKET_NAME ||
        process.env.AWS_S3_BUCKET ||
        process.env.S3_BUCKET;
    const accessKeyId =
        process.env.NEXT_APP_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey =
        process.env.NEXT_APP_AWS_SECRET_ACCESS_KEY ||
        process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || process.env.S3_REGION || "us-east-1";

    if (!bucket || !accessKeyId || !secretAccessKey) {
        return null;
    }
    return { bucket, region, accessKeyId, secretAccessKey };
}

/**
 * Returns a presigned GET URL, or null when S3 is not configured or signing
 * fails — callers decide their own fallback rather than getting a broken URL.
 */
export async function presignS3Object(
    filePath: string,
    expiresIn = 3600
): Promise<string | null> {
    if (!isPresignableKey(filePath)) {
        return null;
    }
    const config = s3Config();
    if (!config) {
        return null;
    }

    try {
        const { S3Client, GetObjectCommand } = await import(
            "@aws-sdk/client-s3"
        );
        const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
        const client = new S3Client({
            region: config.region,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        });
        const key = filePath.replace(/^s3:\/\//, "").replace(/^\/+/, "");
        return await getSignedUrl(
            client,
            new GetObjectCommand({ Bucket: config.bucket, Key: key }),
            { expiresIn: clampExpiry(expiresIn) }
        );
    } catch {
        return null;
    }
}
