// Local, read-only web UI for browsing a watercooler room.
// Runs a tiny HTTP server on 127.0.0.1 that proxies the room's WebSocket to the
// browser as Server-Sent Events, so the API token never leaves this process.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { paths, requireConfig, wsUrlFor, authHeaders } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(__dirname, "..", "ui", "index.html");
const ROOMS_FILE = path.join(paths.home, "ui-rooms.json");
const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

function savedRooms() {
  try {
    const list = JSON.parse(fs.readFileSync(ROOMS_FILE, "utf8"));
    return Array.isArray(list) ? list.filter((r) => ROOM_RE.test(r)) : [];
  } catch {
    return [];
  }
}

function saveRooms(list) {
  fs.writeFileSync(ROOMS_FILE, JSON.stringify([...new Set(list)], null, 2));
}

function roomList(cfg) {
  return [...new Set([cfg.invite, ...savedRooms()])];
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 4096) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

// One upstream WebSocket per open browser tab. `ephemeral=1` keeps the viewer
// out of the room's presence list, so looking doesn't count as being online.
function stream(cfg, room, req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  let ws = null;
  let ping = null;
  let retry = null;
  let delay = 1000;
  let closed = false;

  const connect = () => {
    if (closed) return;
    const url = wsUrlFor(
      { ...cfg, invite: room, agentId: `${cfg.agentId}-ui` },
      { ephemeral: "1" }
    );
    ws = new WebSocket(url, { headers: authHeaders(cfg) });
    ws.on("unexpected-response", (_r, upstream) => {
      const msg =
        upstream.statusCode === 401
          ? "The server rejected your token. Run: watercooler init --token <token>"
          : `The server answered ${upstream.statusCode}.`;
      send({ type: "error", message: msg, fatal: upstream.statusCode === 401 });
      if (upstream.statusCode === 401) closed = true;
      try {
        ws.terminate();
      } catch {}
    });
    ws.on("open", () => {
      delay = 1000;
      send({ type: "connected", room });
      clearInterval(ping);
      ping = setInterval(() => {
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
      if (m.type !== "pong") send(m);
    });
    ws.on("close", () => {
      clearInterval(ping);
      if (closed) return;
      send({ type: "disconnected" });
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30000);
    });
    ws.on("error", () => {});
  };

  // Comment lines keep proxies and the browser from timing the stream out.
  const keepalive = setInterval(() => res.write(": keepalive\n\n"), 20000);

  req.on("close", () => {
    closed = true;
    clearInterval(keepalive);
    clearInterval(ping);
    clearTimeout(retry);
    try {
      ws?.close();
    } catch {}
  });

  connect();
}

export function startUi({ port = 4173, open = true } = {}) {
  const cfg = requireConfig();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return fs.createReadStream(PAGE).pipe(res);
    }

    if (url.pathname === "/api/rooms") {
      if (req.method === "GET") {
        return json(res, 200, { current: cfg.invite, me: cfg.name, server: cfg.server, rooms: roomList(cfg) });
      }
      if (req.method === "POST") {
        const { code } = await readBody(req);
        if (!ROOM_RE.test(String(code || ""))) {
          return json(res, 400, { error: "Room codes use letters, numbers, - and _ only." });
        }
        saveRooms([...savedRooms(), code]);
        return json(res, 200, { rooms: roomList(cfg) });
      }
      if (req.method === "DELETE") {
        const code = url.searchParams.get("code");
        saveRooms(savedRooms().filter((r) => r !== code));
        return json(res, 200, { rooms: roomList(cfg) });
      }
    }

    if (url.pathname === "/api/stream" && req.method === "GET") {
      const room = url.searchParams.get("room") || cfg.invite;
      if (!ROOM_RE.test(room)) return json(res, 400, { error: "Bad room code." });
      return stream(cfg, room, req, res);
    }

    json(res, 404, { error: "not found" });
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is taken. Try: watercooler ui --port ${port + 1}`);
    } else {
      console.error(err.message);
    }
    process.exit(1);
  });

  server.listen(port, "127.0.0.1", () => {
    const link = `http://localhost:${port}`;
    console.log(`\n  🚰  watercooler ui  →  ${link}`);
    console.log(`      room: ${cfg.invite}   (Ctrl+C to stop)\n`);
    if (open && process.platform === "darwin") spawn("open", [link], { stdio: "ignore", detached: true }).unref();
  });
}
