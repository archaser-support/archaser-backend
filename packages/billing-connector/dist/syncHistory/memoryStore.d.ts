import { type SyncHistoryStore } from "./store";
import type { SyncHistoryExecution } from "./types";
/** In-memory store for unit tests (no Mongo required). */
export declare function createMemorySyncHistoryStore(): SyncHistoryStore & {
    reset(): void;
    all(): SyncHistoryExecution[];
};
