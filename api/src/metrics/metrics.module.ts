import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";
import { HttpMetricsMiddleware } from "./http-metrics.middleware";

@Module({
    controllers: [MetricsController],
    providers: [MetricsService],
    exports: [MetricsService],
})
export class MetricsModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(HttpMetricsMiddleware).forRoutes("*");
    }
}
