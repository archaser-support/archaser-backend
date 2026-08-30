import {
    Controller,
    Get,
    Header,
    Injectable,
    Module,
    Res,
    type OnModuleInit,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { registerArPostIngestOrchestrator } from "@archaser/billing-connector";
import { runArPostIngestForCustomers } from "@archaser/cron-jobs";
import { collectDefaultMetrics, Registry } from "prom-client";
import type { Response } from "express";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { AccountsDomainModule } from "./accounts/accounts.module";
import { InternalConnectorsController } from "./internal/internal-connectors.controller";
import { SyncModule } from "./sync/sync.module";

@Injectable()
class ConnectorsMetrics {
    readonly register = new Registry();
    constructor() {
        collectDefaultMetrics({
            register: this.register,
            prefix: "archaser_connectors_",
        });
    }
    text() {
        return this.register.metrics();
    }
}

@Controller()
class HealthController {
    constructor(private readonly metrics: ConnectorsMetrics) {}

    @Get("health")
    health() {
        return { status: "ok", service: "archaser-connectors" };
    }

    @Get("metrics")
    @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
    async scrape(@Res() res: Response) {
        res.send(await this.metrics.text());
    }
}

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [".env", "../.env"],
        }),
        DatabaseModule,
        AuthModule,
        AccountsDomainModule,
        SyncModule,
    ],
    controllers: [HealthController, InternalConnectorsController],
    providers: [ConnectorsMetrics],
})
export class AppModule implements OnModuleInit {
    /**
     * Connector syncs triggered here (queue worker, nested account sync,
     * internal inline sync) pass no `onArPostIngest`, so they fall back to
     * `runArPostIngestViaHost`, which calls the registered orchestrator.
     * Without this the fallback would log "orchestrator is not registered"
     * and post-ingest AR refresh would silently stop in this process.
     */
    onModuleInit(): void {
        registerArPostIngestOrchestrator((options) =>
            runArPostIngestForCustomers(options)
        );
    }
}
