/**
 * Priority-only provider gate (D68).
 */
export function assertPriorityProvider(provider: string): void {
    if (String(provider).toUpperCase() !== "PRIORITY") {
        throw new Error(
            `Only PRIORITY provider is supported in this phase. Got: ${provider}`
        );
    }
}
