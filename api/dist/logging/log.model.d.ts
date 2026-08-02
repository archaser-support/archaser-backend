import mongoose, { Document, Model } from "mongoose";
import { LogLevel } from "./mongo-log.types";
export interface ILog extends Document {
    _id: mongoose.Types.ObjectId;
    timestamp: Date;
    level: LogLevel;
    message: string;
    source: string;
    details?: unknown;
    account_id?: number;
    user_id?: number;
    job_id?: number;
    correlation_id?: string;
    sub_source?: string;
    created_at: Date;
    modified_at: Date;
}
export declare const Log: Model<ILog>;
