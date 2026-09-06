const path = require("path");
const fs = require("fs");

/**
 * Returns an array of environment file paths to load in order of preference.
 * Cascades: .env.[env].local -> .env.[env] -> .env.local -> .env
 * Also includes parent directory paths (../.env...) for monorepo services.
 *
 * @param {string} [baseDir=process.cwd()]
 * @returns {string[]}
 */
function getEnvFilePaths(baseDir = process.cwd()) {
    const env = process.env.APP_ENV || process.env.NODE_ENV;
    const paths = [];

    if (env && env !== "development" && env !== "production" && env !== "test") {
        paths.push(
            path.resolve(baseDir, `.env.${env}.local`),
            path.resolve(baseDir, `.env.${env}`)
        );
    } else if (env) {
        paths.push(
            path.resolve(baseDir, `.env.${env}.local`),
            path.resolve(baseDir, `.env.${env}`)
        );
    }

    paths.push(
        path.resolve(baseDir, ".env.local"),
        path.resolve(baseDir, ".env")
    );

    // Parent directory fallbacks for workspace services (api, worker, sms, etc.)
    const parentDir = path.resolve(baseDir, "..");
    if (env) {
        paths.push(
            path.resolve(parentDir, `.env.${env}.local`),
            path.resolve(parentDir, `.env.${env}`)
        );
    }
    paths.push(
        path.resolve(parentDir, ".env.local"),
        path.resolve(parentDir, ".env")
    );

    return paths;
}

module.exports = { getEnvFilePaths };
