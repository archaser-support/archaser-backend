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
};
