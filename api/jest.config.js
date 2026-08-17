/** @type {import('jest').Config} */
module.exports = {
    moduleFileExtensions: ["js", "json", "ts"],
    rootDir: ".",
    roots: ["<rootDir>/../../tests/backend/api", "<rootDir>/test"],
    testMatch: ["**/*.test.ts"],
    transform: {
        "^.+\\.(t|j)s$": [
            "ts-jest",
            {
                tsconfig: "<rootDir>/tsconfig.json",
                isolatedModules: true,
                diagnostics: {
                    ignoreCodes: [151001],
                },
            },
        ],
    },
    testEnvironment: "node",
    modulePaths: ["<rootDir>/node_modules", "<rootDir>/../node_modules"],
    moduleNameMapper: {
        "^\\.\\./src/(.*)$": "<rootDir>/src/$1",
        "^\\.\\./\\.\\./\\.\\./connectors/src/(.*)$": "<rootDir>/../connectors/src/$1",
        "^@archaser/database$":
            "<rootDir>/../packages/database/src/index.ts",
        "^@archaser/billing-connector$":
            "<rootDir>/../packages/billing-connector/src/index.ts",
    },
    testTimeout: 30000,
};
