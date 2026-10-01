import mongoose, { Schema, type Document, type Model } from "mongoose";

import { ensureMongoConnection } from "../syncHistory/mongooseConnection";
import type {
    CustomerScopedEntityCheckpoint,
    CustomerScopedHistoryProgress,
    CustomerScopedHistoryProgressStore,
} from "./customerScopedHistoryProgress";

interface ICustomerScopedHistoryProgressDoc extends Document {
    connector_id: number;
    account_id: number;
    customer_id: number;
    customer_number: string;
    entities: Record<string, CustomerScopedEntityCheckpoint>;
    updated_at: Date;
    created_at: Date;
    modified_at: Date;
}

const CustomerScopedHistoryProgressSchema = new Schema(
    {
        connector_id: { type: Number, required: true },
        account_id: { type: Number, required: true, index: true },
        customer_id: { type: Number, required: true },
        customer_number: { type: String, required: true },
        entities: { type: Schema.Types.Mixed, default: {} },
        updated_at: { type: Date, required: true, default: Date.now },
    },
    {
        timestamps: {
            createdAt: "created_at",
            updatedAt: "modified_at",
        },
        collection: "connector_customer_history_progress",
    }
);

CustomerScopedHistoryProgressSchema.index(
    { connector_id: 1 },
    { unique: true }
);

const CustomerScopedHistoryProgressModel: Model<ICustomerScopedHistoryProgressDoc> =
    (mongoose.models
        .ConnectorCustomerHistoryProgress as Model<ICustomerScopedHistoryProgressDoc>) ||
    mongoose.model<ICustomerScopedHistoryProgressDoc>(
        "ConnectorCustomerHistoryProgress",
        CustomerScopedHistoryProgressSchema
    );

function docToProgress(
    doc: ICustomerScopedHistoryProgressDoc
): CustomerScopedHistoryProgress {
    return {
        connector_id: doc.connector_id,
        account_id: doc.account_id,
        customer_id: doc.customer_id,
        customer_number: doc.customer_number,
        entities:
            doc.entities && typeof doc.entities === "object"
                ? { ...doc.entities }
                : {},
        updated_at: (doc.updated_at ?? new Date()).toISOString(),
    };
}

export function createMongoCustomerScopedHistoryProgressStore(): CustomerScopedHistoryProgressStore {
    return {
        async get(connectorId) {
            await ensureMongoConnection();
            const doc = await CustomerScopedHistoryProgressModel.findOne({
                connector_id: connectorId,
            }).exec();
            return doc ? docToProgress(doc) : null;
        },
        async save(progress) {
            await ensureMongoConnection();
            const updatedAt = new Date(progress.updated_at);
            await CustomerScopedHistoryProgressModel.findOneAndUpdate(
                { connector_id: progress.connector_id },
                {
                    $set: {
                        account_id: progress.account_id,
                        customer_id: progress.customer_id,
                        customer_number: progress.customer_number,
                        entities: progress.entities,
                        updated_at: Number.isNaN(updatedAt.getTime())
                            ? new Date()
                            : updatedAt,
                    },
                },
                { upsert: true, new: true }
            ).exec();
        },
        async clear(connectorId) {
            await ensureMongoConnection();
            await CustomerScopedHistoryProgressModel.deleteOne({
                connector_id: connectorId,
            }).exec();
        },
    };
}
