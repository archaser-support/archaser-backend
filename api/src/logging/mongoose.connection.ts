import mongoose from "mongoose";

function getMongoDBUri(): string {
    return process.env.MONGODB_URI || "mongodb://localhost:27017/archaser";
}

const mongooseOptions = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
};

export async function ensureMongoConnection(): Promise<typeof mongoose> {
    if (mongoose.connection.readyState === 1) {
        return mongoose;
    }
    await mongoose.connect(getMongoDBUri(), mongooseOptions);
    return mongoose;
}

export { mongoose };
