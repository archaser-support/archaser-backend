import mongoose, { Schema, type Document, type Model } from "mongoose";

import { ensureMongoConnection } from "../syncHistory/mongooseConnection";
import type { CustomerScopedEntityCheckpoint } from "./customerScopedHistoryProgress";
import type {
    PendingCustomerHistoryQueueStore,
    PendingCustomerHistoryRow,
    PendingCustomerHistoryStatus,
} from "./pendingCustomerHistoryQueue";

interface IPendingCustomerHistoryDoc extends Document {
    connector_id: number;
    account_id: number;
    customer_id: number;
    customer_number: string;
    status: PendingCustomerHistoryStatus;
    attempt_count: number;
    last_error: string | null;
    entities: Record<string, CustomerScopedEntityCheckpoint>;
    enqueued_at: Date;
    updated_at: Date;
    last_attempt_at: Date | null;
    created_at: Date;
    modified_at: Date;
}

const PendingCustomerHistorySchema = new Schema(
    {
        connector_id: { type: Number, required: true },
        account_id: { type: Number, required: true, index: true },
        customer_id: { type: Number, required: true },
        customer_number: { type: String, required: true },
        status: {
            type: String,
            required: true,
            enum: ["pending", "in_progress", "needs_attention"],
            index: true,
        },
        attempt_count: { type: Number, required: true, default: 0 },
        last_error: { type: String, default: null },
        entities: { type: Schema.Types.Mixed, default: {} },
        enqueued_at: { type: Date, required: true, default: Date.now },
        updated_at: { type: Date, required: true, default: Date.now },
        last_attempt_at: { type: Date, default: null },
    },
    {
        timestamps: {
            createdAt: "created_at",
            updatedAt: "modified_at",
        },
        collection: "connector_pending_customer_history",
    }
);

PendingCustomerHistorySchema.index(
    { connector_id: 1, customer_id: 1 },
    { unique: true }
);
PendingCustomerHistorySchema.index({ connector_id: 1, status: 1 });

const PendingCustomerHistoryModel: Model<IPendingCustomerHistoryDoc> =
    (mongoose.models
        .ConnectorPendingCustomerHistory as Model<IPendingCustomerHistoryDoc>) ||
    mongoose.model<IPendingCustomerHistoryDoc>(
        "ConnectorPendingCustomerHistory",
        PendingCustomerHistorySchema
    );

function docToRow(doc: IPendingCustomerHistoryDoc): PendingCustomerHistoryRow {
    return {
        connector_id: doc.connector_id,
        account_id: doc.account_id,
        customer_id: doc.customer_id,
        customer_number: doc.customer_number,
        status: doc.status,
        attempt_count: doc.attempt_count ?? 0,
        last_error: doc.last_error ?? null,
        entities:
            doc.entities && typeof doc.entities === "object"
                ? { ...doc.entities }
                : {},
        enqueued_at: (doc.enqueued_at ?? new Date()).toISOString(),
        updated_at: (doc.updated_at ?? new Date()).toISOString(),
        last_attempt_at: doc.last_attempt_at
            ? doc.last_attempt_at.toISOString()
            : null,
    };
}

export function createMongoPendingCustomerHistoryQueueStore(): PendingCustomerHistoryQueueStore {
    return {
        async get(connectorId, customerId) {
            await ensureMongoConnection();
            const doc = await PendingCustomerHistoryModel.findOne({
                connector_id: connectorId,
                customer_id: customerId,
            }).exec();
            return doc ? docToRow(doc) : null;
        },
        async listByConnector(connectorId, statuses) {
            await ensureMongoConnection();
            const filter: Record<string, unknown> = {
                connector_id: connectorId,
            };
            if (statuses && statuses.length > 0) {
                filter.status = { $in: [...statuses] };
            }
            const docs = await PendingCustomerHistoryModel.find(filter)
                .sort({ customer_id: 1 })
                .exec();
            return docs.map(docToRow);
        },
        async save(row) {
            await ensureMongoConnection();
            const updatedAt = new Date(row.updated_at);
            const enqueuedAt = new Date(row.enqueued_at);
            const lastAttemptAt = row.last_attempt_at
                ? new Date(row.last_attempt_at)
                : null;
            await PendingCustomerHistoryModel.findOneAndUpdate(
                {
                    connector_id: row.connector_id,
                    customer_id: row.customer_id,
                },
                {
                    $set: {
                        account_id: row.account_id,
                        customer_number: row.customer_number,
                        status: row.status,
                        attempt_count: row.attempt_count,
                        last_error: row.last_error,
                        entities: row.entities,
                        enqueued_at: Number.isNaN(enqueuedAt.getTime())
                            ? new Date()
                            : enqueuedAt,
                        updated_at: Number.isNaN(updatedAt.getTime())
                            ? new Date()
                            : updatedAt,
                        last_attempt_at:
                            lastAttemptAt &&
                            !Number.isNaN(lastAttemptAt.getTime())
                                ? lastAttemptAt
                                : null,
                    },
                },
                { upsert: true, new: true }
            ).exec();
        },
        async delete(connectorId, customerId) {
            await ensureMongoConnection();
            await PendingCustomerHistoryModel.deleteOne({
                connector_id: connectorId,
                customer_id: customerId,
            }).exec();
        },
    };
}
