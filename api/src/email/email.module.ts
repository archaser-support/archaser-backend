import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../database/database.module";
import { LoggingModule } from "../logging/logging.module";
import { EmailController } from "./email.controller";
import { SystemEmailService } from "./system-email.service";

@Module({
    imports: [DatabaseModule, ConfigModule, LoggingModule],
    controllers: [EmailController],
    providers: [SystemEmailService],
    exports: [SystemEmailService],
})
export class EmailModule {}
