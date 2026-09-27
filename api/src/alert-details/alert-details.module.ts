import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AlertDetailsController } from "./alert-details.controller";
import { AlertDetailsService } from "./alert-details.service";

@Module({
    imports: [DatabaseModule],
    controllers: [AlertDetailsController],
    providers: [AlertDetailsService],
    exports: [AlertDetailsService],
})
export class AlertDetailsModule {}
