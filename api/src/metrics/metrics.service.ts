import { Injectable, OnModuleInit } from "@nestjs/common";
import {
    collectDefaultMetrics,
    Counter,
    Histogram,
    Registry,
} from "prom-client";
import {
    createArchaserBusinessMetrics,
    type ArchaserBusinessMetrics,
} from "./archaser-business-metrics";
import { MetricsUpdaterService } from "./metrics-updater.service";
import {
    createBillingConnectorMetricsSinkFromProm,
    setDefaultBillingConnectorMetricsSink,
} from "@archaser/billing-connector";
import { setDefaultCronFrozenAccountMetrics } from "@archaser/cron-jobs";

@Injectable()
export class MetricsService implements OnModuleInit {
    readonly register = new Registry();

    readonly httpRequestCounter: Counter<string>;
    readonly httpRequestDuration: Histogram<string>;
    readonly business: ArchaserBusinessMetrics;

    constructor(private readonly updater: MetricsUpdaterService) {
        this.register.setDefaultLabels({ service: "archaser-api" });

        this.httpRequestCounter = new Counter({
            name: "nest_http_requests_total",
            help: "Total Nest HTTP requests",
            labelNames: ["method", "route", "status_code"],
            registers: [this.register],
        });

        this.httpRequestDuration = new Histogram({
            name: "nest_http_request_duration_seconds",
            help: "Nest HTTP request duration in seconds",
            labelNames: ["method", "route", "status_code"],
            buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
            registers: [this.register],
        });

        this.business = createArchaserBusinessMetrics(this.register);
        this.updater.bindMetrics(this.business);
        setDefaultBillingConnectorMetricsSink(
            createBillingConnectorMetricsSinkFromProm({
                syncTotal: this.business.billingConnectorSyncTotal,
                syncDuration: this.business.billingConnectorSyncDuration,
                errorsTotal: this.business.billingConnectorErrorsTotal,
                recordsProcessed: this.business.billingConnectorRecordsProcessed,
            })
        );
        setDefaultCronFrozenAccountMetrics({
            cronAccountsSkippedFrozenTotal:
                this.business.cronAccountsSkippedFrozenTotal,
        });
    }

    onModuleInit() {
        collectDefaultMetrics({
            register: this.register,
            prefix: "nest_",
        });
        // Prime gauges so the first Prometheus scrape is not empty.
        void this.updater.updateIfDue(true);
    }

    async metricsText(): Promise<string> {
        await this.updater.updateIfDue(false);
        return this.register.metrics();
    }
}
