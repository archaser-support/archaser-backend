import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
    Module,
    Controller,
    Get,
    Post,
    Body,
    Headers,
    Header,
    Res,
    Injectable,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { collectDefaultMetrics, Registry } from "prom-client";
import type { Response } from "express";

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
class SmsController {
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

    @Post("internal/send")
    send(@Body() body: unknown) {
        return { accepted: true, body };
    }

    @Post("internal/webhooks/:provider")
    webhook(
        @Headers() headers: Record<string, string>,
        @Body() body: unknown
    ) {
        return { recorded: true, headers, body };
    }
}

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [".env", "../.env"],
        }),
    ],
    controllers: [SmsController],
    providers: [SmsMetrics],
})
class SmsModule {}

async function bootstrap() {
    const app = await NestFactory.create(SmsModule);
    const port = Number(process.env.SMS_PORT || 3004);
    await app.listen(port);
    if (typeof process.send === "function") process.send("ready");
}

bootstrap();
