#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
node -e '
const fs = require("fs");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const SECRET_PATH = /(^|[/\\])(\.env([.][^/\\]*)?|.*\.(pem|key|p12|pfx)|id_rsa|credentials\.json|aws-credentials)([/\\]|$)/i;
const SECRET_SHELL = /(^|[\s"`'"'"'=<>|&;])(\.env([.][\w.-]*)?|[^/\s"`'"'"']*\.(pem|key|p12|pfx)|id_rsa|credentials\.json|aws-credentials)([\s"`'"'"'=<>|&;]|$)/i;
function deny(reason) {
  process.stdout.write(JSON.stringify({ permission: "deny", user_message: reason, agent_message: reason }));
  process.exit(0);
}
function allow() {
  process.stdout.write(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}
const command = String(input.command ?? "");
const filePath = String(input.file_path ?? input.path ?? input.tool_input?.path ?? "");
if (filePath && SECRET_PATH.test(filePath.replace(/\\/g, "/"))) {
  deny("Blocked: agents must not read or write secret files (.env, keys, credentials). Ask the user to edit those files.");
}
if (command && SECRET_SHELL.test(command)) {
  deny("Blocked: shell command targets a secret file (.env, keys, credentials). Ask the user to handle it.");
}
allow();
' <<<"$INPUT"
