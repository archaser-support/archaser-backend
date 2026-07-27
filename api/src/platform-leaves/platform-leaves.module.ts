import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { PlatformLeavesController } from "./platform-leaves.controller";

@Module({
    imports: [DatabaseModule],
    controllers: [PlatformLeavesController],
})
export class PlatformLeavesModule {}
