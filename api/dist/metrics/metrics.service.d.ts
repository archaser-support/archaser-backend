import { OnModuleInit } from "@nestjs/common";
import { Counter, Histogram, Registry } from "prom-client";
export declare class MetricsService implements OnModuleInit {
    readonly register: Registry<"text/plain; version=0.0.4; charset=utf-8">;
    readonly httpRequestCounter: Counter<string>;
    readonly httpRequestDuration: Histogram<string>;
    constructor();
    onModuleInit(): void;
    metricsText(): Promise<string>;
}
