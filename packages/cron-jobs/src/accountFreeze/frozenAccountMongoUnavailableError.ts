/** Thrown when MONGODB_URI is set but RUNNING sync lookup cannot reach Mongo. */
export class FrozenAccountMongoUnavailableError extends Error {
    constructor(cause: unknown) {
        const detail =
            cause instanceof Error ? cause.message : String(cause);
        super(
            `Account freeze requires Mongo RUNNING sync lookup but Mongo is unavailable: ${detail}`
        );
        this.name = "FrozenAccountMongoUnavailableError";
    }
}
