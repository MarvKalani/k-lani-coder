#!/usr/bin/env bash
# Moving-board demo: drives a throwaway board through the REAL flow —
# backlog idea -> planner contract -> claim by a local model ->
# submit -> planner reroute to another model (recorded reject) ->
# second model finishes -> approved. The live web view (2 s poll)
# shows tickets wandering across the columns, the cost trace filling
# up per phase, and the availability alert firing during the outage.
#
# Everything is the real machinery: real WORM ticket events via the
# CLI, real tagged ledger lines in the proxy-log format. Nothing in
# the UI is mocked.
#
# Usage:
#   bash demo/board-demo.sh [demo-dir]     # default /tmp/klc-board-demo
#   k-lani-coder board-web --data-dir <demo-dir> \
#     --proxy-log <demo-dir>/proxy-demo.log --bind 127.0.0.1:8789
set -euo pipefail

BIN="${KLC_BIN:-k-lani-coder}"
DIR="${1:-/tmp/klc-board-demo}"
LOG="$DIR/proxy-demo.log"
PAUSE="${KLC_DEMO_PAUSE:-4}"
LOCAL_A="gemma4-12b-qat-mtp"
LOCAL_B="mellum2-final-q8"
FRONTIER="gpt-5.5"

mkdir -p "$DIR"
touch "$LOG"

ok_line() { # model role ticket in out cost [effort]
  echo "[ai] upstream_ok stream=true model=$1 agent=$2 status=200 prompt_tokens=$4 completion_tokens=$5 total_tokens=$(($4 + $5)) bytes_received=1 bytes_sent=1 thinking_bytes=0 cost_micros=$6 ticket=$3 role=$2${7:+ effort=$7} ts=$(date +%s)" >> "$LOG"
}
err_line() { # model
  echo "[ai] upstream_error stream=true model=$1 agent=worker status=429 tokens_in_est=64 cost_micros=0 error=rate limited" >> "$LOG"
}

TITLES=(
  "Tighten parser error spans"
  "Signature map for the TS lane"
  "Guard: reject vanished symbols"
  "Slice budget accounting"
  "Report card per skill tag"
  "Fail-fast lock message for the board CLI"
)

SPRINT_LENGTH="${KLC_DEMO_SPRINT:-6}"

cycle=0
while true; do
  # a demo SPRINT, not an endless landfill: every N cycles the board
  # starts fresh (WORM tables are append-only by design — the demo
  # swaps the throwaway dir instead; board-web reopens per request,
  # so the page simply empties and refills)
  if [ $((cycle % SPRINT_LENGTH)) -eq 0 ] && [ "$cycle" -gt 0 ]; then
    echo "[demo] sprint complete after $SPRINT_LENGTH tickets — fresh board"
    rm -rf "$DIR"
    mkdir -p "$DIR"
    : > "$LOG"
  fi
  title="${TITLES[$((cycle % ${#TITLES[@]}))]}"
  cycle=$((cycle + 1))

  # 1. the owner drops an idea
  spec_idea=$(mktemp); echo "High-level idea: $title." > "$spec_idea"
  out=$("$BIN" ticket new --backlog --title "$title (demo #$cycle)" \
        --spec-file "$spec_idea" --category rust_impl --priority 2 --data-dir "$DIR")
  id=$(echo "$out" | grep -o '[0-9a-f]\{8\}' | head -1)
  rm -f "$spec_idea"
  echo "[demo] cycle $cycle: backlog $id"
  sleep "$PAUSE"

  # 2. the planner promotes it to a contract (pool of two local models)
  spec=$(mktemp)
  printf 'Implement: %s.\nallowed_symbols: demo_symbol\ngate: demo\ndone: gate green\nlevel: 1\ntags: rust, demo\nmodel_pool: %s, %s\n' \
    "$title" "$LOCAL_A" "$LOCAL_B" > "$spec"
  "$BIN" ticket move "$id" open --spec-file "$spec" --note "planned" --data-dir "$DIR" >/dev/null
  rm -f "$spec"
  ok_line "$FRONTIER" planner "$id" 8412 916 19675 xhigh
  sleep "$PAUSE"

  # 3. the first local model claims and works
  "$BIN" ticket move "$id" claimed --assignee "$LOCAL_A" --data-dir "$DIR" >/dev/null
  ok_line "$LOCAL_A" worker "$id" 14210 3722 0 no-think
  sleep "$PAUSE"
  "$BIN" ticket move "$id" review --note "gate green on my machine" --data-dir "$DIR" >/dev/null
  sleep "$PAUSE"

  # 4. outage: the model hits its limit — the board alert fires —
  #    and the planner reroutes (a RECORDED reject, never a silent swap)
  err_line "$LOCAL_A"; err_line "$LOCAL_A"; err_line "$LOCAL_A"
  "$BIN" ticket move "$id" rejected \
    --note "rerouted: weekly budget — reassigning to $LOCAL_B" --data-dir "$DIR" >/dev/null
  sleep "$PAUSE"

  # 5. the second model takes over and finishes
  "$BIN" ticket move "$id" claimed --assignee "$LOCAL_B" --data-dir "$DIR" >/dev/null
  ok_line "$LOCAL_B" worker "$id" 6190 1410 0 no-think
  sleep "$PAUSE"
  "$BIN" ticket move "$id" review --note "gate green, scope respected" --data-dir "$DIR" >/dev/null
  ok_line "$FRONTIER" review "$id" 3105 240 6281 medium
  sleep "$PAUSE"
  "$BIN" ticket move "$id" done --note "approved: gate green, attempt 2" --data-dir "$DIR" >/dev/null
  # recovery: the first model answers again, the alert clears
  ok_line "$LOCAL_A" worker "$id" 32 8 0
  echo "[demo] cycle $cycle: done $id"
  sleep "$PAUSE"
done
