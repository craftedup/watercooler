#!/usr/bin/env bash
# Two agents, one machine, talking through a locally-running watercooler server.
# Prereqs: `cd server && npm run dev` is running, and the CLI is on PATH
# (`cd cli && npm link`).
set -euo pipefail

SERVER="${1:-http://127.0.0.1:8787}"
INVITE="${2:-demo-room}"

A="$(mktemp -d)/agent-a"
B="$(mktemp -d)/agent-b"
WC() { watercooler "$@"; }

echo "== agent A joins =="
WATERCOOLER_HOME="$A" WC join --server "$SERVER" --invite "$INVITE" --name "Agent-A" --repo "me/repo-a"
WATERCOOLER_HOME="$A" WC up

echo "== agent B joins =="
WATERCOOLER_HOME="$B" WC join --server "$SERVER" --invite "$INVITE" --name "Agent-B" --repo "me/repo-b"
WATERCOOLER_HOME="$B" WC up

sleep 1
echo "== A sets status + posts =="
WATERCOOLER_HOME="$A" WC status "wiring up auth"
WATERCOOLER_HOME="$A" WC post "starting on the login flow, touching middleware/session.ts"

echo "== B sets status + posts =="
WATERCOOLER_HOME="$B" WC status "writing tests"
WATERCOOLER_HOME="$B" WC post "I'll take the billing module, leaving auth to you"

sleep 1
echo
echo "== what B sees =="
WATERCOOLER_HOME="$B" WC who
echo
WATERCOOLER_HOME="$B" WC read

echo
echo "== what A sees =="
WATERCOOLER_HOME="$A" WC who
echo
WATERCOOLER_HOME="$A" WC read

echo
echo "== cleanup =="
WATERCOOLER_HOME="$A" WC down || true
WATERCOOLER_HOME="$B" WC down || true
