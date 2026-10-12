/** @type {import('jest').Config} */
module.exports = {
    moduleFileExtensions: ["js", "json", "ts"],
    rootDir: ".",
    roots: ["<rootDir>/../../tests/backend/api"],
    testMatch: ["**/report*.test.ts", "**/reports*.test.ts"],
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
        "^@archaser/database$":
            "<rootDir>/../packages/database/src/index.ts",
        "^@archaser/auth$": "<rootDir>/../packages/auth/src/index.ts",
        "^@archaser/credit-insurance-domain$":
            "<rootDir>/../packages/credit-insurance-domain/src/index.ts",
    },
    testTimeout: 30000,
};
