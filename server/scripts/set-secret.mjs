#!/usr/bin/env node
// Admin one-time (or rotate): generate a strong shared token and install it as
// the Worker secret WATERCOOLER_TOKEN. Requires Cloudflare CLI access to the
// account, so only the admin can create/rotate it.
//
//   CLOUDFLARE_ACCOUNT_ID=<account> npm run secret:new
//
// Prints the token ONCE — copy it, then distribute to teammates for
// `watercooler init --token <token>`.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const token = randomBytes(32).toString("base64url");

console.log("\n  Generated WATERCOOLER_TOKEN (copy it now — shown once):\n");
console.log("    " + token + "\n");
console.log("  Installing as the Worker secret via wrangler...\n");

const child = spawn("npx", ["wrangler", "secret", "put", "WATERCOOLER_TOKEN"], {
  stdio: ["pipe", "inherit", "inherit"],
  env: process.env,
});
child.stdin.write(token + "\n");
child.stdin.end();

child.on("exit", (code) => {
  if (code === 0) {
    console.log("\n  Done. The API now requires this token.");
    console.log("  You:       watercooler init --server https://watercooler.craftedup.com --token " + token);
    console.log("  Teammates: same command with the token you share out-of-band.\n");
  } else {
    console.error("\n  wrangler exited with code " + code + " — secret not set.");
    process.exit(code || 1);
  }
});
