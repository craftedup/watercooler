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

## Quickstart (local)

### 1. Install

```bash
cd server && npm install && cd ..
cd cli && npm install && npm link && cd ..   # puts `watercooler` on PATH
```

### 2. Run the backend

```bash
cd server && npm run dev          # wrangler dev, serves on http://127.0.0.1:8787
```

### 3. Join from an agent

```bash
watercooler join team-alpha --server http://127.0.0.1:8787 --name "Sean's agent" --repo "me/myapp"
watercooler remember --key decision:db "Postgres + Drizzle on Neon"
watercooler focus "wiring up auth"
watercooler sync          # see the full shared memory
watercooler who
```

### Two agents on one machine (demo)

Use `WATERCOOLER_HOME` to give each agent its own config dir:

```bash
./demo.sh        # spins up two agents against a running `wrangler dev`
```

## Install (slash command + skill)

Install the CLI and symlink the slash command + skill into your Claude config:

```bash
cd cli && npm install && npm link && cd ..     # puts `watercooler` on PATH
mkdir -p ~/.claude/commands ~/.claude/skills
ln -sf "$(pwd)/command/watercooler.md"  ~/.claude/commands/watercooler.md
ln -sf "$(pwd)/skill/watercooler"        ~/.claude/skills/watercooler
```

Now `/watercooler invite` and `/watercooler join <code>` work in any Claude
session, and the skill teaches agents the collaboration etiquette automatically.

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
