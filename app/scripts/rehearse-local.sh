#!/usr/bin/env bash
# A fresh Tokyo Trip room to rehearse the demo on this machine, as often as needed.
#
#   app/scripts/rehearse-local.sh
#
# The pot lives on a local fork of Sepolia (anvil on :8548, fake ETH), World ID is the local mock
# IdP, and recurring-buy runs are rehearsals — nothing here touches a server or real money. It
# refuses to run unless app/.env.local points at a local database and at the fork
# (SEPOLIA_RPC=http://127.0.0.1:8548). The fork is started once and kept across rehearsals; each
# run rebuilds the room with seed-tokyo-trip.mts --reset (accounts kept, World IDs unbound) and
# prints the sign-in links.
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$APP/.env.local"
FORK_PORT=8548
FORK_URL="http://127.0.0.1:$FORK_PORT"
SEPOLIA_CHAIN_ID=0xaa36a7
UPSTREAM="${SEPOLIA_UPSTREAM:-https://ethereum-sepolia-rpc.publicnode.com}"
ANVIL="${ANVIL:-$HOME/.foundry/bin/anvil}"
CAST="${CAST:-$HOME/.foundry/bin/cast}"
STATE_DIR="$HOME/.ainmem-dev"

env_value() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
rpc() { curl -s -m 5 -X POST -H 'content-type: application/json' --data "$1" "$FORK_URL"; }
fork_up() { rpc '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q "$SEPOLIA_CHAIN_ID"; }

# local database and the local fork only
case "$(env_value POSTGRES_URL)" in
  *@localhost:* | *@127.0.0.1:*) ;;
  *) echo "rehearse-local: POSTGRES_URL in app/.env.local is not a local database — refusing" >&2; exit 1 ;;
esac
if [ "$(env_value SEPOLIA_RPC)" != "$FORK_URL" ]; then
  echo "rehearse-local: set SEPOLIA_RPC=$FORK_URL in app/.env.local and restart the dev server (scripts/dev.sh restart)" >&2
  exit 1
fi

# the fork, started once
if ! fork_up; then
  mkdir -p "$STATE_DIR"
  nohup "$ANVIL" --fork-url "$UPSTREAM" --port "$FORK_PORT" --silent > "$STATE_DIR/anvil-$FORK_PORT.log" 2>&1 &
  echo $! > "$STATE_DIR/anvil-$FORK_PORT.pid"
  for _ in $(seq 1 30); do fork_up && break; sleep 1; done
  fork_up || { echo "rehearse-local: the Sepolia fork did not start (log: $STATE_DIR/anvil-$FORK_PORT.log)" >&2; exit 1; }
fi

# the seed tops the pot up from the relayer: give the relayer fork ETH (1 ETH, local only)
relayer="$("$CAST" wallet address --private-key "$(env_value RELAYER_KEY)")"
rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"anvil_setBalance\",\"params\":[\"$relayer\",\"0xde0b6b3a7640000\"]}" > /dev/null

# the room, from scratch
cd "$APP"
npx tsx --tsconfig scripts/tsconfig.json scripts/seed-tokyo-trip.mts --reset --app http://localhost:3110
