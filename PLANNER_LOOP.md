# Autonomous Planner Loop Operator Guide

This guide is for the operator who runs k-lani-coder as a board-driven
multi-agent system. It describes the implemented operating model only. It
does not claim that the loop can replace owner judgment, review, or release
approval.

## Roles

| Role | Runtime identity | Responsibility |
|---|---|---|
| Owner | Human operator | Fills backlog, supplies missing product decisions, approves worker launch when policy requires it, reviews release risk, and changes policy. |
| Planner | Exact registered deployment, for example `gpt-5.5-medium-codex-subscription` | Turns a backlog idea into a ticket contract: scope, `allowed_symbols`, gate, done criteria, level, context budget, model or model pool, and assumptions. |
| Advisor | One or more exact deployments | Adds structured perspective evidence to a backlog idea before planning. Advisor evidence is input to planning, not proof of implementation. |
| Worker | Exact registered deployment | Claims one open ticket and changes code only through the MCP bridge. Source changes are valid evidence only when they pass the guarded `write` or `replace` path. |
| Reviewer | Different actor than the submitting worker | Approves or rejects the ticket after reading history, source diffs, gates, and usage evidence. |
| Supervisor | `k-lani-coder planner-loop` | Deterministic board reader. It selects the next loop action from the append-only ledger, applies budget and stop limits, and can optionally launch the official Docker worker command. |

The supervisor does not call an LLM. It reads the board and prints or executes
the next operational step. The LLM roles remain explicit board actors.

## Required Services

Build and index from the repository root:

```bash
cargo build --release -p k-lani-coder
target/release/k-lani-coder index --workspace . --data-dir data/coder
```

Start one hub for the project. The hub owns the data directory and workspace:

```bash
target/release/k-lani-coder serve \
  --hub 127.0.0.1:8790 \
  --data-dir data/coder \
  --workspace . \
  --proxy-log /tmp/kcoder-proxy/proxy.log
```

Start the live board in another terminal:

```bash
target/release/k-lani-coder board-web \
  --data-dir data/coder \
  --bind 127.0.0.1:8788 \
  --proxy-log /tmp/kcoder-proxy/proxy.log
```

While the hub is running, command-line board writes against the same data
directory fail fast. Use the MCP `ticket` tool through a bridge session for
`new`, `plan`, `note`, `claim`, `submit`, `approve`, and `reject`. Read-only
commands such as reports remain safe.

## Docker Agent Login

Codex subscription agent:

```bash
docker compose -f publish/k-lani-coder/docker-compose.codex-agent.yml \
  run --rm codex-agent login
```

Claude Code subscription agent:

```bash
docker compose -f publish/k-lani-coder/docker-compose.claude-agent.yml \
  run --rm claude-agent login

docker compose -f publish/k-lani-coder/docker-compose.claude-agent.yml \
  run --rm claude-agent auth-status
```

The containers do not mount the repository. By default they reach the
host-side hub over loopback with host networking and expose k-lani-coder as
the only project access path. To avoid host networking, start the hub on a
private/reachable address with an env-sourced token:

```bash
K_LANI_CODER_HUB_TOKEN=<secret> \
  k-lani-coder serve --hub 0.0.0.0:8790 \
    --hub-token-env K_LANI_CODER_HUB_TOKEN \
    --data-dir data/coder --workspace .
```

Then set the agent container's `KLANI_HUB` to that reachable address and pass
the same `K_LANI_CODER_HUB_TOKEN`. Codex and Claude wrappers also accept
`KLANI_HUB_TOKEN_ENV=K_LANI_CODER_HUB_TOKEN` to pass the token env-var name to
their generated MCP bridge config. Without a token, non-loopback hub binds are
still denied.

## Planner Dry Runs

Run a planner pass inside the Codex subscription container without editing
files:

```bash
KLANI_TICKET=<id8> \
KLANI_ROLE=planner \
KLANI_AGENT_ID=gpt-5.5-medium-codex-subscription \
KLANI_MODEL=gpt-5.5 \
KLANI_REASONING_EFFORT=medium \
KLANI_PROMPT='Plan this ticket. Do not edit files.' \
  docker compose -f publish/k-lani-coder/docker-compose.codex-agent.yml \
    --profile planner run --rm codex-planner
```

The planner should record its result through the board as a ticket contract,
not as a loose chat answer. A planned contract must contain at least the
implementation scope, gate, done criteria, and level. When the model route is
known, record the exact deployment as `model:` or a single `model_pool:`.

For exact pay-per-token Codex API measurements, run the same container with an
API billing class and let the wrapper derive the ticket route:

```bash
KLANI_BILLING=api \
OPENAI_API_KEY=dummy \
KLANI_CODEX_PROXY_BASE_URL=http://127.0.0.1:8080 \
KLANI_TICKET=<id8> \
KLANI_ROLE=worker \
  docker compose -f publish/k-lani-coder/docker-compose.codex-agent.yml \
    run --rm codex-agent
```

The proxy sees `/t/<ticket>/<role>/v1`, injects the real key from its vault
when configured, and records ticket/role usage as API cost evidence.
Subscription Codex/Claude Code runs stay in the flat-rate billing class; their
wrapper JSONL token rows are useful for credit burn analysis, but they are not
provider-billed API rows.

## Supervisor Dry Run

Ask the deterministic supervisor what it would do next:

```bash
target/release/k-lani-coder planner-loop \
  --data-dir data/coder \
  --workspace . \
  --json \
  --worker-launch off
```

The JSON contains:

- `action`: the next board action, for example `would_request_advice`,
  `would_plan_ticket`, `would_launch_worker`, `would_ask_owner`,
  `would_continue`, or `would_stop`.
- `reason`: the exact stop or action reason.
- `ticket` and `title`: present when the decision applies to one ticket.
- `missing_advisor_roles`: present when backlog evidence is incomplete.
- `launch_worker`: `true` only after enforce mode actually ran the Docker
  command.

Budget and stop limits can come from `k-lani-coder-policy.json` or explicit
flags:

```bash
target/release/k-lani-coder planner-loop \
  --data-dir data/coder \
  --workspace . \
  --json \
  --used-tokens 45000 \
  --budget-tokens 120000 \
  --run-count 2 \
  --max-runs 5 \
  --elapsed-seconds 600 \
  --max-wall-seconds 3600 \
  --max-rejections 2
```

Stop reasons are deterministic:

| Reason | Meaning |
|---|---|
| `budget_exhausted` | The supplied or policy token budget is already spent. |
| `run_limit_exhausted` | The loop reached its maximum run count. |
| `wall_time_exhausted` | The loop reached its wall-time limit. |
| `repeated_rejection_threshold` | A ticket hit the configured rejection threshold. |
| `no_eligible_ticket` | No open ticket is currently runnable at the selected level with dependencies satisfied. |
| `worker_launch_refused` | The worker-launch guard refused the ticket before Docker execution. |

`would_continue` is not a failure. It means a ticket is already in `claimed`
or `review`, so the loop waits instead of launching another worker.

## Project Registry

For several projects, keep each project on its own workspace, data directory,
hub bind, board bind, and usage directories. The planner loop can select one
project from a registry:

```json
{
  "default_project": "acid-fox",
  "projects": [
    {
      "project_id": "acid-fox",
      "display_name": "ACID-Fox",
      "workspace_root": "/d/Projekte/ACID-Fox",
      "data_dir": "/d/Projekte/ACID-Fox/data/coder",
      "board_bind": "127.0.0.1:8788",
      "hub_bind": "127.0.0.1:8790",
      "proxy_log": "/tmp/kcoder-proxy/proxy.log",
      "usage_dirs": {
        "codex": "/d/Projekte/ACID-Fox/data/coder/agent-usage/codex",
        "claude": "/d/Projekte/ACID-Fox/data/coder/agent-usage/claude"
      },
      "policy_path": "/d/Projekte/ACID-Fox/data/coder/k-lani-coder-policy.json",
      "models_path": "/d/Projekte/ACID-Fox/data/coder/k-lani-coder-models.json",
      "status": "active"
    }
  ]
}
```

Run the supervisor against the selected project:

```bash
target/release/k-lani-coder planner-loop \
  --project-registry /absolute/path/k-lani-coder-projects.json \
  --project acid-fox \
  --json
```

Registry selection overrides `--data-dir`, `--workspace`, and worker-launch
hub address. It does not start the hub or board.

## Worker Launch

To see the exact Docker command and environment without executing it:

```bash
target/release/k-lani-coder planner-loop \
  --data-dir data/coder \
  --workspace . \
  --json \
  --worker-launch shadow \
  --hub 127.0.0.1:8790
```

Shadow mode attaches `worker_launch` to the decision. It does not claim,
approve, or run a worker.

To let the supervisor execute the official Docker wrapper:

```bash
target/release/k-lani-coder planner-loop \
  --data-dir data/coder \
  --workspace . \
  --json \
  --worker-launch enforce \
  --hub 127.0.0.1:8790
```

Enforce mode uses the same launch plan as shadow mode. The launch guard
refuses before Docker execution unless all of these are true:

- ticket is `open`;
- acceptance criteria are present;
- `allowed_symbols` is valid against the indexed graph, except explicit file
  targets for new files;
- recorded `model:` or single `model_pool:` is still registered, qualified,
  cleared for the ticket, and valid for the worker role;
- the assignee route can be claimed;
- source workspace is clean;
- runtime kind is an official Docker wrapper: `codex` or `claude-code`.

If policy requires owner approval before launch, add a WORM note through the
board before running enforce mode:

```text
worker_launch_approved: run the sandboxed worker
```

The marker must be recorded by the owner actor. It is intentionally not a
planner self-approval.

Manual worker execution is still available when the operator wants to inspect
the command first:

```bash
KLANI_TICKET=<id8> \
KLANI_ROLE=worker \
KLANI_AGENT_ID=gpt-5.5-medium-codex-subscription \
KLANI_MODEL=gpt-5.5 \
KLANI_REASONING_EFFORT=medium \
KLANI_PROMPT='Work the assigned ticket using only k-lani-coder MCP.' \
  docker compose -f publish/k-lani-coder/docker-compose.codex-agent.yml \
    run --rm codex-agent
```

## Evidence Review

Use the live board ticket detail before approving:

```text
http://127.0.0.1:8788
```

Review these sections:

- history: backlog, plan, claim, notes, submit, approve or reject;
- advisor evidence: usable structured advisor records and missing roles;
- model identity: exact registered deployment, runtime kind, billing class,
  checkpoint, and effort;
- measured usage and cost: role/phase rows joined from proxy or wrapper logs;
- applied source changes: ticket-scoped WORM diffs created by guarded
  `write` or `replace`;
- gate result: the command named in the ticket contract.

The source diff viewer proves only k-lani-coder guarded writes. Native file
edits, manual Git changes, and unscoped agent filesystem tools are not safe
source-change evidence for a ticket.

CLI reports are useful after a run:

```bash
target/release/k-lani-coder report \
  --data-dir data/coder \
  --proxy-log /tmp/kcoder-proxy/proxy.log \
  --notes
```

## Token Visibility

Token evidence depends on the runtime path.

| Runtime path | Evidence source | What is visible |
|---|---|---|
| API-key or local OpenAI-compatible agent through `k-lani-ai-proxy` | Proxy ledger and proxy log | Ticket, role, model, prompt tokens, completion tokens, total tokens, and calculated cost when pricing is registered. |
| Codex subscription Docker wrapper | `data/coder/agent-usage/codex/codex-usage.ndjson` plus raw Codex JSONL | Ticket, role, model, effort, input tokens, cached input, output, reasoning output, total tokens. Per-call API price is unavailable because billing is flat-rate subscription. |
| Claude Code subscription Docker wrapper | `data/coder/agent-usage/claude/claude-usage.ndjson` plus raw stream JSONL | Ticket, role, model, effort, token counters, and provider-estimated cost when emitted. Product accounting still treats subscription runs as flat-rate. |
| Interactive Codex surfaces | `k-lani-coder otel-collector` normalized rows | Token rows when Codex exports OpenTelemetry with the k-lani headers. Use `--ticket` or `x-k-lani-ticket` for ticket attribution. |

Flat-rate subscription rows should show tokens but keep `cost_micros: null`.
That is not missing API cost; it is the billing class. If a ticket shows
unattributed or unmeasured usage, the run did not carry enough role/ticket
metadata for audit-grade economics.

For API-key or local agents, use the ticket route prefix:

```text
http://127.0.0.1:8080/t/<ticket-id8>/<planner|worker|reviewer>/v1
```

The prefix is stripped before the upstream call and stamped into the proxy
ledger. The board joins those rows to the ticket.

## Failure Playbook

### `missing_advisor_evidence`

The backlog idea does not yet have usable structured advisor evidence for all
required roles. Run advisor passes and record them through the MCP `ticket`
`advise` action. Do not promote the ticket by hand unless the owner accepts
the missing perspective as a conscious process exception.

### `missing_owner_input_marker`

The ticket spec contains `owner_input_required:` and no history note contains
`owner_input:`. Add the owner decision as a board note, or change the ticket
contract if the marker was unnecessary. Do not let the worker infer a product
decision from silence.

### `missing_worker_launch_approval`

Policy requires owner approval before Docker launch. The owner records:

```text
worker_launch_approved: <reason>
```

Then rerun the supervisor.

### `repeated_rejection_threshold`

Stop the loop. The planner should read the reject notes, source diffs, and
gate output, then either re-plan with a smaller scope, escalate the model,
ask the owner for a product decision, or close the ticket as not worth the
remaining budget.

### `worker_launch_refused`

Read the `explanation` field. Common causes:

- `allowed_symbols` names an unknown symbol;
- the route points to an unregistered or unqualified deployment;
- the deployment lacks the worker task contract or sufficient level/context;
- classification residency denies the route;
- workspace has dirty source;
- runtime kind is not `codex` or `claude-code`;
- the index is missing and graph validation cannot run.

Fix the contract or environment first. Do not bypass with a native filesystem
agent run if the ticket needs audited source diffs.

### `budget_exhausted`, `run_limit_exhausted`, or `wall_time_exhausted`

Treat the stop as an accounting boundary. Increase the limit only with an
owner note that explains why the additional spend is justified. Otherwise
close, split, or downgrade the ticket.

### `no_eligible_ticket`

Check for blocked dependencies, levels above the selected worker level,
classification clearance, missing routes, or all work already being in
`claimed` or `review`. The supervisor is reporting that no safe next launch
exists, not that the project is complete.

### Dirty Source

The launch guard refuses a dirty workspace because it cannot separate worker
output from existing edits. Commit, stash, or move unrelated changes outside
the test workspace before launching an audited worker.

## What Remains Manual

The owner still decides priorities, ambiguous product behavior, acceptable
risk, budget increases, policy changes, release approval, and whether a
subscription run is economically useful despite lacking per-call API billing.
The planner records judgments; the supervisor only enforces deterministic
loop mechanics around those judgments.
