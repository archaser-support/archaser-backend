"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mongoose = void 0;
exports.ensureMongoConnection = ensureMongoConnection;
const mongoose_1 = __importDefault(require("mongoose"));
exports.mongoose = mongoose_1.default;
function getMongoDBUri() {
    return process.env.MONGODB_URI || "mongodb://localhost:27017/archaser";
}
const mongooseOptions = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
};
async function ensureMongoConnection() {
    if (mongoose_1.default.connection.readyState === 1) {
        return mongoose_1.default;
    }
    await mongoose_1.default.connect(getMongoDBUri(), mongooseOptions);
    return mongoose_1.default;
}
//# sourceMappingURL=mongoose.connection.js.map