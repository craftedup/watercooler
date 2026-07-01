// Long-lived subscriber. Holds the WebSocket open and streams memory deltas
// into the local inbox so the agent (via `watercooler read`) can drain them.
// It also mirrors the full current memory + presence to local files.
import fs from "node:fs";
import WebSocket from "ws";
import { paths, requireConfig, wsUrlFor, authHeaders, ensureHome } from "./lib.mjs";

ensureHome();
const cfg = requireConfig();

const seen = new Set(); // mem-event seqs already written to the inbox
let memory = {}; // id -> entry (mirror of shared memory)
let ws = null;
let pingTimer = null;
let reconnectDelay = 1000;

function log(msg) {
  fs.appendFileSync(paths.log, `[${new Date().toISOString()}] ${msg}\n`);
}

function appendInbox(evt) {
  if (evt.seq != null) {
    if (seen.has(evt.seq)) return;
    seen.add(evt.seq);
  }
  fs.appendFileSync(paths.inbox, JSON.stringify(evt) + "\n");
}

function writeMemory() {
  const entries = Object.values(memory).sort((a, b) => a.ts - b.ts);
  fs.writeFileSync(paths.memory, JSON.stringify({ entries, ts: Date.now() }, null, 2));
}

function writeState(agents) {
  fs.writeFileSync(paths.state, JSON.stringify({ agents, ts: Date.now() }, null, 2));
}

function applyMem(evt) {
  if (evt.op === "del") delete memory[evt.id];
  else if (evt.op === "set" && evt.entry) memory[evt.entry.id] = evt.entry;
  writeMemory();
}

let stopped = false;

function connect() {
  if (stopped) return;
  const url = wsUrlFor(cfg);
  log(`connecting to ${url}`);
  ws = new WebSocket(url, { headers: authHeaders(cfg) });

  // Auth/handshake rejection (e.g. 401): don't hot-loop reconnecting.
  ws.on("unexpected-response", (_req, res) => {
    if (res.statusCode === 401) {
      log("unauthorized (401) — bad or missing token; not reconnecting. Run: watercooler init --token <token>");
      stopped = true;
      try {
        ws.close();
      } catch {}
    } else {
      log(`unexpected response ${res.statusCode}`);
    }
  });

  ws.on("open", () => {
    log("connected");
    reconnectDelay = 1000;
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch {}
    }, 25000);
  });

  ws.on("message", (data) => {
    let m;
    try {
      m = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (m.type === "pong") return;
    if (m.type === "snapshot") {
      // Full state on (re)connect: mirror it, but don't replay as deltas.
      memory = {};
      for (const e of m.entries || []) memory[e.id] = e;
      writeMemory();
      if (m.agents) writeState(m.agents);
      return;
    }
    if (m.type === "presence") {
      writeState(m.agents || []);
      appendInbox({ type: "presence", ts: m.ts, agents: m.agents || [] });
      return;
    }
    if (m.type === "mem") {
      applyMem(m);
      appendInbox(m); // streamed delta the agent can drain with `read`
    }
  });

  ws.on("close", () => {
    clearInterval(pingTimer);
    if (stopped) {
      log("stopped");
      return;
    }
    log("socket closed, reconnecting");
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    log(`socket error: ${err?.message || err}`);
    try {
      ws.close();
    } catch {}
  });
}

function scheduleReconnect() {
  if (stopped) return;
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

process.on("SIGTERM", () => {
  log("SIGTERM, shutting down");
  try {
    ws?.close();
  } catch {}
  process.exit(0);
});
process.on("SIGINT", () => process.exit(0));

connect();
