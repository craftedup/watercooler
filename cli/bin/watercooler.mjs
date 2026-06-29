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
    case "setup":
      return cmdSetup();
    case "invite":
      return cmdInvite();
    case "join":
      return cmdJoin();
    case "up":
      return cmdUp();
    case "down":
      return cmdDown();
    case "remember":
    case "note":
    case "post": // back-compat alias: a quick keyless note
      return cmdRemember();
    case "forget":
      return cmdForget();
    case "focus":
    case "status": // back-compat alias: your current focus (a keyed entry)
      return cmdFocus();
    case "sync":
    case "context":
      return cmdSync();
    case "read":
      return cmdRead();
    case "who":
      return cmdWho();
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

// Install the Claude skill + /watercooler slash command into ~/.claude so the
// agent can drive watercooler. Copies from this package's bundled files.
function cmdSetup() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const skillSrc = path.join(repoRoot, "skill", "watercooler");
  const cmdSrc = path.join(repoRoot, "command", "watercooler.md");
  if (!fs.existsSync(skillSrc) || !fs.existsSync(cmdSrc)) {
    console.error(`Could not find bundled skill/command under ${repoRoot}.`);
    process.exit(1);
  }
  const home = os.homedir();
  const skillDest = path.join(home, ".claude", "skills", "watercooler");
  const cmdDest = path.join(home, ".claude", "commands", "watercooler.md");
  fs.mkdirSync(path.dirname(skillDest), { recursive: true });
  fs.mkdirSync(path.dirname(cmdDest), { recursive: true });
  fs.rmSync(skillDest, { recursive: true, force: true });
  fs.cpSync(skillSrc, skillDest, { recursive: true });
  fs.copyFileSync(cmdSrc, cmdDest);
  console.log("Installed into ~/.claude:");
  console.log(`  • skill   → ${skillDest}`);
  console.log(`  • command → ${cmdDest}`);
  if (!process.env.WATERCOOLER_SERVER) {
    console.log(
      "\nNext: point the CLI at a backend (deploy server/ or use a shared URL):"
    );
    console.log('  export WATERCOOLER_SERVER="https://<your-worker>.workers.dev"');
  }
  console.log("\nThen run  /watercooler invite  in Claude, or  watercooler invite");
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
    for (const p of [paths.inbox, paths.cursor, paths.state, paths.memory]) {
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
  console.log(`\n  Listening for memory updates. Load shared memory:  watercooler sync`);
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
  console.log(`Load the shared memory with:  watercooler sync`);
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
  console.log(`Listening for memory updates (pid ${pid}).`);
  console.log(`Load shared memory: watercooler sync   ·   drain new deltas: watercooler read`);
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

async function postMem(cfg, body) {
  const url = httpUrlFor(cfg, "/mem");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, from: { id: cfg.agentId, name: cfg.name, repo: cfg.repo || "" } }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// remember [--key K] [--tags a,b] "<text>"   (note/post are keyless aliases)
async function cmdRemember() {
  const cfg = requireConfig();
  const text = positionals.join(" ").trim() || (flags.text ? String(flags.text) : "");
  if (!text) {
    console.error('Usage: watercooler remember [--key <key>] [--tags a,b] "<text>"');
    process.exit(1);
  }
  const key = flags.key ? String(flags.key) : null;
  const tags = flags.tags ? String(flags.tags).split(",").map((t) => t.trim()).filter(Boolean) : [];
  try {
    const json = await postMem(cfg, { op: "set", key, text, tags });
    console.log(key ? `Remembered "${key}" (#${json.seq}).` : `Noted (#${json.seq}).`);
  } catch (e) {
    console.error(`Failed: ${e.message}`);
    process.exit(1);
  }
}

// forget <key>
async function cmdForget() {
  const cfg = requireConfig();
  const key = positionals[0] || flags.key;
  if (!key) {
    console.error("Usage: watercooler forget <key>");
    process.exit(1);
  }
  try {
    const json = await postMem(cfg, { op: "del", key: String(key) });
    console.log(json.removed ? `Forgot "${key}".` : `(nothing stored under "${key}")`);
  } catch (e) {
    console.error(`Failed: ${e.message}`);
    process.exit(1);
  }
}

// focus "<text>" — your current focus, a per-agent keyed entry that upserts.
async function cmdFocus() {
  const cfg = requireConfig();
  const text = positionals.join(" ").trim() || (flags.text ? String(flags.text) : "");
  if (!text) {
    console.error('Usage: watercooler focus "<what you\'re working on>"');
    process.exit(1);
  }
  try {
    const json = await postMem(cfg, { op: "set", key: `focus:${cfg.name}`, text, tags: ["focus"] });
    console.log(`Focus set (#${json.seq}).`);
  } catch (e) {
    console.error(`Failed: ${e.message}`);
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
    console.log("(no new memory updates)");
  } else {
    for (const e of events) console.log(fmtEvent(e, cfg));
  }

  const maxSeq = events.reduce((m, e) => Math.max(m, e.seq || 0), cursor);
  if (!flags.all && maxSeq > cursor) fs.writeFileSync(paths.cursor, String(maxSeq));
}

function fmtEvent(e, cfg) {
  const who = e.from?.name || "someone";
  const mine = e.from?.id === cfg.agentId ? " (you)" : "";
  if (e.op === "del") return `[${fmtTime(e.ts)}] ${who}${mine} forgot "${e.id}"`;
  const entry = e.entry || {};
  const label = entry.key ? `"${entry.key}"` : "a note";
  return `[${fmtTime(e.ts)}] ${who}${mine} remembered ${label}: ${entry.text}`;
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
    console.log(`  • ${a.name}${mine}${repo}`);
  }
}

// sync [query] — pull the full curated shared memory (authoritative, from server).
async function cmdSync() {
  const cfg = requireConfig();
  const q = positionals.join(" ").trim();
  const url = httpUrlFor(cfg, "/sync") + (q ? `&q=${encodeURIComponent(q)}` : "");
  let json;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    json = await res.json();
  } catch (e) {
    console.error(`Sync failed: ${e.message}`);
    process.exit(1);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(json) + "\n");
    return;
  }
  const entries = json.entries || [];
  if (entries.length === 0) {
    console.log(q ? `(no memory matching "${q}")` : "(shared memory is empty)");
  } else {
    console.log(`Shared memory (${entries.length}${q ? ` matching "${q}"` : ""}):`);
    for (const e of entries) {
      const mine = e.author?.id === cfg.agentId ? " (you)" : "";
      const label = e.key ? `[${e.key}] ` : "";
      const tags = e.tags?.length ? `  #${e.tags.join(" #")}` : "";
      console.log(`  ${label}${e.text}`);
      console.log(`      — ${e.author?.name}${mine}, ${fmtTime(e.ts)}${tags}`);
    }
  }
  const online = (json.agents || []).map((a) => a.name).join(", ");
  console.log(`\nOnline: ${online || "(nobody)"}`);
}

function cmdInfo() {
  const cfg = readConfig();
  console.log(`config dir: ${paths.home}`);
  console.log(`config:     ${cfg ? JSON.stringify(cfg, null, 2) : "(not joined)"}`);
  console.log(`daemon:     ${daemonRunning() ? "running (pid " + daemonRunning() + ")" : "stopped"}`);
}

function printHelp() {
  console.log(`watercooler — a thin shared MEMORY for Claude agents

It is not a chat log: agents curate what's worth remembering, it streams live,
and a freshly-joined agent pulls the snapshot to get exactly what it needs.

Setup:
  watercooler setup              Install the Claude skill + /watercooler command into ~/.claude
  watercooler invite [code]      Start a session, print a code to share, begin listening
  watercooler join <code>        Join someone's session by invite code, begin listening
  watercooler up                 (Re)start the background listener
  watercooler down               Stop the listener

  Server from --server or WATERCOOLER_SERVER (no shared default — deploy your own).
  Name defaults to your username; repo is auto-detected from git.

Remember (curate the shared memory):
  watercooler remember [--key K] [--tags a,b] "<text>"   Write/upsert an entry (note = keyless)
  watercooler focus "<text>"                             Set your current focus (per-agent, upserts)
  watercooler forget <key>                               Remove an entry

Recall:
  watercooler sync [query] [--json]   Pull the full shared memory (what you need on plug-in)
  watercooler read [--json] [--all]   Drain memory deltas streamed since you last read
  watercooler who [--json]            Who's online

Misc:
  watercooler info               Show config + daemon status

Env:
  WATERCOOLER_HOME   Override config dir (run multiple agents on one machine)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
