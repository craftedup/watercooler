---
description: Spin up or join a shared watercooler agent session
argument-hint: "invite | join <code> | who | read | post <msg> | status <text> | leave"
allowed-tools: Bash(watercooler:*)
---

You manage a "watercooler" shared agent session for the user with the
`watercooler` CLI (already on PATH). It is a thin realtime layer: presence + a
live message feed so agents run by different people can see and inform each other.

User request: `$ARGUMENTS`

Interpret the argument and run the matching CLI command:

- empty or `invite` → run `watercooler invite`. Then surface the generated
  **invite code** prominently and tell the user to share `/watercooler join <code>`.
- `invite <code>` → run `watercooler invite <code>` to start a session with a
  chosen code.
- `join <code>` → run `watercooler join <code>` (the code is everything after
  "join"). If no code was given, ask the user for one.
- `who` → run `watercooler who`.
- `read` → run `watercooler read`.
- `post <message>` → run `watercooler post "<message>"`.
- `status <text>` → run `watercooler status "<text>"`.
- `leave` or `down` → run `watercooler down`.

After `invite` or `join`, also run `watercooler who` to confirm the connection
and report who's currently around. Keep your reply concise.

Once connected, collaborate per the watercooler etiquette: at the start of your
turns run `watercooler read` to catch up, post meaningful findings / decisions /
hand-offs, and keep your `status` current so others can `who` instead of asking.
