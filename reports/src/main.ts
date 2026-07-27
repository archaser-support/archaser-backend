import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
    Module,
    Controller,
    Get,
    Post,
    Body,
    Param,
    Header,
    Injectable,
    Res,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { collectDefaultMetrics, Registry } from "prom-client";
import type { Response } from "express";

@Injectable()
class ReportsMetrics {
    readonly register = new Registry();
    constructor() {
        collectDefaultMetrics({
            register: this.register,
            prefix: "archaser_reports_",
        });
    }
    text() {
        return this.register.metrics();
    }
}

@Controller()
class ReportsController {
    constructor(private readonly metrics: ReportsMetrics) {}

    @Get("health")
    health() {
        return { status: "ok", service: "archaser-reports" };
    }

    @Get("metrics")
    @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
    async scrape(@Res() res: Response) {
        res.send(await this.metrics.text());
    }

    @Post("internal/reports/:id/execute")
    execute(@Param("id") id: string, @Body() body: unknown) {
        return { id, status: "queued", body };
    }

    @Post("internal/reports/:id/schedule")
    schedule(@Param("id") id: string, @Body() body: unknown) {
        return { id, scheduled: true, body };
    }
}

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [".env", "../.env"],
        }),
    ],
    controllers: [ReportsController],
    providers: [ReportsMetrics],
})
class ReportsModule {}

async function bootstrap() {
    const app = await NestFactory.create(ReportsModule);
    const port = Number(process.env.REPORTS_PORT || 3006);
    await app.listen(port);
    if (typeof process.send === "function") process.send("ready");
}

bootstrap();
