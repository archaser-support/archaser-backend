import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { enablePublicCors } from "@archaser/auth";
import { AppModule } from "./app.module";

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.use(cookieParser());
    enablePublicCors(app);

    const config = new DocumentBuilder()
        .setTitle("Archaser SMS")
        .setDescription("SMS Nest microservice (public /api/sms + /internal)")
        .setVersion("0.1.0")
        .addBearerAuth()
        .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document);

    const port = Number(process.env.SMS_PORT || 3004);
    await app.listen(port);
    if (typeof process.send === "function") process.send("ready");
}

bootstrap();
