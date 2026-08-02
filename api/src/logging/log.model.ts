import mongoose, { Document, Model, Schema } from "mongoose";
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

const LogSchema = new Schema(
    {
        timestamp: { type: Date, required: true, default: Date.now },
        level: {
            type: String,
            required: true,
            enum: Object.values(LogLevel),
            index: true,
        },
        message: { type: String, required: true },
        source: { type: String, required: true, index: true },
        details: { type: Schema.Types.Mixed, default: null },
        account_id: { type: Number, index: true, sparse: true },
        user_id: { type: Number, index: true, sparse: true },
        job_id: { type: Number, index: true, sparse: true },
        correlation_id: { type: String, index: true, sparse: true },
        sub_source: { type: String, sparse: true },
    },
    {
        timestamps: {
            createdAt: "created_at",
            updatedAt: "modified_at",
        },
        collection: "logs",
    }
);

LogSchema.index({ source: 1, timestamp: -1 });

export const Log: Model<ILog> =
    (mongoose.models.Log as Model<ILog>) ||
    mongoose.model<ILog>("Log", LogSchema);
