import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ErrorsController } from "./errors.controller";

@Module({
    imports: [DatabaseModule],
    controllers: [ErrorsController],
})
export class ErrorsModule {}
