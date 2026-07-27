import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ReferenceDataController } from "./reference-data.controller";

@Module({
    imports: [DatabaseModule],
    controllers: [ReferenceDataController],
})
export class ReferenceDataModule {}
