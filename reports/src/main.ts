import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.use(cookieParser());

    const config = new DocumentBuilder()
        .setTitle("Archaser Reports")
        .setDescription("Reports Nest microservice (public /api/reports)")
        .setVersion("0.1.0")
        .addBearerAuth()
        .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document);

    const port = Number(process.env.REPORTS_PORT || 3006);
    await app.listen(port);
    if (typeof process.send === "function") process.send("ready");
}

bootstrap();
