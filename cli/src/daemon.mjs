// Long-lived subscriber. Holds the WebSocket open and writes every inbound
// event to the local inbox so the agent (via `watercooler read`) can drain it.
import fs from "node:fs";
import WebSocket from "ws";
import { paths, requireConfig, wsUrlFor, ensureHome } from "./lib.mjs";

ensureHome();
const cfg = requireConfig();

const seen = new Set(); // seq numbers already written to the inbox
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

function writeState(agents) {
  fs.writeFileSync(paths.state, JSON.stringify({ agents, ts: Date.now() }, null, 2));
}

function connect() {
  const url = wsUrlFor(cfg);
  log(`connecting to ${url}`);
  ws = new WebSocket(url);

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
    if (m.type === "history") {
      for (const evt of m.messages || []) appendInbox(evt);
      if (m.agents) writeState(m.agents);
      return;
    }
    if (m.type === "presence") {
      writeState(m.agents || []);
      // Also drop a marker into the inbox so the agent can notice joins/leaves.
      appendInbox({ type: "presence", ts: m.ts, agents: m.agents || [] });
      return;
    }
    if (m.type === "chat" || m.type === "status") {
      appendInbox(m);
    }
  });

  ws.on("close", () => {
    log("socket closed, reconnecting");
    clearInterval(pingTimer);
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
