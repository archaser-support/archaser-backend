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
exports.ConnectorSyncExecutionModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const ConnectorSyncExecutionSchema = new mongoose_1.Schema({
    execution_id: { type: String, required: true },
    connector_id: { type: Number, required: true, index: true },
    account_id: { type: Number, required: true, index: true },
    provider: { type: String, required: true },
    trigger: {
        type: String,
        required: true,
        enum: ["scheduled", "manual", "preview", "backfill"],
    },
    sync_mode: { type: String, required: true },
    status: {
        type: String,
        required: true,
        enum: ["RUNNING", "SUCCESS", "FAILED", "PARTIAL", "TIMEOUT"],
        index: true,
    },
    started_at: { type: Date, required: true, default: Date.now },
    completed_at: { type: Date, default: null },
    duration_seconds: { type: Number, default: null },
    // Mixed so `_maturity` may carry status / sample_errors on finish.
    entity_stats: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    error_message: { type: String, default: null },
    error_type: { type: String, default: null },
}, {
    timestamps: {
        createdAt: "created_at",
        updatedAt: "modified_at",
    },
    collection: "connector_sync_executions",
});
ConnectorSyncExecutionSchema.index({ execution_id: 1 }, { unique: true, sparse: true });
ConnectorSyncExecutionSchema.index({ connector_id: 1, started_at: -1 });
ConnectorSyncExecutionSchema.index({ account_id: 1, started_at: -1 });
ConnectorSyncExecutionSchema.index({ status: 1, started_at: 1 });
ConnectorSyncExecutionSchema.index({ started_at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
exports.ConnectorSyncExecutionModel = mongoose_1.default.models.ConnectorSyncExecution ||
    mongoose_1.default.model("ConnectorSyncExecution", ConnectorSyncExecutionSchema);
