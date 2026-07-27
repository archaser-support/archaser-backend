import type { Response } from "express";
import { DualAuthRequest } from "../auth/dual-auth.guard";
import { RealtimeHubService } from "./realtime-hub.service";
export declare class RealtimeWsController {
    private readonly hub;
    constructor(hub: RealtimeHubService);
    notifications(req: DualAuthRequest, res: Response, _accessToken?: string): void;
    controlCenter(req: DualAuthRequest, res: Response, _accessToken?: string): void;
}
