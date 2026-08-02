import type { Response } from "express";
import { JwtPayload } from "../auth/auth.service";
import { ActivitiesService } from "./activities.service";
export declare class ActivityAttachmentsController {
    private readonly activities;
    constructor(activities: ActivitiesService);
    upload(user: JwtPayload, files: Array<{
        originalname: string;
        mimetype: string;
        size: number;
        buffer?: Buffer;
    }>, req: {
        body?: Record<string, unknown>;
    }): Promise<{
        success: boolean;
        attachments: {
            id: bigint;
            account_id: number;
            created_at: Date;
            modified_at: Date;
            activity_id: bigint;
            created_by: string | null;
            modified_by: string | null;
            file_name: string;
            file_path: string;
            file_size: number;
            file_type: string;
            file_category: import(".prisma/client").$Enums.attachment_category;
            uploaded_by: string;
        }[];
        count: number;
    }>;
    download(user: JwtPayload, id: string, res: Response): Promise<void | Response<any, Record<string, any>>>;
    remove(user: JwtPayload, id: string): Promise<{
        success: boolean;
    }>;
}
