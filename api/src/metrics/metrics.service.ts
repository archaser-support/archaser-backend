import { Injectable, OnModuleInit } from "@nestjs/common";
import {
    collectDefaultMetrics,
    Counter,
    Histogram,
    Registry,
} from "prom-client";

@Injectable()
export class MetricsService implements OnModuleInit {
    readonly register = new Registry();

    readonly httpRequestCounter: Counter<string>;
    readonly httpRequestDuration: Histogram<string>;

    constructor() {
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
    }

    onModuleInit() {
        collectDefaultMetrics({
            register: this.register,
            prefix: "nest_",
        });
    }

    async metricsText(): Promise<string> {
        return this.register.metrics();
    }
}
