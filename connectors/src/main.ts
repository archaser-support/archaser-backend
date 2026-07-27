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
class ConnectorsController {
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

    @Get("internal/accounts/:accountId/mappings")
    mappings(@Param("accountId") accountId: string) {
        return { accountId, mappings: [] };
    }

    @Post("internal/accounts/:accountId/sync")
    sync(@Param("accountId") accountId: string, @Body() body: unknown) {
        return { accountId, enqueued: true, body };
    }
}

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [".env", "../.env"],
        }),
    ],
    controllers: [ConnectorsController],
    providers: [ConnectorsMetrics],
})
class ConnectorsModule {}

async function bootstrap() {
    const app = await NestFactory.create(ConnectorsModule);
    const port = Number(process.env.CONNECTORS_PORT || 3005);
    await app.listen(port);
    if (typeof process.send === "function") process.send("ready");
}

bootstrap();
