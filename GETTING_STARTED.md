# Getting started with k-lani-coder

k-lani-coder gives AI coding agents a minimal, audited view of your
Rust, TypeScript, C#, or Python codebase: per-symbol context slices
under a token budget instead of whole files, hash-guarded writes behind
a guard chain, a compile/test gate as the only acceptance authority,
and a WORM ticket board that turns multi-agent work into auditable data.

Prerequisites: Linux x86_64, a Rust toolchain (`cargo`, `rustfmt` —
the harness uses them as its write gate), and an agent frontend
(Codex, Claude Code, [opencode](https://opencode.ai), or any MCP-capable
frontend).

This is a **declared evaluation build**: `k-lani-coder --version`
shows its expiry date. After that date the operational commands
(`index`, `serve`) refuse to start and point you at the current
release — everything read-only (`ticket list/show`, `report`,
`context`, `codemap`) keeps working forever. Your data is never
hostage.

## 1. First five minutes — one command

```bash
sha256sum -c bin/SHA256SUMS
install -m 0755 bin/k-lani-coder bin/k-lani-ai-proxy ~/.local/bin/

cd /path/to/your/repo              # cargo workspace or single crate
k-lani-coder onboard               # existing repo? baseline-format ritual FIRST
k-lani-coder quickstart            # index + session hub + live board
```

`onboard` protects you from the giant first diff: the write gate
force-formats every model write, so an unformatted repo gets ONE
dedicated style-only commit first — gate green before AND after
(proving the formatting changed nothing), and the commit hash goes
into `.git-blame-ignore-revs` so blame keeps pointing at the real
authors. Repeat the ritual whenever you change style configuration.

`quickstart` indexes the workspace, creates policy and model
registry, starts the session hub and the live board, and ends with
the three-step script to your first delivered ticket (wire the
conductor into your chat frontend, say "we need X", watch the
board). Everything it starts is loopback-only; Ctrl-C stops it,
reads survive forever. The manual route, piece by piece:

```bash
k-lani-coder index --workspace . --data-dir data/coder
k-lani-coder context --symbol your_function --data-dir data/coder
# add data/ to .gitignore if it is not already
```

The cold index of a ~700-file workspace takes ~10 s; incremental
runs are ~1 s (unchanged files skip by hash). The context output is
what your agent will see: target symbol in full, direct dependencies
in full, indirect ones as signatures, everything else honestly
listed under `omitted`.

## 2. Wire it into an agent

MCP is the transparent control surface. Your agent still runs as Codex, Claude
Code, opencode, or another MCP-capable frontend; k-lani-coder supplies the
project tools underneath it. In strict mode the agent has no native project
file/shell tools, so reads, writes, tickets, gates, usage evidence, and WORM
diffs all pass through the harness.

**Codex CLI / IDE** (user or trusted project config):

```toml
[mcp_servers.k-lani-coder]
command = "k-lani-coder"
args = ["serve", "--data-dir", "data/coder", "--workspace", "."]
```

Codex stores MCP servers in `config.toml`; the CLI and IDE extension share that
configuration. For subscription-backed measurement, use the Docker wrapper in
`AGENT_SANDBOX.md`: it logs in through the official ChatGPT/Codex flow, runs
`codex exec --json`, and records the token counters emitted by Codex.

**Claude Code** (per project):

```bash
claude mcp add --scope project k-lani-coder -- \
  k-lani-coder serve --data-dir data/coder --workspace .
```

For subscription-backed measurement, use the Claude Docker wrapper in
`AGENT_SANDBOX.md`: it logs in through Claude Code, disables native project file
access, and records Claude Code's stream-json usage events.

Measurement caveat: official agent frontends are not raw API calls. Our
subscription-wrapper measurements have repeatedly shown about 7-8k input tokens
of fixed Codex/Claude Code runtime context per call before the task-specific
context pack. k-lani-coder records that overhead because the CLI emits it and it
affects the measured run, but it is not part of the selected source slice. Use
API-key mode through `k-lani-ai-proxy` when you need raw provider-call cost
without native agent frontend overhead.

**opencode** — note that the native file tools are disabled so the
ONLY path to code is the harness (`prompts/` ships the profiles):

```json
{
  "mcp": { "k-lani-coder": { "type": "local", "enabled": true,
    "command": ["k-lani-coder", "serve",
                 "--data-dir", "data/coder", "--workspace", "."] } },
  "agent": { "coder": { "prompt": "{file:./prompts/prompt.md}",
    "tools": { "read": false, "grep": false, "glob": false,
               "edit": false, "write": false, "bash": false } } }
}
```

Serve flags that matter:

| Flag | Purpose |
|---|---|
| `--agent-id <name>` | identity for board claims/submits (four-eyes rule) |
| `--level <1-3>` | worker pay grade; `next` only serves tickets it may take |
| `--ticket <id>` | scope ALL writes to that ticket's `allowed_symbols` |
| `--clearance full` | owner-only: disables the write policy bouncer |
| `--proxy-log <file>` | host-only runtime evidence for planner routing |

One serve per data dir: the engine's tables are single-writer. While
a server runs, board WRITES from the CLI fail fast and tell you to
use the MCP ticket tool instead; reads always work.

**Concurrent agents** (T-54): run ONE session hub that owns the
tables, and one thin bridge per agent — your runtimes keep spawning
plain stdio commands, nothing else changes:

```bash
# the hub (one writer, loopback only):
k-lani-coder serve --hub 127.0.0.1:8790 --data-dir data/coder --workspace . \
  --proxy-log /path/to/k-lani-ai-proxy.log

# each agent's MCP entry spawns a bridge with ITS identity:
k-lani-coder serve --connect 127.0.0.1:8790 --agent-id gemma4-12b --level 1
k-lani-coder serve --connect 127.0.0.1:8790 --agent-id gpt-5.5-xhigh --level 3
```

Every guard (four-eyes, model pin/pool, classification clearance,
ticket scope, pay grade) keys on the per-session identity. Writes
serialize inside the hub — milliseconds, while model thinking takes
minutes; the planner keeps conflicts impossible by cutting contracts
with disjoint `allowed_symbols`.

**Conductor mode** (T-57): talk to ONE assistant in plain language
("we need X, please get it done") and let it drive the whole board.
Add a bridge session to any MCP-capable chat frontend with
`prompts/prompt-conductor.md` as its instructions:

```bash
k-lani-coder serve --connect 127.0.0.1:8790 --agent-id conductor --level 3
```

The conductor files the intake, refines it as note events on the
same ticket, cuts contracts only when confident, monitors, and
reports back without jargon. It is an agent like every other:
four-eyes binds it, its tokens are metered, its contracts attribute
to it.

## 3. The board: agents pull their own work

```bash
# the owner drops an idea
k-lani-coder ticket new --backlog --title "faster parser" \
  --spec-file idea.md --category rust_impl --data-dir data/coder

# the planner promotes it to a CONTRACT (allowed_symbols are
# validated against the symbol graph before promotion)
k-lani-coder ticket move <id8> open --spec-file contract.md \
  --data-dir data/coder
```

A contract spec is plain text with convention lines:

```
Speed up lex(); keep the public signature.
allowed_symbols: lex
gate: my-crate lex_
done: gate green, no vanished-symbol warnings
level: 1
tags: parser, perf
```

Workers serve with `--ticket <id8>` and literally cannot write
outside `allowed_symbols`. Submits go to `review`; nobody can
approve or reject their own submission (enforced in code, not
prompt). `k-lani-coder report --notes` folds the whole WORM history
into a per-model report card — per category AND per skill tag.

Watch the sprint live in the browser (read-only, runs alongside a
live serve, loopback-only by default):

```bash
k-lani-coder board-web --data-dir data/coder   # http://127.0.0.1:8788
```

Each card shows the planner's routing decision — chosen model, level,
skill tags, attempt count — and the header counts the context tokens
actually served, measured from the audit ledger. Add
`--proxy-log <file>` and cards also show what each ticket cost:
total tokens per model on the card, per-phase input/output/price on
hover — fed by the proxy's ticket routing prefix (see `PROXY.md`).

## 4. Model profiles

`data/coder/k-lani-coder-models.json` is your model registry: one
entry per EXACT deployment (checkpoint + quantization + runtime),
with per-role generation parameters, output contracts, and prompt
files. Planner agents read it live via the `ticket` tool's `models`
action. Rule we learned the hard way: there are no global model
rules — the same family behaves differently per checkpoint and per
quantization.

For a real routing decision, the planner calls `ticket` action=`route` with
the ticket id and its draft contract. The result lists every exact deployment
as eligible or excluded with reasons, its worker rules, level/context and
residency facts, price/limits, WORM category/tag history, and optional proxy
availability. Code never picks the winner. The planner records `model:` or
`model_pool:`, and that recorded route is revalidated at plan and claim time.
Bridge sessions cannot override the hub's `--proxy-log` path.

## 5. Cloud or local models

Point your agent runtime at any OpenAI-compatible endpoint through
the bundled **k-lani-ai-proxy** — key custody, token ledger, OpenAI
as the default upstream; see `PROXY.md`. Local models via
llama.cpp's `llama-server` work well; measured reference numbers
live in `BENCHMARKS.md` and `SHOWCASE.md`.

## 6. Docker

The database engine is embedded in `k-lani-coder`; no database container is
missing. `index` creates `.mkx`, memo, and WAL files under `--data-dir`.
`docker compose up` intentionally starts only the metering proxy.

```bash
# source-repository builds: refresh bin/ before Docker copies it
bash publish/k-lani-coder/build.sh
cd publish/k-lani-coder
docker build -t k-lani-coder:2026.24.10 .

# the image runs as a non-root user (uid 10001); when you mount your
# repo, pass YOUR uid so the index can write its data dir:
docker run --rm --user $(id -u):$(id -g) -v /path/to/repo:/work \
  k-lani-coder:2026.24.10 \
  k-lani-coder index --workspace /work --data-dir /work/data/coder

# proxy with dashboard (default CMD):
cp .env.example .env   # set your upstream + key
docker compose up      # proxy on 127.0.0.1:8080, loopback only

# exact API-key attribution for a Codex ticket run:
KLANI_BILLING=api \
OPENAI_API_KEY=dummy \
KLANI_CODEX_PROXY_BASE_URL=http://127.0.0.1:8080 \
KLANI_TICKET=<id8> \
KLANI_ROLE=worker \
  docker compose -f publish/k-lani-coder/docker-compose.codex-agent.yml \
    run --rm codex-agent

# subscription/OAuth runs remain flat-rate wrapper evidence; do not present
# them as exact provider-billed API cost.

# coder live board from the persistent .mkx data in your repository:
docker run --rm --user $(id -u):$(id -g) \
  -p 127.0.0.1:8788:8788 -v /path/to/repo:/work \
  k-lani-coder:2026.24.10 k-lani-coder board-web \
  --data-dir /work/data/coder --bind 0.0.0.0:8788 --allow-remote
```

The proxy dashboard shows request payloads (your code) — keep it
loopback-only, see `SECURITY.md`. The board uses `--allow-remote` only so it
can listen across the container boundary; the published host port remains
loopback-only. A `[wal] direct I/O unavailable` notice is expected in common
Docker environments; the engine falls back to buffered writes with fsync
without weakening durability semantics.
