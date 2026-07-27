import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { MetricsService } from "./metrics.service";

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
    constructor(private readonly metricsService: MetricsService) {}

    use(req: Request, res: Response, next: NextFunction): void {
        if (req.path === "/metrics" || req.path === "/health") {
            next();
            return;
        }

        const start = process.hrtime.bigint();
        const route = req.route?.path
            ? `${req.baseUrl || ""}${req.route.path}`
            : req.path;

        res.on("finish", () => {
            const elapsedNs = Number(process.hrtime.bigint() - start);
            const seconds = elapsedNs / 1e9;
            const labels = {
                method: req.method,
                route,
                status_code: String(res.statusCode),
            };
            this.metricsService.httpRequestCounter.inc(labels);
            this.metricsService.httpRequestDuration.observe(labels, seconds);
        });

        next();
    }
}
