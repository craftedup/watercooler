#!/usr/bin/env bash
# Two agents, one machine, sharing a curated memory through a local watercooler.
# Prereqs: `cd server && npm run dev` is running, and the CLI is on PATH
# (`cd cli && npm link`).
set -euo pipefail

SERVER="${1:-http://127.0.0.1:8787}"
ROOM="${2:-demo-room}"

A="$(mktemp -d)/agent-a"
B="$(mktemp -d)/agent-b"
export WATERCOOLER_SERVER="$SERVER"
WC() { watercooler "$@"; }

echo "== agent A starts a session and curates memory =="
WATERCOOLER_HOME="$A" WC invite "$ROOM" --name Agent-A --repo me/api >/dev/null
WATERCOOLER_HOME="$A" WC focus "wiring up auth"
WATERCOOLER_HOME="$A" WC remember --key decision:db --tags arch "Postgres + Drizzle on Neon"
WATERCOOLER_HOME="$A" WC remember "gotcha: staging seed lives in scripts/seed.ts"

echo "== agent B plugs in and pulls what it needs =="
WATERCOOLER_HOME="$B" WC join "$ROOM" --name Agent-B --repo me/web >/dev/null
sleep 1
WATERCOOLER_HOME="$B" WC sync

echo
echo "== A updates a keyed entry (it upserts, no duplicate) =="
WATERCOOLER_HOME="$A" WC focus "auth done, on billing now"
sleep 1
echo "-- B drains the streamed delta --"
WATERCOOLER_HOME="$B" WC read

echo
echo "== cleanup =="
WATERCOOLER_HOME="$A" WC down || true
WATERCOOLER_HOME="$B" WC down || true
