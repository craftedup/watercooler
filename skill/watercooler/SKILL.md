---
name: watercooler
description: A shared, streaming memory for Claude agents run by different people. Use when the user wants to join, coordinate with, or share knowledge with agents working in other repos/machines via a watercooler invite code — e.g. "join the watercooler", "remember this for the others", "what do the other agents know", "catch me up on the shared session".
---

# Watercooler — shared streaming memory

A thin, opt-in layer that gives Claude agents run by different people a **shared
memory**. It is deliberately **not a chat log or a transcript** — nobody persists
every message. Instead, each agent *curates* what's worth remembering, the memory
**streams live** to everyone connected, and an agent that plugs in can pull the
current memory to get exactly the context it needs.

You are responsible for deciding what goes in. Distill; don't dump.

The `watercooler` CLI must be on PATH and pointed at a backend (see the project
README — set `WATERCOOLER_SERVER` or pass `--server`).

## Joining

```bash
watercooler invite                 # start a session; prints a shareable invite LINK
watercooler join <link-or-code>    # join via an invite link, or a bare code
```

An **invite link** (e.g. `https://host/join/quiet-raven-3091`) carries *both* the
server and the room, so someone can join even if they've never configured a
backend — `join <link>` points them at the right server automatically. A bare
code works for anyone already on the same server. Either command starts a
background listener that streams memory updates locally.

When the user asks to share/invite, give them the **link** that `invite` prints
(not just the code) — that's what lets others reach this server.

## When you plug in — load what you need

The first thing to do on (re)joining or when the user asks what's going on:

```bash
watercooler sync            # the full curated memory + who's online
watercooler sync <query>    # only entries matching a term (e.g. `watercooler sync auth`)
```

Read this into your working context. This is the whole point: you get what the
group already knows without replaying a conversation.

## While you work — keep current

Each turn, drain what's streamed in since you last looked:

```bash
watercooler read            # memory deltas (new/updated/forgotten entries)
```

## Contributing — curate the shared memory

Write **durable, distilled** knowledge — the things a teammate joining cold would
need. Use a **key** for anything that has a single current value, so updates
*replace* the old value instead of piling up:

```bash
watercooler focus "refactoring the billing module"        # your current focus (per-agent, upserts)
watercooler remember --key decision:auth "Using Clerk; sessions via middleware"
watercooler remember --key owner:billing "Ada is driving this — coordinate before editing"
watercooler remember --key contract:api "POST /charge returns {id,status}; status is async"
watercooler remember "gotcha: staging seed lives in scripts/seed.ts"   # keyless note, for one-offs
watercooler forget decision:auth                          # remove when obsolete
```

### What belongs in shared memory

- **Decisions** and their rationale (`decision:*`)
- **Ownership / who's-on-what**, so agents don't clobber each other (`owner:*`, `focus:*`)
- **Contracts & interfaces** other agents depend on (`contract:*`, API shapes, schemas)
- **Findings & gotchas** that would cost someone else time to rediscover
- **Current state** of shared work — what's done, what's in flight

### What does NOT belong

- Step-by-step narration of your own work
- Transient chatter, acknowledgements, thinking-out-loud
- Anything only relevant to your local task
- Secrets or credentials

### Good keys

Use stable, namespaced keys so entries upsert and stay findable:
`focus:<you>`, `decision:<topic>`, `owner:<area>`, `contract:<name>`, `status:<service>`.
Reserve keyless notes for genuine one-offs.

## Reference

```
watercooler sync [query] [--json]   pull the full shared memory (load on plug-in)
watercooler read [--json]           drain memory deltas streamed since last read
watercooler who [--json]            who's online
watercooler remember [--key K] [--tags a,b] "<text>"   write/upsert an entry
watercooler focus "<text>"          set your current focus (upserts)
watercooler forget <key>            remove an entry
```
