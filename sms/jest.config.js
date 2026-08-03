/** @type {import('jest').Config} */
module.exports = {
    moduleFileExtensions: ["js", "json", "ts"],
    rootDir: ".",
    testRegex: "test/.*\\.test\\.ts$",
    transform: {
        "^.+\\.(t|j)s$": [
            "ts-jest",
            {
                tsconfig: "<rootDir>/tsconfig.json",
            },
        ],
    },
    testEnvironment: "node",
    moduleNameMapper: {
        "^@archaser/database$":
            "<rootDir>/../packages/database/src/index.ts",
        "^@archaser/sms-send$":
            "<rootDir>/../packages/sms-send/src/index.ts",
        "^@archaser/auth$":
            "<rootDir>/../packages/auth/src/index.ts",
    },
    testTimeout: 30000,
};
