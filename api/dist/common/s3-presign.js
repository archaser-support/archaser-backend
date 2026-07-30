"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPresignableKey = isPresignableKey;
exports.clampExpiry = clampExpiry;
exports.presignS3Object = presignS3Object;
const SAFE_OBJECT_KEY = /^[a-zA-Z0-9/\-_.]+$/;
const MIN_EXPIRY_SECONDS = 60;
const MAX_EXPIRY_SECONDS = 86400;
function isPresignableKey(filePath) {
    return typeof filePath === "string" && SAFE_OBJECT_KEY.test(filePath);
}
function clampExpiry(expiresIn) {
    return Math.min(Math.max(Number(expiresIn) || 3600, MIN_EXPIRY_SECONDS), MAX_EXPIRY_SECONDS);
}
function s3Config() {
    const bucket = process.env.NEXT_APP_AWS_S3_BUCKET_NAME ||
        process.env.AWS_S3_BUCKET ||
        process.env.S3_BUCKET;
    const accessKeyId = process.env.NEXT_APP_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.NEXT_APP_AWS_SECRET_ACCESS_KEY ||
        process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || process.env.S3_REGION || "us-east-1";
    if (!bucket || !accessKeyId || !secretAccessKey) {
        return null;
    }
    return { bucket, region, accessKeyId, secretAccessKey };
}
async function presignS3Object(filePath, expiresIn = 3600) {
    if (!isPresignableKey(filePath)) {
        return null;
    }
    const config = s3Config();
    if (!config) {
        return null;
    }
    try {
        const { S3Client, GetObjectCommand } = await Promise.resolve().then(() => __importStar(require("@aws-sdk/client-s3")));
        const { getSignedUrl } = await Promise.resolve().then(() => __importStar(require("@aws-sdk/s3-request-presigner")));
        const client = new S3Client({
            region: config.region,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        });
        const key = filePath.replace(/^s3:\/\//, "").replace(/^\/+/, "");
        return await getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn: clampExpiry(expiresIn) });
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=s3-presign.js.map