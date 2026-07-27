import { Response } from "express";
import { MetricsService } from "./metrics.service";
export declare class MetricsController {
    private readonly metricsService;
    constructor(metricsService: MetricsService);
    metrics(res: Response): Promise<void>;
}
