export default function syncBillingConnectorsJob(_customerId?: number, logCallback?: (message: string, level: "INFO" | "ERROR" | "WARNING" | "DEBUG", parameters?: Record<string, unknown>) => void, stepCollector?: {
    addStep: (step: string, message: string, level?: "INFO" | "ERROR" | "WARNING" | "DEBUG", parameters?: Record<string, unknown>, results?: Record<string, unknown>, duration?: number) => void;
}): Promise<{
    success: boolean;
    message: string;
    summary?: Record<string, unknown>;
    duration: number;
}>;
