/**
 * Workload Interfaces for Stress Tests
 *
 * Defines pluggable workload types that can be executed by users
 * during stress tests.
 */

export interface WorkloadMetrics {
    operationsCompleted: number;
    operationsFailed: number;
    responseTimes: number[];
    errors: Array<{ time: Date; error: string }>;
    recordsProcessed?: number; // For import workloads - tracks actual records imported
}

export interface UserWorkload {
    /**
     * Start the workload
     * @param stopSignal Signal to stop the workload
     * @returns Promise that resolves when workload completes
     */
    start(stopSignal: { stop: boolean }): Promise<void>;

    /**
     * Get current metrics
     */
    getMetrics(): WorkloadMetrics;

    /**
     * Stop the workload gracefully
     */
    stop(): Promise<void>;
}

export interface WorkloadConfig {
    duration?: number; // Duration in seconds
    maxOperations?: number; // Maximum operations to perform
    delay?: number; // Delay between operations in ms (default: 25ms)
    parallelOps?: number; // Number of parallel operations per user (default: 1)
}

/**
 * Base workload implementation with common functionality
 */
export abstract class BaseWorkload implements UserWorkload {
    protected metrics: WorkloadMetrics = {
        operationsCompleted: 0,
        operationsFailed: 0,
        responseTimes: [],
        errors: [],
    };

    protected config: WorkloadConfig;
    protected stopped: boolean = false;

    constructor(config: WorkloadConfig = {}) {
        this.config = {
            duration: config.duration || 60,
            maxOperations: config.maxOperations || 1000,
            delay: config.delay || 25, // Reduced from 100ms to 25ms for better throughput
            parallelOps: config.parallelOps || 1,
            ...config,
        };
    }

    abstract start(stopSignal: { stop: boolean }): Promise<void>;

    getMetrics(): WorkloadMetrics {
        return { ...this.metrics };
    }

    async stop(): Promise<void> {
        this.stopped = true;
    }

    protected recordSuccess(duration: number): void {
        this.metrics.operationsCompleted++;
        this.metrics.responseTimes.push(duration);
    }

    protected recordFailure(error: string, duration: number): void {
        this.metrics.operationsFailed++;
        this.metrics.responseTimes.push(duration);
        this.metrics.errors.push({
            time: new Date(),
            error,
        });
    }
}
