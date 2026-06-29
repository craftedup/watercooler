import { DurableObject } from "cloudflare:workers";

export interface Env {
  ROOMS: DurableObjectNamespace<SessionRoom>;
}

const HISTORY_CAP = 200;

interface Agent {
  id: string;
  name: string;
  repo: string;
  ephemeral?: boolean;
}

interface Event {
  type: "chat" | "status";
  seq: number;
  ts: number;
  from: Agent;
  text: string;
}

function parseAgent(url: URL): Agent {
  return {
    id: url.searchParams.get("agent") || "anon",
    name: url.searchParams.get("name") || "anon",
    repo: url.searchParams.get("repo") || "",
    ephemeral: url.searchParams.get("ephemeral") === "1",
  };
}

/**
 * One Durable Object instance per invite code. Holds the live WebSocket
 * connections, a rolling message history, and the latest status per agent.
 */
export class SessionRoom extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(req, url);
    }
    if (req.method === "POST" && url.pathname.endsWith("/msg")) {
      return this.handlePost(req);
    }
    if (url.pathname.endsWith("/state")) {
      return this.handleState();
    }
    return new Response("not found", { status: 404 });
  }

  // ---- WebSocket (inbound push to subscribers) ----

  private async handleWebSocket(_req: Request, url: URL): Promise<Response> {
    const agent = parseAgent(url);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(agent);

    // Seed the new subscriber with backlog + current presence.
    const history = (await this.ctx.storage.get<Event[]>("history")) || [];
    server.send(
      JSON.stringify({ type: "history", messages: history, agents: await this.presence() })
    );

    if (!agent.ephemeral) {
      await this.broadcastPresence();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let m: any;
    try {
      m = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (m.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
      return;
    }
    if (m.type === "chat" || m.type === "status") {
      const from = (ws.deserializeAttachment() as Agent) || {
        id: "anon",
        name: "anon",
        repo: "",
      };
      const evt = await this.ingest(m.type, from, m.text);
      this.broadcast(evt);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Agent | null;
    try {
      ws.close();
    } catch {}
    if (!a?.ephemeral) {
      await this.broadcastPresence();
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.broadcastPresence();
  }

  // ---- HTTP (outbound from CLI, and snapshot fallback) ----

  private async handlePost(req: Request): Promise<Response> {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const from: Agent = body.from || { id: "anon", name: "anon", repo: "" };
    const type = body.type === "status" ? "status" : "chat";
    const evt = await this.ingest(type, from, body.text);
    this.broadcast(evt);
    return Response.json({ ok: true, seq: evt.seq });
  }

  private async handleState(): Promise<Response> {
    const history = (await this.ctx.storage.get<Event[]>("history")) || [];
    return Response.json({ agents: await this.presence(), messages: history });
  }

  // ---- shared helpers ----

  private async ingest(type: "chat" | "status", from: Agent, text: unknown): Promise<Event> {
    const seq = ((await this.ctx.storage.get<number>("seq")) || 0) + 1;
    await this.ctx.storage.put("seq", seq);

    const clean: Agent = {
      id: String(from.id || "anon"),
      name: String(from.name || "anon"),
      repo: String(from.repo || ""),
    };
    const evt: Event = { type, seq, ts: Date.now(), from: clean, text: String(text ?? "") };

    if (type === "status") {
      const statuses =
        (await this.ctx.storage.get<Record<string, { text: string; ts: number }>>("statuses")) ||
        {};
      statuses[clean.id] = { text: evt.text, ts: evt.ts };
      await this.ctx.storage.put("statuses", statuses);
    }

    const history = (await this.ctx.storage.get<Event[]>("history")) || [];
    history.push(evt);
    while (history.length > HISTORY_CAP) history.shift();
    await this.ctx.storage.put("history", history);

    return evt;
  }

  private async presence(): Promise<Array<Agent & { status: string; statusTs: number }>> {
    const statuses =
      (await this.ctx.storage.get<Record<string, { text: string; ts: number }>>("statuses")) || {};
    const seen = new Map<string, Agent & { status: string; statusTs: number }>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Agent | null;
      if (!a || a.ephemeral) continue;
      seen.set(a.id, {
        id: a.id,
        name: a.name,
        repo: a.repo,
        status: statuses[a.id]?.text || "",
        statusTs: statuses[a.id]?.ts || 0,
      });
    }
    return [...seen.values()];
  }

  private async broadcastPresence(): Promise<void> {
    this.broadcast({ type: "presence", ts: Date.now(), agents: await this.presence() });
  }

  private broadcast(obj: unknown, except?: WebSocket): void {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(s);
      } catch {}
    }
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    const invite = url.searchParams.get("invite");
    if (!invite) {
      return new Response("missing ?invite", { status: 400 });
    }

    // The invite code IS the room key: same code -> same Durable Object.
    const id = env.ROOMS.idFromName(invite);
    const stub = env.ROOMS.get(id);
    return stub.fetch(req);
  },
} satisfies ExportedHandler<Env>;
