import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Allow overriding the config dir so multiple agents can run on one machine
// (e.g. WATERCOOLER_HOME=/tmp/agent-a watercooler up).
export const HOME = process.env.WATERCOOLER_HOME || path.join(os.homedir(), ".watercooler");

// Where your watercooler backend is deployed. Set it once via the
// WATERCOOLER_SERVER env var (or pass --server). Deploy your own from server/
// — see the README. There is intentionally no shared default.
export const DEFAULT_SERVER = process.env.WATERCOOLER_SERVER || "";

export const paths = {
  home: HOME,
  config: path.join(HOME, "config.json"),
  inbox: path.join(HOME, "inbox.ndjson"),
  memory: path.join(HOME, "memory.json"),
  state: path.join(HOME, "state.json"),
  cursor: path.join(HOME, "cursor"),
  pid: path.join(HOME, "daemon.pid"),
  log: path.join(HOME, "daemon.log"),
};

export function ensureHome() {
  fs.mkdirSync(HOME, { recursive: true });
}

export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(paths.config, "utf8"));
  } catch {
    return null;
  }
}

export function writeConfig(cfg) {
  ensureHome();
  fs.writeFileSync(paths.config, JSON.stringify(cfg, null, 2));
}

export function requireConfig() {
  const cfg = readConfig();
  if (!cfg || !cfg.server || !cfg.invite) {
    console.error(
      "👋 You're not in a watercooler session yet.\n\n" +
        "  • Have an invite link?   watercooler join <link>\n" +
        "  • Starting fresh?        watercooler init --server <url>   then   watercooler invite\n" +
        "  • First time setup?      watercooler init   (installs the /watercooler skill for Claude)\n"
    );
    process.exit(1);
  }
  return cfg;
}

// Normalize a server base into ws and http origins.
export function origins(server) {
  let s = server.trim().replace(/\/+$/, "");
  const wsUrl = s.replace(/^http/, "ws");
  const httpUrl = s.replace(/^ws/, "http");
  return { wsUrl, httpUrl };
}

export function wsUrlFor(cfg, extra = {}) {
  const { wsUrl } = origins(cfg.server);
  const q = new URLSearchParams({
    invite: cfg.invite,
    agent: cfg.agentId,
    name: cfg.name,
    repo: cfg.repo || "",
    ...extra,
  });
  return `${wsUrl}/?${q.toString()}`;
}

export function httpUrlFor(cfg, path = "/msg") {
  const { httpUrl } = origins(cfg.server);
  const q = new URLSearchParams({ invite: cfg.invite });
  return `${httpUrl}${path}?${q.toString()}`;
}

// The API token: env var wins, else saved config. Empty if the server is open.
export function resolveToken(cfg) {
  return process.env.WATERCOOLER_TOKEN || cfg?.token || "";
}

// Authorization header for fetch()/WebSocket when a token is configured.
export function authHeaders(cfg) {
  const t = resolveToken(cfg);
  return t ? { Authorization: "Bearer " + t } : {};
}

export function daemonRunning() {
  try {
    const pid = parseInt(fs.readFileSync(paths.pid, "utf8").trim(), 10);
    if (!pid) return null;
    process.kill(pid, 0); // throws if not alive
    return pid;
  } catch {
    return null;
  }
}

export function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function randomId(prefix = "a") {
  // crypto is available without import in Node 20 via globalThis.crypto
  return `${prefix}_${globalThis.crypto.randomUUID().slice(0, 8)}`;
}

const ADJ = [
  "amber", "brisk", "calm", "dapper", "eager", "fuzzy", "gentle", "honest",
  "jolly", "keen", "lucky", "mellow", "nimble", "plucky", "quiet", "rapid",
  "spry", "tidy", "vivid", "witty",
];
const NOUN = [
  "otter", "falcon", "maple", "comet", "harbor", "willow", "pebble", "ember",
  "lagoon", "cedar", "badger", "marlin", "quartz", "raven", "thistle", "walrus",
];

// A short, human-shareable room code like "brisk-otter-4827".
export function generateInvite() {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${a}-${n}-${num}`;
}
