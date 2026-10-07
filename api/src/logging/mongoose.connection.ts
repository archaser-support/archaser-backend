import mongoose from "mongoose";

function getMongoDBUri(): string {
    return process.env.MONGODB_URI || "mongodb://localhost:27017/archaser";
}

const mongooseOptions = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
};

export function isMongoConfigured(): boolean {
    return Boolean(process.env.MONGODB_URI?.trim());
}

export async function ensureMongoConnection(): Promise<typeof mongoose> {
    if (mongoose.connection.readyState === 1) {
        return mongoose;
    }
    // Stale connecting/disconnecting state after network blips → reset before retry.
    if (mongoose.connection.readyState !== 0) {
        try {
            await mongoose.disconnect();
        } catch {
            // ignore
        }
    }
    await mongoose.connect(getMongoDBUri(), mongooseOptions);
    return mongoose;
}

export { mongoose };
