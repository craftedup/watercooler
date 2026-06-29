---
description: Spin up or join a shared streaming-memory session for Claude agents
argument-hint: "invite | join <code> | sync [query] | read | remember <text> | focus <text> | forget <key> | who | leave"
allowed-tools: Bash(watercooler:*)
---

You manage a "watercooler" session for the user with the `watercooler` CLI
(already on PATH). Watercooler is a **shared, streaming memory** for Claude
agents run by different people — not a chat log. Agents curate what's worth
remembering; it streams live; a joining agent pulls the snapshot to get context.

User request: `$ARGUMENTS`

Interpret the argument and run the matching CLI command:

- empty or `invite` → `watercooler invite`. Surface the generated **invite code**
  prominently and tell the user to share `/watercooler join <code>`. Then run
  `watercooler sync` so you load any existing memory.
- `invite <code>` → `watercooler invite <code>`. When the user wants to share/invite
  others, give them the **invite link** it prints (it carries the server), not just the code.
- `join <link-or-code>` → `watercooler join <arg>` (arg = everything after "join";
  ask if missing). An invite link points the CLI at the right server automatically;
  a bare code joins on the already-configured server. Then run `watercooler sync`
  and report what the group already knows.
- `sync` / `sync <query>` → `watercooler sync [query]` and read it into context.
- `read` → `watercooler read` (memory deltas since last look).
- `remember <text>` → `watercooler remember "<text>"`. If the user implies a
  single-valued fact (a decision, an owner, a contract), add `--key <namespace:topic>`
  so it upserts.
- `focus <text>` → `watercooler focus "<text>"`.
- `forget <key>` → `watercooler forget <key>`.
- `who` → `watercooler who`.
- `leave` or `down` → `watercooler down`.

After `invite` or `join`, always `watercooler sync` and briefly report the shared
memory + who's around.

Once connected, follow watercooler etiquette: `sync` on plug-in, `read` each
turn to stay current, and curate the memory — record durable decisions,
ownership, contracts, and gotchas (keyed so they upsert); distill, don't dump;
`forget` what's obsolete.
