import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealtimeHubService } from "./realtime-hub.service";
import { RealtimeWsController } from "./realtime-ws.controller";

@Module({
    imports: [AuthModule],
    controllers: [RealtimeWsController],
    providers: [RealtimeHubService],
    exports: [RealtimeHubService],
})
export class RealtimeModule {}
