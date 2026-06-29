#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import {
  paths,
  ensureHome,
  readConfig,
  writeConfig,
  requireConfig,
  httpUrlFor,
  daemonRunning,
  fmtTime,
  randomId,
  generateInvite,
  DEFAULT_SERVER,
} from "../src/lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON = path.join(__dirname, "..", "src", "daemon.mjs");

// ---- tiny arg parser ----
function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positionals.push(a);
    }
  }
  return { flags, positionals };
}

const [cmd, ...rest] = process.argv.slice(2);
const { flags, positionals } = parseArgs(rest);

async function main() {
  switch (cmd) {
    case "invite":
      return cmdInvite();
    case "join":
      return cmdJoin();
    case "up":
      return cmdUp();
    case "down":
      return cmdDown();
    case "post":
    case "say":
      return cmdSend("chat");
    case "status":
      return cmdSend("status");
    case "read":
      return cmdRead();
    case "who":
      return cmdWho();
    case "history":
      return cmdHistory();
    case "info":
      return cmdInfo();
    case "help":
    case undefined:
    case "--help":
    case "-h":
      return printHelp();
    default:
      console.error(`Unknown command: ${cmd}\n`);
      printHelp();
      process.exit(1);
  }
}

function defaultName() {
  try {
    return os.userInfo().username || "agent";
  } catch {
    return "agent";
  }
}

// Best-effort owner/repo from the current git remote, for the `repo` field.
function detectRepo() {
  try {
    const url = execSync("git config --get remote.origin.url", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

// Persist config + start the listener. Shared by `join` and `invite`.
function connect({ invite, server, name, repo, id }) {
  const existing = readConfig() || {};
  const cfg = {
    server: server || flags.server || existing.server || DEFAULT_SERVER,
    invite,
    name: name || flags.name || existing.name || defaultName(),
    repo: repo ?? flags.repo ?? existing.repo ?? detectRepo(),
    agentId: id || flags.id || existing.agentId || randomId(),
  };
  if (!cfg.server) {
    console.error(
      "No server configured. Set the WATERCOOLER_SERVER env var (or pass --server <url>).\n" +
        "Deploy your own backend from the server/ directory — see the README."
    );
    process.exit(1);
  }
  // Switching rooms: clear local buffers so we don't mix sessions.
  if (existing.invite && existing.invite !== cfg.invite) {
    for (const p of [paths.inbox, paths.cursor, paths.state]) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }
  writeConfig(cfg);
  return cfg;
}

function cmdInvite() {
  const code = positionals[0] || flags.invite || generateInvite();
  const cfg = connect({ invite: code });
  startDaemon();
  console.log(`\n  🚰  Watercooler session ready`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  invite code:  ${cfg.invite}`);
  console.log(`  server:       ${cfg.server}`);
  console.log(`  you:          ${cfg.name}${cfg.repo ? ` (${cfg.repo})` : ""}`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`\n  Share this so others can join:`);
  console.log(`    /watercooler join ${cfg.invite}`);
  console.log(`\n  You're listening for updates. See who's around:  watercooler who`);
}

function cmdJoin() {
  const code = positionals[0] || flags.invite;
  if (!code) {
    console.error("Usage: watercooler join <invite-code> [--name <you>] [--server <url>]");
    process.exit(1);
  }
  const cfg = connect({ invite: code });
  startDaemon();
  console.log(`Joined "${cfg.invite}" as ${cfg.name}${cfg.repo ? ` (${cfg.repo})` : ""}.`);
  console.log(`Server: ${cfg.server}`);
  console.log(`Listening for updates. Catch up with:  watercooler read`);
}

function startDaemon() {
  ensureHome();
  // Replace any running daemon so it picks up the current config.
  const existing = daemonRunning();
  if (existing) {
    try {
      process.kill(existing, "SIGTERM");
    } catch {}
  }
  const out = fs.openSync(paths.log, "a");
  const child = spawn(process.execPath, [DAEMON], {
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  });
  fs.writeFileSync(paths.pid, String(child.pid));
  child.unref();
  return child.pid;
}

function cmdUp() {
  requireConfig();
  const pid = startDaemon();
  console.log(`Listening for live updates (pid ${pid}).`);
  console.log(`Drain new messages with:  watercooler read`);
}

function cmdDown() {
  const pid = daemonRunning();
  if (!pid) {
    console.log("No daemon running.");
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`Stopped daemon (pid ${pid}).`);
  } catch (e) {
    console.error(`Could not stop pid ${pid}: ${e.message}`);
  }
  try {
    fs.unlinkSync(paths.pid);
  } catch {}
}

async function cmdSend(type) {
  const cfg = requireConfig();
  const text = positionals.join(" ").trim() || (flags.text ? String(flags.text) : "");
  if (!text) {
    console.error(`Usage: watercooler ${type === "status" ? "status" : "post"} "<message>"`);
    process.exit(1);
  }
  const url = httpUrlFor(cfg, "/msg");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type,
        text,
        from: { id: cfg.agentId, name: cfg.name, repo: cfg.repo || "" },
      }),
    });
    if (!res.ok) {
      console.error(`Send failed: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const json = await res.json();
    console.log(`${type === "status" ? "Status set" : "Posted"} (#${json.seq}).`);
  } catch (e) {
    console.error(`Send failed: ${e.message}`);
    process.exit(1);
  }
}

function readCursor() {
  try {
    return parseInt(fs.readFileSync(paths.cursor, "utf8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function cmdRead() {
  const cfg = requireConfig();
  if (!daemonRunning()) {
    console.error("(daemon not running — start it with `watercooler up`, or use `watercooler history`)");
  }
  let lines = [];
  try {
    lines = fs.readFileSync(paths.inbox, "utf8").split("\n").filter(Boolean);
  } catch {
    lines = [];
  }
  const cursor = flags.all ? 0 : readCursor();
  const events = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((e) => (e.seq == null ? false : e.seq > cursor)); // skip presence markers in `read`

  if (flags.json) {
    for (const e of events) process.stdout.write(JSON.stringify(e) + "\n");
  } else if (events.length === 0) {
    console.log("(no new messages)");
  } else {
    for (const e of events) console.log(fmtEvent(e, cfg));
  }

  const maxSeq = events.reduce((m, e) => Math.max(m, e.seq || 0), cursor);
  if (!flags.all && maxSeq > cursor) fs.writeFileSync(paths.cursor, String(maxSeq));
}

function fmtEvent(e, cfg) {
  const mine = e.from?.id === cfg.agentId ? " (you)" : "";
  const tag = e.type === "status" ? "status" : "says";
  const repo = e.from?.repo ? ` {${e.from.repo}}` : "";
  return `[${fmtTime(e.ts)}] ${e.from?.name}${mine}${repo} ${tag}: ${e.text}`;
}

function cmdWho() {
  const cfg = requireConfig();
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(paths.state, "utf8"));
  } catch {}
  if (!state || !state.agents) {
    console.log("(no presence data yet — is the daemon running? `watercooler up`)");
    return;
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(state.agents) + "\n");
    return;
  }
  if (state.agents.length === 0) {
    console.log("(nobody online)");
    return;
  }
  console.log(`Online (${state.agents.length}):`);
  for (const a of state.agents) {
    const mine = a.id === cfg.agentId ? " (you)" : "";
    const repo = a.repo ? `  repo:${a.repo}` : "";
    const status = a.status ? `  — ${a.status}` : "";
    console.log(`  • ${a.name}${mine}${repo}${status}`);
  }
}

async function cmdHistory() {
  const cfg = requireConfig();
  const url = httpUrlFor(cfg, "/state");
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`History failed: ${res.status}`);
      process.exit(1);
    }
    const json = await res.json();
    if (flags.json) {
      process.stdout.write(JSON.stringify(json) + "\n");
      return;
    }
    for (const e of json.messages || []) console.log(fmtEvent(e, cfg));
    console.log(`\nOnline: ${(json.agents || []).map((a) => a.name).join(", ") || "(nobody)"}`);
  } catch (e) {
    console.error(`History failed: ${e.message}`);
    process.exit(1);
  }
}

function cmdInfo() {
  const cfg = readConfig();
  console.log(`config dir: ${paths.home}`);
  console.log(`config:     ${cfg ? JSON.stringify(cfg, null, 2) : "(not joined)"}`);
  console.log(`daemon:     ${daemonRunning() ? "running (pid " + daemonRunning() + ")" : "stopped"}`);
}

function printHelp() {
  console.log(`watercooler — a thin shared session for Claude agents

Setup:
  watercooler invite [code]      Start a session, print a code to share, begin listening
  watercooler join <code>        Join someone's session by invite code, begin listening
  watercooler up                 (Re)start the background listener
  watercooler down               Stop the listener

  Server defaults to the deployed backend; override with --server or WATERCOOLER_SERVER.
  Name defaults to your username; repo is auto-detected from git. Override with --name/--repo.

Talk:
  watercooler post "<message>"   Share something with everyone in the session
  watercooler status "<text>"    Set your current status (what you're doing)

Listen:
  watercooler read [--json] [--all]   Drain new messages since you last read
  watercooler who [--json]            Who's online + their status
  watercooler history [--json]        Pull recent backlog from the server

Misc:
  watercooler info               Show config + daemon status

Env:
  WATERCOOLER_HOME   Override config dir (run multiple agents on one machine)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
