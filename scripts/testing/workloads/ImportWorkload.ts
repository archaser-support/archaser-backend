/**
 * Import Workload
 *
 * Executes import jobs for all import types using the import-job-runner.
 * Loops continuously for the full test duration.
 */

import { BaseWorkload, WorkloadConfig } from "./index";
import { AuthSession } from "../auth-helper";
import { ImportFileDescriptor } from "../generate-import-files";
import { runAllImportJobs, ImportJobResult } from "../import-job-runner";

export class ImportWorkload extends BaseWorkload {
    private session: AuthSession;
    private fileDescriptors: ImportFileDescriptor[];
    private runId: string;
    private importResults: ImportJobResult[] = [];
    private totalRecordsProcessed: number = 0;

    constructor(
        session: AuthSession,
        fileDescriptors: ImportFileDescriptor[],
        runId: string,
        config: WorkloadConfig = {}
    ) {
        super(config);
        this.session = session;
        this.fileDescriptors = fileDescriptors;
        this.runId = runId;
    }

    async start(stopSignal: { stop: boolean }): Promise<void> {
        const startTime = Date.now();
        const endTime = startTime + this.config.duration! * 1000;
        let cycleCount = 0;

        while (!stopSignal.stop && !this.stopped && Date.now() < endTime) {
            try {
                cycleCount++;
                // Run all import jobs (pass cycle number to make payment references unique)
                const results = await runAllImportJobs(
                    this.session,
                    this.fileDescriptors,
                    this.runId,
                    cycleCount
                );

                // Update metrics based on results
                for (const result of results) {
                    if (result.success) {
                        // Count each record as an operation for better metrics
                        this.totalRecordsProcessed += result.recordCount;
                        this.recordSuccess(0); // Duration not tracked in import jobs
                    } else {
                        this.recordFailure(result.error || "unknown", 0);
                    }
                }

                this.importResults.push(...results);

                // Add delay between import cycles to avoid overwhelming the system
                if (this.config.delay! > 0 && Date.now() < endTime) {
                    await new Promise((resolve) =>
                        setTimeout(resolve, this.config.delay!)
                    );
                }
            } catch (error: any) {
                this.recordFailure(error.message || String(error), 0);
            }
        }

        console.log(
            `[${this.runId}][${this.session.userId}] Import workload completed: ` +
                `${cycleCount} cycles, ${this.totalRecordsProcessed} records processed`
        );
    }

    getImportResults(): ImportJobResult[] {
        return [...this.importResults];
    }

    getTotalRecordsProcessed(): number {
        return this.totalRecordsProcessed;
    }

    getMetrics() {
        const baseMetrics = super.getMetrics();
        return {
            ...baseMetrics,
            recordsProcessed: this.totalRecordsProcessed,
        };
    }
}
