import { Controller, Get, Header, Injectable, Module, Res } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { collectDefaultMetrics, Registry } from "prom-client";
import type { Response } from "express";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { InternalSmsController } from "./internal/internal-sms.controller";
import { SmsDomainModule } from "./sms/sms.module";

@Injectable()
class SmsMetrics {
    readonly register = new Registry();
    constructor() {
        collectDefaultMetrics({
            register: this.register,
            prefix: "archaser_sms_",
        });
    }
    text() {
        return this.register.metrics();
    }
}

@Controller()
class HealthController {
    constructor(private readonly metrics: SmsMetrics) {}

    @Get("health")
    health() {
        return { status: "ok", service: "archaser-sms" };
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
        SmsDomainModule,
    ],
    controllers: [HealthController, InternalSmsController],
    providers: [SmsMetrics],
})
export class AppModule {}
