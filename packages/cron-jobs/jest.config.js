/** @type {import('jest').Config} */
module.exports = {
    moduleFileExtensions: ["js", "json", "ts"],
    rootDir: ".",
    roots: ["<rootDir>/test"],
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
    moduleNameMapper: {
        "^\\.\\./src/(.*)$": "<rootDir>/src/$1",
    },
    testEnvironment: "node",
};
