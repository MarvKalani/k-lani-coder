# Sandboxed MCP-only agent

The harness model enforced **by construction**, not by asking the model
nicely: the agent runs in a container with **no repo** and can only read or
change code through the `k-lani-coder` MCP server. So reads are
symbol-slices (the token-saving premise), every change is a guarded
`write`/`replace` → WORM diff evidence, and the "the model keeps reading
files" leak is closed because there are no files to read.

## What is enforced vs. what is a trade-off

| Property | Status |
|---|---|
| Agent sees no repo (no mount) | **enforced** — proven by the smoke test |
| Agent's only code access is the hub MCP server | **enforced** (empty FS + denied native tools) |
| Writes carry WORM diff evidence | **enforced** (they go through guarded `write`/`replace`) |
| Network isolation (no host/LAN reach) | **trade-off** — see "Why host networking" |
| Token/cost metering | **knob** — see "Egress" |

## Run

```bash
# 1) HOST: the hub owns the repo and binds loopback by default.
k-lani-coder serve --hub 127.0.0.1:8790 --data-dir data/coder --workspace .

# 2) the sandboxed agent (identity = exact model + effort, never a nickname):
KLANI_AGENT_ID=opus-4-8-high \
  docker compose -f publish/k-lani-coder/docker-compose.agent.yml up --build
```

The agent's bridge connects to the hub and exposes exactly the board tools
(`overview`, `search`, `symbol`, `context`, `write`, `replace`, `check`,
`ticket`, `case`). Drop your agent CLI (Claude Code / Codex) on top and
point it at this single MCP server — with its own native file/shell tools
**denied** (belt and suspenders over the empty filesystem):

```jsonc
// the agent CLI's settings inside the container
{ "permissions": { "deny": ["Read", "Edit", "Write", "Bash"],
                   "allow": ["mcp__k-lani-coder__*"] } }
```

## Codex CLI container

The Codex-specific container runs the official Codex CLI in the same model:
no repo mount, `k-lani-coder` as a required MCP server, read-only Codex
sandbox, approval `never`, and no `/bin/sh` in the image. Native shell
commands fail; project reads and writes must go through the MCP bridge.

```bash
# 1) HOST: the hub owns the repo and binds loopback by default.
k-lani-coder serve --hub 127.0.0.1:8790 --data-dir data/coder --workspace .

# 2) one-time ChatGPT/Codex auth inside the container volume.
docker compose -f publish/k-lani-coder/docker-compose.codex-agent.yml \
  run --rm codex-agent login

# 3) run one ticket as a worker.
KLANI_TICKET=7aed3684 \
KLANI_ROLE=worker \
KLANI_AGENT_ID=gpt-5.5-xhigh-codex-subscription \
KLANI_MODEL=gpt-5.5 \
KLANI_REASONING_EFFORT=xhigh \
KLANI_PROMPT='Work the assigned ticket using only k-lani-coder MCP.' \
  docker compose -f publish/k-lani-coder/docker-compose.codex-agent.yml \
    run --rm codex-agent
```

The same compose file also has an explicit planner profile for one-ticket dry
runs through the ChatGPT/Codex subscription path. It keeps the repository out
of the container and sets `KLANI_ROLE=planner`, `KLANI_AGENT_ID` to the exact
planner deployment identity, and `KLANI_REASONING_EFFORT=medium`:

```bash
KLANI_TICKET=66031272 \
KLANI_PROMPT='Dry-run a planner pass for this ticket. Do not edit files.' \
  docker compose -f publish/k-lani-coder/docker-compose.codex-agent.yml \
    --profile planner run --rm codex-planner
```

Use `KLANI_TICKET` for a real board ticket so the usage row can be joined back
to the ticket. A successful planner dry run appends a row to
`data/coder/agent-usage/codex/codex-usage.ndjson` through the `/usage` bind.
The board consumes that NDJSON file directly from `data/coder`: each row keeps
`role: "planner"`, `agent`, `model`, `effort`, `ticket`, `run_id`,
the Codex `runtime_profile`, MCP mode, enabled tools, internal step counts,
context-pack metadata, token totals, and `billing: "subscription"`.
Subscription runs deliberately keep `cost_micros: null` because the product
accounting is flat-rate, not per-call Platform API billing.

Subscription billing is the default and the wrapper refuses `CODEX_API_KEY`
or `OPENAI_API_KEY` while `KLANI_BILLING=subscription`. That keeps this
container on the ChatGPT/Codex login path instead of silently falling back to
Platform API billing.

Token visibility for this path comes from Codex itself. `codex exec --json`
emits a `turn.completed` event with token counters; the wrapper stores the
raw JSONL in `/usage/codex-events-<run>.jsonl` and appends a normalized row to
`/usage/codex-usage.ndjson`. It also writes
`/usage/codex-run-state-<run>.ndjson` and
`/usage/codex-stderr-<run>.log` so a long-running or stuck process can be
classified without guessing: the state file records start, every visible Codex
event, heartbeat rows, stderr byte counts, the last event type, and the final
exit status. If a run stops after `turn.started` and only heartbeat rows follow,
Codex has not emitted agent text, tool calls, or usage yet; that is a CLI/model
wait state, not a hidden k-lani board action. Codex JSON mode can stay silent
for a long active model turn, so the no-progress guard treats both visible
`exec --json` events and payload-free OTel liveness batches as progress. Each
new liveness batch moves the timeout window forward. If neither visible events
nor OTel liveness arrive for `KLANI_AGENT_NO_PROGRESS_TIMEOUT_MS`
milliseconds, the run is treated as stalled; the default is `180000`, the exit
code is `124`, and `0` disables the guard.
`KLANI_AGENT_SILENT_TURN_TIMEOUT_MS` can be set to abort a single silent model
turn explicitly. It uses the same liveness-reset rule and defaults to `0`, so
the outer role timeout remains the benchmark boundary for long reasoning calls.
`KLANI_CAPTURE_PROMPT_INPUT=1` additionally
renders the model-visible input with `codex debug prompt-input` into
`/usage/codex-prompt-input-<run>.json`; this is opt-in because it is diagnostic
evidence, not part of the cheapest benchmark path. In the bundled compose file,
`/usage` is bound to `data/coder/agent-usage/codex` on the host so the live
board can display those ticket tokens without entering the Docker volume:

The wrapper also starts a local payload-free OpenTelemetry liveness sink by
default. Codex sends its own OTel logs to `127.0.0.1` with
`otel.log_user_prompt=false`; the wrapper stores only counters in
`codex-run-state-<run>.ndjson`: request count, received byte count, Codex
API-request events, SSE events, WebSocket events, output-text delta counts,
`response.in_progress`, `response.completed`, parse failures, and time since
the last liveness batch. Raw OTel bodies, prompts, deltas, and responses are
not written anywhere by this sink. Set
`KLANI_CODEX_OTEL_LIVENESS=0` to disable it for a control run.

```bash
docker compose -f publish/k-lani-coder/docker-compose.codex-agent.yml \
  run --rm codex-agent usage
```

Those rows are deliberately separate from `k-lani-ai-proxy` cost rows:
subscription-backed Codex gives real token counters, but not per-call API
cost. The normalized row therefore keeps `cost_micros: null` and records the
raw event and prompt-input artifact paths for later ticket evidence.

Codex runtime profiles are selected per exact deployment or ticket contract:
`codex_one_shot_minimal` disables MCP, shell, web search, project instructions,
and subagents; `codex_one_shot_with_gate` keeps shell access for an isolated
workspace; `codex_mcp_limited` exposes only the configured k-lani MCP tool
allowlist; `codex_mcp_full` is the expensive fallback. Legacy tickets without a
profile are recorded as `codex_mcp_full_legacy`.

## Codex OpenTelemetry collector

Interactive Codex surfaces such as the IDE extension do not necessarily run
through `codex exec --json`, so the Docker wrapper is not enough to measure
those sessions. Use Codex's official OpenTelemetry export and the local
collector instead:

```bash
k-lani-coder otel-collector \
  --bind 127.0.0.1:4318 \
  --data-dir data/coder \
  --role planner \
  --phase interactive \
  --agent-id gpt-5.5-medium-codex-subscription \
  --model gpt-5.5 \
  --effort medium
```

Then add a user-level Codex config layer in `~/.codex/config.toml` or in the
selected Codex profile. Project `.codex/config.toml` files are intentionally
ignored for telemetry routing by Codex.

```toml
[otel]
environment = "k-lani"
log_user_prompt = false
trace_exporter = { otlp-http = {
  endpoint = "http://127.0.0.1:4318/v1/traces",
  protocol = "json",
  headers = {
    "x-k-lani-agent" = "gpt-5.5-medium-codex-subscription",
    "x-k-lani-role" = "planner",
    "x-k-lani-phase" = "interactive",
    "x-k-lani-model" = "gpt-5.5",
    "x-k-lani-effort" = "medium",
    "x-k-lani-billing" = "subscription",
  }
}}
```

For ticket-bound work, add `"x-k-lani-ticket" = "<id8>"` to the headers or
start the collector with `--ticket <id8>`. Unlike the wrapper's liveness-only
sink, the standalone collector writes raw OTLP payloads to
`data/coder/agent-usage/codex/otel-raw/` and normalized token rows to
`data/coder/agent-usage/codex/codex-usage.ndjson`, the same file the board
already reads. Use `protocol = "json"`; binary OTLP payloads are preserved for
diagnosis but not normalized by the built-in std-only receiver.

To inspect the request body while staying on the Pro/ChatGPT path, point Codex
at the proxy with OpenAI auth passthrough:

```bash
KLANI_TICKET=7aed3684 \
KLANI_ROLE=worker \
KLANI_CODEX_PROXY_URL=http://127.0.0.1:8789/t/7aed3684/worker/v1 \
  docker compose -f publish/k-lani-coder/docker-compose.codex-agent.yml \
    run --rm codex-agent
```

The wrapper configures a Codex custom provider with
`requires_openai_auth=true`; no API key is needed. The proxy must never log
the `Authorization` header, because it is the ChatGPT/Codex credential.

## Claude Code container

The Claude-specific container follows the same MCP-only shape: no repo mount,
`k-lani-coder` as the only MCP server, built-in Claude Code tools disabled
with `--tools ""`, and permission mode `dontAsk` so only
`mcp__k_lani_coder__*` is auto-approved. The image also removes `/bin/sh` and
`/bin/bash`; if permissions regress later, generated shell commands still fail.

```bash
# 1) HOST: the hub owns the repo and binds loopback by default.
k-lani-coder serve --hub 127.0.0.1:8790 --data-dir data/coder --workspace .

# 2) one-time Claude subscription auth inside the container volume.
docker compose -f publish/k-lani-coder/docker-compose.claude-agent.yml \
  run --rm claude-agent login

# Optional after login: create Claude's long-lived subscription token too.
docker compose -f publish/k-lani-coder/docker-compose.claude-agent.yml \
  run --rm claude-agent setup-token

# 3) run one ticket with Claude Opus 4.8 at medium effort.
KLANI_TICKET=7aed3684 \
KLANI_ROLE=worker \
KLANI_AGENT_ID=opus-4-8-medium-claude-code-subscription \
KLANI_MODEL=claude-opus-4-8 \
KLANI_REASONING_EFFORT=medium \
KLANI_PROMPT='Work the assigned ticket using only k-lani-coder MCP.' \
  docker compose -f publish/k-lani-coder/docker-compose.claude-agent.yml \
    run --rm claude-agent
```

Subscription billing is the default and the wrapper refuses
`ANTHROPIC_API_KEY` while `KLANI_BILLING=subscription`. Claude's home
directory is a Docker volume so both `~/.claude/` and `~/.claude.json` survive
container restarts. That keeps this container on Claude Code subscription auth
instead of silently switching to API-key billing.

Token visibility for this path comes from Claude Code itself. `claude -p
--output-format stream-json --verbose` emits assistant/result events with
token usage; the wrapper stores the raw JSONL in
`/usage/claude-events-<run>.jsonl`, writes the exact prompt and generated MCP
config to `/usage/claude-prompt-<run>.json` and
`/usage/claude-mcp-<run>.json`, and appends a normalized row to
`/usage/claude-usage.ndjson`. In the bundled compose file, `/usage` is bound
to `data/coder/agent-usage/claude` on the host so the live board can display
those ticket tokens without entering the Docker volume:

```bash
docker compose -f publish/k-lani-coder/docker-compose.claude-agent.yml \
  run --rm claude-agent usage
```

Those rows include real token counters and Claude's estimated cost when it is
present in the result event. For subscription runs `cost_micros` stays `null`
because the run is flat-rate from our product accounting perspective, not a
per-call API bill.

Claude also supports the token-sparse one-shot worker profile:
`runtime_profile: claude_one_shot_minimal`. In that mode the launcher builds
the same measured context pack as Codex one-shot, sets `KLANI_MCP_MODE=none`,
omits `--mcp-config`, keeps native Claude tools disabled, and expects the
final answer to contain a `KLANI_ONE_SHOT_RESULT_BEGIN` /
`KLANI_ONE_SHOT_RESULT_END` JSON block. The host then applies the returned
files through the normal guarded write/replace path, so ticket source-diff
evidence is still WORM-recorded. One-shot context packs default to a 60k token
slice target and reject requests above the 120k hard cap; larger work must be
split into bounded module or library slices.

Claude Code writes the same operational diagnostics as Codex:
`/usage/claude-run-state-<run>.ndjson` plus
`/usage/claude-stderr-<run>.log`. The raw stream remains the source of truth,
but the run-state file is the fast health view: start row, visible stream-json
events, text previews, usage-bearing events, heartbeat rows, and exit status.

## Restarting Broken Agent CLIs

The wrappers do not hide a broken Codex or Claude Code CLI. If a run emits only
a start/turn event plus heartbeats, inspect the matching stderr log first. If
the CLI is wedged or was upgraded into a bad state, rebuild the image and start
from a fresh one-shot container:

```bash
docker compose -f publish/k-lani-coder/docker-compose.codex-agent.yml \
  build --no-cache codex-agent
docker compose -f publish/k-lani-coder/docker-compose.codex-agent.yml \
  down --remove-orphans

docker compose -f publish/k-lani-coder/docker-compose.claude-agent.yml \
  build --no-cache claude-agent
docker compose -f publish/k-lani-coder/docker-compose.claude-agent.yml \
  down --remove-orphans
```

These commands rebuild the CLI images and remove stale containers. They do not
delete the subscription-auth volumes. If auth itself is broken, rerun the
corresponding `login` command rather than mixing API keys into a subscription
benchmark.

## Why host networking (and the trade-off)

The hub carries write clearance. By default it therefore refuses
non-loopback binds and listens on `127.0.0.1`. `network_mode: host` lets an
agent container reach that loopback hub.

Host networking does **not** grant filesystem access: no mount = no repo
(the leak we care about stays shut). What it weakens is **network**
isolation — the agent shares the host's network namespace. To close that gap,
run the hub with an env-sourced token and a non-loopback/private-network bind:

```bash
K_LANI_CODER_HUB_TOKEN=<secret> \
  k-lani-coder serve --hub 0.0.0.0:8790 \
    --hub-token-env K_LANI_CODER_HUB_TOKEN \
    --data-dir data/coder --workspace .
```

Then remove `network_mode: host`, set `KLANI_HUB` to the reachable hub address,
and pass the same `K_LANI_CODER_HUB_TOKEN` into the agent container. Codex and
Claude wrappers can also set `KLANI_HUB_TOKEN_ENV=K_LANI_CODER_HUB_TOKEN` so
their generated MCP bridge explicitly passes `--hub-token-env`.

## Egress (the metering knob)

Same sandbox base, one parameter — the agent's LLM path:

- **API-key / local agents** → point the LLM base URL at the proxy with a
  ticket prefix: `http://127.0.0.1:8080/t/<ticket>/<role>/v1` (roles:
  `planner|worker|review`). Tokens + cost are then measured and joined to
  the agent in the per-agent economics report.
- **Subscription Codex agents** → direct by default, or through
  `KLANI_CODEX_PROXY_URL` with `requires_openai_auth=true` when the request
  body must be audited. Token counters still come from Codex JSONL; per-call
  API cost remains unavailable because this is not Platform API billing.
- **Subscription Claude Code agents** → direct by default, metered from
  Claude's stream-json result events. If request-body audit is needed later,
  route Claude Code through `ANTHROPIC_BASE_URL` and the proxy in transparent
  auth-passthrough mode; the wrapper usage log remains the local truth for the
  isolated Docker run.

## Smoke test (the acceptance proof)

```bash
# (1) ISOLATION — the agent container sees no repo:
docker run --rm --entrypoint sh k-lani-coder-agent:2026.24.10 \
  -c 'ls /work 2>&1 || echo "NO /work"; ls /<your-repo-path> 2>&1 || echo "NO repo"'
#   -> NO /work / NO repo

# (2) MCP PATH — a throwaway loopback hub + the agent over host net:
docker run -d --name kc-smoke-hub --network host -v /tmp/kc-smoke-work:/work \
  k-lani-coder:2026.24.10 \
  k-lani-coder serve --hub 127.0.0.1:8791 --data-dir /data --workspace /work
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
 | docker run --rm -i --network host k-lani-coder-agent:2026.24.10 \
     serve --connect 127.0.0.1:8791 --agent-id sandbox-smoke --level 2
#   -> the response lists the board tools incl. "ticket", "write", "context"
docker rm -f kc-smoke-hub
```

Both parts together are the proof: the agent can do all its work (slices in,
guarded writes out) over MCP **while seeing none of the repo**.
