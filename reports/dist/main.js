"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const auth_1 = require("@archaser/auth");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.use((0, cookie_parser_1.default)());
    (0, auth_1.enablePublicCors)(app);
    const config = new swagger_1.DocumentBuilder()
        .setTitle("Archaser Reports")
        .setDescription("Reports Nest microservice (public /api/reports)")
        .setVersion("0.1.0")
        .addBearerAuth()
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, config);
    swagger_1.SwaggerModule.setup("docs", app, document);
    const port = Number(process.env.REPORTS_PORT || 3006);
    await app.listen(port);
    if (typeof process.send === "function")
        process.send("ready");
}
bootstrap();
