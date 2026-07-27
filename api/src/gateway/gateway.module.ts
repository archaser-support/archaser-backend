import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GatewayProxyService } from "./gateway-proxy.service";
import { GatewayPeelController } from "./gateway-peel.controller";

@Module({
    imports: [AuthModule],
    controllers: [GatewayPeelController],
    providers: [GatewayProxyService],
    exports: [GatewayProxyService],
})
export class GatewayModule {}
