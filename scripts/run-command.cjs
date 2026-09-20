#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function applyAssignments(args) {
    const rest = [];
    let seenCommand = false;
    for (const arg of args) {
        if (!seenCommand && /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) {
            const eq = arg.indexOf("=");
            process.env[arg.slice(0, eq)] = arg.slice(eq + 1);
        } else {
            seenCommand = true;
            rest.push(arg);
        }
    }
    return rest;
}

function prependLocalBin() {
    const binDir = path.join(process.cwd(), "node_modules", ".bin");
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ""}`;
    return binDir;
}

function resolveCommand(command, binDir) {
    if (!command || path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
        return command;
    }

    if (process.platform === "win32") {
        for (const ext of [".cmd", ".exe", ".bat", ""]) {
            const candidate = path.join(binDir, `${command}${ext}`);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        if (command === "npm") return "npm.cmd";
        if (command === "npx") return "npx.cmd";
        if (command === "bash") {
            const gitBash = path.join(
                process.env.ProgramFiles || "C:\\Program Files",
                "Git",
                "bin",
                "bash.exe"
            );
            if (fs.existsSync(gitBash)) {
                return gitBash;
            }
        }
    }

    const unixBin = path.join(binDir, command);
    if (fs.existsSync(unixBin)) {
        return unixBin;
    }
    return command;
}

const [command, ...commandArgs] = applyAssignments(process.argv.slice(2));
if (!command) {
    console.error("Usage: node run-command.cjs [KEY=VALUE ...] <command> [...args]");
    process.exit(1);
}

const binDir = prependLocalBin();
const resolved = resolveCommand(command, binDir);
const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved);

const child = spawn(resolved, commandArgs, {
    stdio: "inherit",
    shell: useShell,
    env: process.env,
    windowsHide: true,
});

child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
    } else {
        process.exit(code ?? 0);
    }
});
