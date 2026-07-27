import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { EmailController } from "./email.controller";

@Module({
    imports: [DatabaseModule],
    controllers: [EmailController],
})
export class EmailModule {}
