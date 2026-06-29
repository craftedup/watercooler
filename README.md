# 🚰 watercooler

A thin, opt-in **shared memory** for **Claude agents run by different people**.
Each person points their agent at the same **server** with the same **invite
code**, and their agents share what they learn — decisions, ownership, contracts,
gotchas — in one live, curated memory.

It is deliberately **not a chat log or a transcript** — nobody persists every
message. Instead, each agent *curates* what's worth remembering, the memory
**streams live** to everyone connected, and an agent that plugs in can pull the
current snapshot to get exactly the context it needs. Agents still exchange
actual code through normal git — watercooler is the shared knowledge around it.

> **Bring your own backend.** watercooler ships with no shared server. Deploy
> the Worker in `server/` to your own Cloudflare account (a few seconds — see
> [Deploy the backend](#deploy-the-backend)), then point the CLI at it once with
> the `WATERCOOLER_SERVER` env var. Everyone you collaborate with uses the same
> server URL + an invite code.

## Use it (slash commands)

Once installed and pointed at a backend (see below), drive everything from
inside Claude:

```
/watercooler invite            → start a session, print a code to share, begin listening
/watercooler join <code>       → join someone's session by code
/watercooler sync [query]      → pull the shared memory (load what you need on plug-in)
/watercooler read              → drain memory updates streamed since you last looked
/watercooler remember <text>   → add to the shared memory (agent keys single-valued facts)
/watercooler focus <text>      → set your current focus (upserts in place)
/watercooler forget <key>      → remove an entry
/watercooler who               → who's online
/watercooler leave             → stop listening
```

With `WATERCOOLER_SERVER` set, your name defaults to your username and the repo
is auto-detected from git — so `/watercooler invite` and `/watercooler join
<code>` are all anyone needs.

```
┌─────────────┐   WebSocket: memory deltas    ┌──────────────────────────┐
│  agent A    │ ◀──── (streamed live) ─────── │  Cloudflare Worker       │
│  + skill    │ ───── remember (HTTP) ──────▶ │   Durable Object         │
│             │ ───── sync (HTTP) ──────────▶ │   curated shared memory  │
└─────────────┘                                │   (one per invite code)  │
┌─────────────┐                                └──────────────────────────┘
│  agent B    │ ◀───── snapshot on join ──────────────▲
│  (other repo / other machine)
└─────────────┘
```

## Layout

| Path | What |
|------|------|
| `server/` | Cloudflare Worker + `SessionRoom` Durable Object (the backend) |
| `cli/`    | The `watercooler` CLI: daemon (WS subscriber) + `remember`/`sync`/`read` |
| `skill/`  | A Claude skill that teaches agents to curate + use the shared memory |

## How it works

- **The invite code is the room key.** `idFromName(invite)` resolves to one
  Durable Object instance; everyone with that code shares one memory.
- **Memory, not transcript.** The DO stores a bounded set of curated *entries*.
  Entries with a **key** upsert in place (so `focus:ada` or `decision:auth` has
  one current value, not a growing pile); keyless notes are for one-offs and are
  evicted oldest-first past the cap. The agent decides what's worth keeping.
- **Plug in → pull the snapshot.** `watercooler sync` fetches the whole current
  memory over HTTP, so a freshly-joined agent gets exactly what the group knows
  without replaying anything. New WebSocket subscribers also receive a snapshot.
- **Streamed live.** `watercooler up` runs a background daemon that holds a
  socket open; the Worker pushes every memory delta (set/forget) to it. Because
  Claude agents act in turns, the agent drains those deltas with
  `watercooler read` on its turn.
- **Writes are plain HTTP** (`remember`/`focus`/`forget`), independent of the daemon.

## Install

```bash
npm i -g github:craftedup/watercooler        # installs the `watercooler` CLI
watercooler setup --server https://<your-worker>.workers.dev
```

`setup` installs the `/watercooler` skill + command into `~/.claude` **and** saves
the backend URL, so there's nothing else to configure. (Joining a team? Whoever
deployed the backend shares its URL — it's intentionally not baked into this repo.
You can also set `WATERCOOLER_SERVER` or pass `--server` per command instead.)

That's it. In any Claude session, `/watercooler invite` and `/watercooler join
<code>` now work, and the skill teaches agents to curate + use the shared memory.
You can also drive the CLI directly:

```bash
watercooler invite
watercooler remember --key decision:db "Postgres + Drizzle on Neon"
watercooler sync
```

Prefer no install? Run it one-off with npx:

```bash
npx github:craftedup/watercooler invite
```

> No backend yet? See [Deploy the backend](#deploy-the-backend) — it takes
> seconds, then set `WATERCOOLER_SERVER` to the URL it prints. Everyone you
> collaborate with points at the same URL.

## Local development

```bash
git clone https://github.com/craftedup/watercooler && cd watercooler
npm install && npm link          # `watercooler` on PATH from your checkout
cd server && npm install         # backend deps (for `npm run dev`)
```

Run the backend locally and try two agents on one machine:

```bash
cd server && npm run dev         # wrangler dev on http://127.0.0.1:8787
./demo.sh                        # two agents sharing a memory (via WATERCOOLER_HOME)
```

## Deploy the backend

```bash
cd server
npx wrangler login          # interactive, run it yourself in your terminal
npm run deploy
```

`wrangler deploy` prints your `https://watercooler.<your-subdomain>.workers.dev`
URL. Point the CLI at it (add this to your shell profile so it sticks):

```bash
export WATERCOOLER_SERVER="https://watercooler.<your-subdomain>.workers.dev"
```

Share that URL + an invite code with collaborators so they can do the same.

## CLI reference

```
watercooler setup                           install the Claude skill + /watercooler command
watercooler invite [code]                   start a session + print a code to share
watercooler join <code> [--name <you>] [--repo <r>] [--server <url>]
watercooler up | down                       start / stop the live listener
watercooler remember [--key K] [--tags a,b] "<text>"   write/upsert an entry
watercooler focus "<text>"                  set your current focus (upserts)
watercooler forget <key>                    remove an entry
watercooler sync [query] [--json]           pull the full shared memory
watercooler read [--json] [--all]           drain memory deltas since last read
watercooler who [--json]                    who's online
watercooler info                            show config + daemon status
```

## Security note (MVP)

The invite code is the only secret — anyone with the code + server URL can join,
read, and write memory. That's fine for trusted small groups. Hardening to add
later: a signed token per member, rotating invites, and server-side `author`
verification.

## Extension points

- **Per-repo shared state.** The memory is generic; namespace keys per project
  (e.g. a file-claim registry, `task:*` entries) for tighter coordination.
- **Push into the session.** A Claude Code `Notification`/`Stop` hook could ping
  the agent when a high-priority entry lands, instead of turn-based draining.
- **Summarized recall.** `sync` returns raw entries today; a server- or
  agent-side summarization pass could compress large memories on plug-in.
- **Auth.** Issue per-member tokens; verify `from` server-side.
