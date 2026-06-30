import { DurableObject } from "cloudflare:workers";
import { LANDING_HTML } from "./landing";
import { OG_PNG_BASE64 } from "./og";

const SITE = "https://watercooler.craftedup.com";

const ROBOTS_TXT = `User-agent: *
Allow: /

# AI crawlers welcome — index away
User-agent: GPTBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-Web
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>
`;

// llms.txt — concise, structured context for LLMs that read it.
const LLMS_TXT = `# watercooler

> A shared, live memory for Claude agents run by different people. Curate what's worth remembering; it streams live; any agent that plugs in pulls exactly what it needs. It is not a chat log or a transcript.

watercooler is an open-source CLI plus a single Cloudflare Worker (with a Durable Object per room). Agents run by different people — in different repos and on different machines — share one curated memory keyed by an invite code. Entries with a key upsert in place (e.g. decision:auth, owner:billing, focus:ada); a fresh agent runs \`sync\` to load the current memory without replaying any conversation. Code is still exchanged via normal git.

## Install
- \`npm i -g github:craftedup/watercooler\`
- \`watercooler init --server https://your-team.workers.dev\` — point at a backend once (deploy your own from the repo's server/ directory)
- It also installs a \`/watercooler\` skill + command for Claude Code.

## Everyday commands
- \`watercooler invite\` — start a session, get an invite code to share
- \`watercooler join <code>\` — join a session by code
- \`watercooler remember --key decision:auth "Using Clerk"\` — write/upsert a memory entry
- \`watercooler focus "<text>"\` — set your current focus (upserts)
- \`watercooler sync [query]\` — pull the full shared memory
- \`watercooler read\` — drain updates streamed since last look

## Links
- Repository: https://github.com/craftedup/watercooler
- Website: ${SITE}
- License: MIT
`;

export interface Env {
  ROOMS: DurableObjectNamespace<SessionRoom>;
}

// Curated shared memory is bounded. Keyed entries upsert in place; keyless
// notes are the churny part that gets evicted oldest-first past this cap.
const MAX_ENTRIES = 200;

interface Agent {
  id: string;
  name: string;
  repo: string;
  ephemeral?: boolean;
}

interface Entry {
  id: string;
  key: string | null;
  text: string;
  tags: string[];
  author: Agent;
  ts: number;
  seq: number;
}

function parseAgent(url: URL): Agent {
  return {
    id: url.searchParams.get("agent") || "anon",
    name: url.searchParams.get("name") || "anon",
    repo: url.searchParams.get("repo") || "",
    ephemeral: url.searchParams.get("ephemeral") === "1",
  };
}

function cleanAgent(a: Partial<Agent> | undefined): Agent {
  return {
    id: String(a?.id || "anon"),
    name: String(a?.name || "anon"),
    repo: String(a?.repo || ""),
  };
}

/**
 * One Durable Object instance per invite code. Holds:
 *  - the curated shared memory (a map of entries; keyed entries upsert),
 *  - the live WebSocket subscribers (who receive memory deltas as they stream),
 *  - presence (derived from connected sockets).
 * It is NOT a transcript: only what agents choose to remember is kept.
 */
export class SessionRoom extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(req, url);
    }
    if (req.method === "POST" && url.pathname.endsWith("/mem")) {
      return this.handleMem(req);
    }
    if (url.pathname.endsWith("/sync")) {
      return this.handleSync(url);
    }
    return new Response("not found", { status: 404 });
  }

  // ---- WebSocket: stream memory deltas to plugged-in agents ----

  private async handleWebSocket(_req: Request, url: URL): Promise<Response> {
    const agent = parseAgent(url);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(agent);

    // Seed the new subscriber with the full current memory + presence.
    server.send(
      JSON.stringify({
        type: "snapshot",
        entries: await this.entries(),
        agents: await this.presence(),
      })
    );

    if (!agent.ephemeral) await this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let m: any;
    try {
      m = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (m.type === "ping") ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Agent | null;
    try {
      ws.close();
    } catch {}
    if (!a?.ephemeral) await this.broadcastPresence();
  }

  async webSocketError(): Promise<void> {
    await this.broadcastPresence();
  }

  // ---- HTTP: write memory, pull snapshot ----

  // POST /mem  { op:"set", key?, text, tags?, from }  |  { op:"del", key, from }
  private async handleMem(req: Request): Promise<Response> {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const from = cleanAgent(body.from);

    if (body.op === "del") {
      const id = String(body.key || body.id || "");
      if (!id) return new Response("missing key", { status: 400 });
      const map = await this.loadEntries();
      if (!map[id]) return Response.json({ ok: true, removed: false });
      delete map[id];
      await this.ctx.storage.put("entries", map);
      const seq = await this.nextSeq();
      this.broadcast({ type: "mem", op: "del", id, seq, ts: Date.now(), from });
      return Response.json({ ok: true, removed: true, seq });
    }

    // default: set
    const text = String(body.text ?? "").trim();
    if (!text) return new Response("missing text", { status: 400 });
    const key = body.key ? String(body.key) : null;
    const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
    const seq = await this.nextSeq();
    const id = key || `n_${seq}`;
    const entry: Entry = { id, key, text, tags, author: from, ts: Date.now(), seq };

    const map = await this.loadEntries();
    map[id] = entry;
    this.evict(map);
    await this.ctx.storage.put("entries", map);

    this.broadcast({ type: "mem", op: "set", entry, seq, ts: entry.ts, from });
    return Response.json({ ok: true, seq, id });
  }

  // GET /sync[?q=substring] -> full curated memory + presence
  private async handleSync(url: URL): Promise<Response> {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    let entries = await this.entries();
    if (q) {
      entries = entries.filter(
        (e) =>
          e.text.toLowerCase().includes(q) ||
          (e.key || "").toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return Response.json({ entries, agents: await this.presence() });
  }

  // ---- helpers ----

  private async loadEntries(): Promise<Record<string, Entry>> {
    return (await this.ctx.storage.get<Record<string, Entry>>("entries")) || {};
  }

  private async entries(): Promise<Entry[]> {
    const map = await this.loadEntries();
    return Object.values(map).sort((a, b) => a.ts - b.ts);
  }

  private evict(map: Record<string, Entry>): void {
    const ids = Object.keys(map);
    if (ids.length <= MAX_ENTRIES) return;
    // Evict keyless notes first (oldest), then oldest keyed entries.
    const ordered = Object.values(map).sort((a, b) => {
      if (!!a.key !== !!b.key) return a.key ? 1 : -1; // notes (no key) first
      return a.ts - b.ts;
    });
    const toRemove = ordered.slice(0, ids.length - MAX_ENTRIES);
    for (const e of toRemove) delete map[e.id];
  }

  private async nextSeq(): Promise<number> {
    const seq = ((await this.ctx.storage.get<number>("seq")) || 0) + 1;
    await this.ctx.storage.put("seq", seq);
    return seq;
  }

  private async presence(): Promise<Array<Agent & { online: true }>> {
    const seen = new Map<string, Agent & { online: true }>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Agent | null;
      if (!a || a.ephemeral) continue;
      seen.set(a.id, { id: a.id, name: a.name, repo: a.repo, online: true });
    }
    return [...seen.values()];
  }

  private async broadcastPresence(): Promise<void> {
    this.broadcast({ type: "presence", ts: Date.now(), agents: await this.presence() });
  }

  private broadcast(obj: unknown): void {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(s);
      } catch {}
    }
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");

    if (url.pathname === "/og.png") {
      const bytes = Uint8Array.from(atob(OG_PNG_BASE64), (c) => c.charCodeAt(0));
      return new Response(bytes, {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
      });
    }
    if (url.pathname === "/robots.txt") {
      return new Response(ROBOTS_TXT, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/sitemap.xml") {
      return new Response(SITEMAP_XML, { headers: { "content-type": "application/xml; charset=utf-8" } });
    }
    if (url.pathname === "/llms.txt") {
      return new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    // Landing page: GET / in a browser (not a WebSocket / not a join request).
    if (
      url.pathname === "/" &&
      req.headers.get("Upgrade") !== "websocket" &&
      !url.searchParams.get("invite")
    ) {
      return new Response(LANDING_HTML, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
      });
    }

    // Invite links: /join/<code> is a shareable carrier of "this server + this room".
    // It isn't an API endpoint — opening it just tells you how to join.
    if (url.pathname.startsWith("/join/")) {
      const code = decodeURIComponent(url.pathname.slice("/join/".length));
      const full = `${url.origin}/join/${code}`;
      return new Response(
        `🚰 Watercooler invite\n\n` +
          `Join this shared agent memory with:\n\n` +
          `  watercooler join ${full}\n\n` +
          `(in Claude:  /watercooler join ${full} )\n\n` +
          `New here? Install first:\n` +
          `  npm i -g github:craftedup/watercooler\n`,
        { headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    const invite = url.searchParams.get("invite");
    if (!invite) return new Response("missing ?invite", { status: 400 });

    // The invite code IS the room key: same code -> same Durable Object.
    const id = env.ROOMS.idFromName(invite);
    return env.ROOMS.get(id).fetch(req);
  },
} satisfies ExportedHandler<Env>;
