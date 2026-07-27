import { JwtPayload } from "../auth/auth.service";
export declare class UploadController {
    s3(user: JwtPayload, body: Record<string, unknown>): Promise<{
        success: boolean;
        bucket: string;
        region: string;
        key: string;
        contentType: string;
        uploadUrl: string;
        publicUrl: string;
        stub: boolean;
        message?: undefined;
    } | {
        success: boolean;
        key: string;
        contentType: string;
        uploadUrl: string;
        publicUrl: string;
        stub: boolean;
        message: string;
        bucket?: undefined;
        region?: undefined;
    }>;
}
