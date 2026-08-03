/**
 * Realistic Workload
 *
 * Simulates real user behavior:
 * - Opening dashboard (fetching dashboard data)
 * - Viewing customer details
 * - Logging activities (API calls similar to LogActivity component)
 * - Fetching customer activities
 */

import { BaseWorkload, WorkloadConfig } from "./index";
import { AuthSession } from "../auth-helper";
import { AxiosInstance } from "axios";
import { prisma } from "@/lib/prisma";

export class RealisticWorkload extends BaseWorkload {
    private session: AuthSession;
    private accountId: number;
    private customerIds: number[] = [];
    private customerUUIDs: string[] = [];

    constructor(
        session: AuthSession,
        accountId: number,
        config: WorkloadConfig = {}
    ) {
        super({
            ...config,
            delay: config.delay || 50, // Slightly longer delay for realistic operations
        });
        this.session = session;
        this.accountId = accountId;
    }

    async start(stopSignal: { stop: boolean }): Promise<void> {
        const startTime = Date.now();
        const endTime = startTime + this.config.duration! * 1000;

        // Pre-fetch customer IDs for this account
        await this.loadCustomerIds();

        while (
            !stopSignal.stop &&
            !this.stopped &&
            Date.now() < endTime &&
            this.metrics.operationsCompleted < this.config.maxOperations!
        ) {
            // Randomly choose an operation type
            const operationType = this.getRandomOperation();

            try {
                const result = await this.executeOperation(operationType);

                if (result.success) {
                    this.recordSuccess(result.duration);
                } else {
                    this.recordFailure(
                        result.error || "unknown",
                        result.duration
                    );
                }
            } catch (error: any) {
                this.recordFailure(error.message || String(error), 0);
            }

            // Delay between operations
            if (this.config.delay! > 0) {
                await new Promise((resolve) =>
                    setTimeout(resolve, this.config.delay!)
                );
            }
        }
    }

    private async loadCustomerIds(): Promise<void> {
        try {
            const customers = await prisma.customer.findMany({
                where: {
                    account_id: this.accountId,
                },
                select: {
                    id: true,
                    customer_uuid: true,
                },
                take: 50, // Limit to 50 customers for performance
            });

            this.customerIds = customers.map((c) => c.id);
            this.customerUUIDs = customers
                .map((c) => c.customer_uuid || "")
                .filter(Boolean);
        } catch (error) {
            console.warn(
                `[RealisticWorkload] Failed to load customer IDs: ${error}`
            );
        }
    }

    private getRandomOperation():
        | "dashboard"
        | "customer_list"
        | "customer_details"
        | "log_activity"
        | "activities" {
        const operations: Array<
            | "dashboard"
            | "customer_list"
            | "customer_details"
            | "log_activity"
            | "activities"
        > = [
                "dashboard",
                "customer_list",
                "customer_details",
                "log_activity",
                "activities",
            ];
        return operations[Math.floor(Math.random() * operations.length)];
    }

    private async executeOperation(
        operation:
            | "dashboard"
            | "customer_list"
            | "customer_details"
            | "log_activity"
            | "activities"
    ): Promise<{ success: boolean; duration: number; error?: string }> {
        const startTime = Date.now();

        try {
            switch (operation) {
                case "dashboard":
                    // Simulate opening dashboard
                    await this.session.client.get(
                        "/api/system/dashboard?viewMode=child"
                    );
                    break;

                case "customer_list":
                    // Simulate fetching customer list
                    await this.session.client.get(
                        "/api/entities/customers?page=1&limit=20"
                    );
                    break;

                case "customer_details":
                    // Simulate viewing customer details
                    if (this.customerUUIDs.length > 0) {
                        const randomUUID =
                            this.customerUUIDs[
                            Math.floor(
                                Math.random() * this.customerUUIDs.length
                            )
                            ];
                        await this.session.client.get(
                            `/api/entities/customers/${randomUUID}`
                        );
                    } else {
                        // Fallback to customer list if no UUIDs available
                        await this.session.client.get(
                            "/api/entities/customers?page=1&limit=20"
                        );
                    }
                    break;

                case "log_activity":
                    // Simulate logging an activity (similar to LogActivity component)
                    if (this.customerIds.length > 0) {
                        const randomCustomerId =
                            this.customerIds[
                            Math.floor(
                                Math.random() * this.customerIds.length
                            )
                            ];
                        await this.session.client.post(
                            `/api/entities/customers/${randomCustomerId}/activity/log-call-activity`,
                            {
                                notes: "Test activity from stress test",
                                call_outcome: "general",
                                duration: 60,
                                call_direction: "outgoing",
                            }
                        );
                    } else {
                        // Skip if no customers available
                        return { success: true, duration: 0 };
                    }
                    break;

                case "activities":
                    // Simulate fetching customer activities
                    if (this.customerIds.length > 0) {
                        const randomCustomerId =
                            this.customerIds[
                            Math.floor(
                                Math.random() * this.customerIds.length
                            )
                            ];
                        await this.session.client.get(
                            `/api/entities/customers/${randomCustomerId}/activity?limit=10`
                        );
                    } else {
                        // Skip if no customers available
                        return { success: true, duration: 0 };
                    }
                    break;
            }

            const duration = Date.now() - startTime;
            return { success: true, duration };
        } catch (error: any) {
            const duration = Date.now() - startTime;
            const errorMessage = error.message || String(error);

            // Categorize errors
            if (
                errorMessage.includes("timeout") ||
                errorMessage.includes("pool") ||
                errorMessage.includes("connection") ||
                error?.response?.status === 503
            ) {
                return {
                    success: false,
                    duration,
                    error: "connection_pool",
                };
            }

            // Don't fail on 404s (customer might not exist)
            if (error?.response?.status === 404) {
                return { success: true, duration };
            }

            return {
                success: false,
                duration,
                error: `other: ${errorMessage} (${operation})`,
            };
        }
    }
}
