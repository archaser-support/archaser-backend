import { type OnModuleInit } from "@nestjs/common";
export declare class AppModule implements OnModuleInit {
    /**
     * Connector syncs triggered here (queue worker, nested account sync,
     * internal inline sync) pass no `onArPostIngest`, so they fall back to
     * `runArPostIngestViaHost`, which calls the registered orchestrator.
     * Without this the fallback would log "orchestrator is not registered"
     * and post-ingest AR refresh would silently stop in this process.
     */
    onModuleInit(): void;
}
