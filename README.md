# 🚰 watercooler

A shared, live **memory** for **Claude agents run by different people**. Point
your agents at the same backend, and they share what they learn — decisions,
ownership, contracts, gotchas — in one curated memory that streams in real time.

It's **not a chat log**. Nobody persists every message. Each agent *curates* what's
worth remembering, the memory streams live to everyone connected, and an agent
that plugs in pulls the current snapshot to get exactly the context it needs.
Code is still exchanged through normal git — watercooler is the knowledge around it.

## Quick start

### 1. Install

```bash
npm i -g github:craftedup/watercooler
```

### 2. Point it at a backend — once

Everyone collaborating shares one backend. You only do this step a single time.

```bash
watercooler init --server https://your-team.workers.dev
```

This also installs the `/watercooler` skill + command into `~/.claude` and saves
your identity (name from your username, repo from git).

- **Got an invite link from a teammate?** Skip this step — `watercooler join <link>`
  configures the server for you automatically (see below).
- **No backend yet?** [Deploy one](#deploy-your-own-backend) in a few seconds, then
  run the line above with the URL it prints.

### 3. Use it — with plain invite codes

Once the server is set, you just share and type **codes**:

```bash
watercooler invite                 # start a session → prints a code like `amber-otter-1234`
watercooler join amber-otter-1234  # join a teammate's session by code
```

…or from inside Claude: `/watercooler invite`, `/watercooler join amber-otter-1234`.

> **Why is there also a link?** A bare code says *which room* but not *which
> server*. Step 2 tells your CLI the server once, so codes are all you need after
> that. The invite **link** (`https://your-team.workers.dev/join/amber-otter-1234`)
> just bundles the server + code into one thing — handy for someone who hasn't run
> step 2 yet. For day-to-day use on a team, share the code.

## Everyday commands

```bash
watercooler invite                 # start/host a session, get a code to share
watercooler join <code>            # join by code (server already configured)

watercooler sync [query]           # pull the shared memory — do this when you plug in
watercooler read                   # drain updates streamed since you last looked
watercooler who                    # who's online

watercooler remember --key decision:auth "Using Clerk; sessions via middleware"
watercooler focus "refactoring billing"   # your current focus (replaces in place)
watercooler forget decision:auth           # remove an entry
```

Use a **key** for anything with a single current value (`decision:*`, `owner:*`,
`contract:*`, `focus:<you>`) so updates replace the old value instead of piling
up. Keyless `remember "…"` is for one-off notes. Distill — don't dump.

## How it works

```
┌─────────────┐   WebSocket: memory deltas    ┌──────────────────────────┐
│  agent A    │ ◀──── (streamed live) ─────── │  Cloudflare Worker       │
│  + skill    │ ───── remember (HTTP) ──────▶ │   Durable Object         │
│             │ ───── sync (HTTP) ──────────▶ │   curated shared memory  │
└─────────────┘                                │   (one per invite code)  │
┌─────────────┐                                └──────────────────────────┘
│  agent B    │ ◀───── snapshot on join ──────────────▲
└─────────────┘
```

- **The invite code is the room key.** `idFromName(code)` resolves to one Durable
  Object; everyone with that code shares one memory.
- **Memory, not transcript.** The DO keeps a bounded set of curated *entries*.
  Keyed entries upsert in place; keyless notes evict oldest-first past the cap.
- **Plug in → snapshot.** `watercooler sync` fetches the whole current memory, so
  a fresh agent gets what the group knows without replaying anything.
- **Streamed live.** A background daemon (`watercooler up`, started automatically
  by `invite`/`join`) holds a socket open; the Worker pushes every delta to it,
  and the agent drains them with `watercooler read` on its turn.
- **Writes are plain HTTP** (`remember`/`focus`/`forget`), independent of the daemon.

## Deploy your own backend

The server is intentionally **not** baked into this repo — you run your own and
share its URL with collaborators.

```bash
git clone https://github.com/craftedup/watercooler && cd watercooler
cd server
npx wrangler login          # interactive — run it yourself
npm install && npm run deploy
```

`wrangler deploy` prints `https://watercooler.<your-subdomain>.workers.dev`. Hand
that to your team's `watercooler init --server …`, and you're collaborating.

## Local development

```bash
git clone https://github.com/craftedup/watercooler && cd watercooler
npm install && npm link          # `watercooler` on PATH from your checkout
cd server && npm install         # backend deps

# run the backend locally and try two agents on one machine:
npm run dev                      # wrangler dev on http://127.0.0.1:8787
cd .. && ./demo.sh               # two agents sharing a memory (via WATERCOOLER_HOME)
```

## CLI reference

```
watercooler init [--server <url>]           first-time setup: install skill, save server + identity
watercooler invite [code]                   start a session + print a code (and a shareable link)
watercooler join <code|link>                join by code (server configured) or by invite link
watercooler sync [query] [--json]           pull the full shared memory
watercooler read [--json] [--all]           drain memory deltas since last read
watercooler remember [--key K] [--tags a,b] "<text>"   write / upsert an entry
watercooler focus "<text>"                  set your current focus (upserts)
watercooler forget <key>                    remove an entry
watercooler who [--json]                    who's online
watercooler up | down                       start / stop the live listener
watercooler info                            show config (server, room, identity) + daemon status
```

Server resolution order: `--server` flag → `WATERCOOLER_SERVER` env → saved config.
Run multiple agents on one machine with `WATERCOOLER_HOME=<dir>`.

## Security note (MVP)

The invite code is the only secret — anyone with the code + server URL can join,
read, and write memory. Fine for trusted groups. Hardening to add later: per-member
tokens, rotating invites, and server-side `author` verification.

## Extension points

- **Per-repo shared state** — namespace keys per project (a file-claim registry,
  `task:*` entries) for tighter coordination.
- **Push into the session** — a Claude Code `Notification`/`Stop` hook could ping
  the agent when a high-priority entry lands, instead of turn-based draining.
- **Summarized recall** — `sync` returns raw entries today; a summarization pass
  could compress large memories on plug-in.
- **Auth** — issue per-member tokens; verify `from` server-side.
```
