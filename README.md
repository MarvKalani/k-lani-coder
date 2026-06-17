# k-lani-coder — Closed Binary Release (Demo Bundle)

![k-lani-coder](k-lani-coder-logo.webp)

**Release 2026.24.10** — versions are CalVer `YEAR.ISOWEEK.SEQ`, so you
can always tell how old a build is at a glance (`k-lani-coder
--version`). Same-week re-releases bump the final number (0–99).

A symbol-slice context harness and agent orchestration system for AI
coding, built on the k-lani database engine. It serves any MCP-capable
agent frontend (Codex, Claude Code, opencode) exactly one budgeted slice of
your Rust, TypeScript, C#, or Python codebase per task, guards every write with
a chain of independent safety layers, and runs a WORM ticket board where
planner and worker models hand each other contracts under a
code-enforced four-eyes rule — every step lands in an immutable audit
ledger you can inspect yourself.

## Why test it now

Normal coding agents are useful, but they tend to spend heavily because they
read broadly. k-lani-coder turns the task into a need-to-know contract: the
worker gets the goal, the gate, the exact writable files/symbols, selected
knowledge facts, and the neighboring APIs it needs — not a whole repository
tour.

The corrected public Northwind runs currently prove a narrower engineering
fact: when the write boundary is already known or deterministically supplied, a
one-shot context pack can be much smaller than broad native repository access.
They do **not** yet prove an end-to-end autonomous planner+worker token saving.
The latest repeat calibration measured native direct at **242,250–435,203
tokens** across 3/3 accepted samples. The known-scope k-lani worker/repair path
measured **16,208–16,525 tokens** on its accepted samples, but only **2/3**
samples passed. Until both paths have repeated accepted samples under matching
accounting boundaries, the honest public cost statement is: **no publishable
savings percentage yet**.

The bundle includes the fixture, repeat runner, raw usage rows, WORM
source-diff evidence, and the benchmark spec so you can rerun the measurement
instead of trusting a headline.

## Polyglot lanes

k-lani-coder is not Rust-only. The public bundle indexes and gates these source
lanes on Linux:

| Language | Indexed files | Gate / beautify behavior |
|---|---|---|
| Rust | `.rs` | `cargo check` / `cargo test`; rustfmt on write by default |
| TypeScript / JavaScript | `.ts`, `.tsx`, `.js`, `.mjs` | project-local `tsc` / `vitest`; project-local Prettier on write when available |
| C# | `.cs` | `dotnet build` / `dotnet test`; optional `dotnet format`; optional StyleCop analyzer check/enforce |
| Python | `.py` | `python3 -m compileall -q`; optional `pytest`; optional `ruff format` / `black` |

The index itself is std-only and does not require external toolchains.
Optional beautifiers and analyzers run only when the project policy or ticket
gate enables them and the tool is already present in the project or system.
The harness does not install SDKs, NuGet packages, npm packages, ruff, black,
pytest, or StyleCop for you; missing opt-in tools produce a clear failure
instead of silently weakening the gate.

## How it uses Codex and Claude subscriptions

k-lani-coder does not turn a ChatGPT, Codex, or Claude subscription into a raw
API key. Subscription runs stay on the provider's official CLI path:

- **OpenAI/Codex subscription:** the isolated worker runs the official Codex
  CLI with ChatGPT/Codex login state, and k-lani-coder is exposed as the only
  project MCP server or as a measured one-shot context pack.
- **Claude subscription:** the isolated worker runs Claude Code with Claude
  subscription auth, with native project file access disabled and k-lani-coder
  as the controlled context/write path.
- **API-key mode:** if you want per-call API billing and exact provider cost,
  use `k-lani-ai-proxy` with your own OpenAI-compatible or Anthropic endpoint.

That distinction matters: subscription wrappers can record the token counters
emitted by Codex/Claude Code, but they do not invent per-call API invoices for a
flat-rate subscription. The evidence still shows which role, model, effort,
runtime profile, ticket, context pack, tool calls, and source diffs belonged to
the run.

Read subscription numbers with one caveat: in our CLI-wrapper measurements,
Codex/Claude Code can add roughly **7-8k input tokens of fixed agent/runtime
context per call** before the actual task context is counted. That overhead is
emitted by the official agent frontend, not by the k-lani context pack, and we
cannot remove it from the provider CLI path. It is still real token usage for a
subscription run, so reports keep it visible instead of subtracting it away.
Direct API-key runs through `k-lani-ai-proxy` do not carry that same native
agent frontend context unless the caller sends it.

The short version of using it: `k-lani-coder onboard` (existing
repos: one clean baseline-format commit, blame-shielded), then
`k-lani-coder quickstart` (index + session hub + live board, one
command), then tell the **conductor** — one assistant wired into your
chat frontend — *"we need X, please get it done."* Many agents work
one board concurrently; when a ticket lands, its **receipt** shows
who built what, the gate's verdict, and the measured cost.

**Evaluation build, openly declared:** `--version` shows this build's
expiry date. After it, `index` and `serve` refuse to start and point
at the current release; every read-only command (board, report,
context, codemap) keeps working forever. Your data is never hostage —
that promise is part of the design, not the marketing.

**Start here:** [SHOWCASE.md](SHOWCASE.md) — historical measured results plus
the current public Northwind calibration. It is intentionally labeled as
calibration until the bundled repeat runners produce enough accepted all-in
samples for a statistical advertising claim.

## Bundle contents

| Path | What it is |
|---|---|
| `bin/k-lani-coder` | indexer + MCP server/hub + board + CLI (Linux x86_64) |
| `bin/k-lani-ai-proxy` | metering relay: per-request token/cost ledger, key custody |
| `bin/SHA256SUMS` | checksums for both binaries |
| `ARCHITECTURE.md` | the whitepaper: method, measured results, security posture |
| `GETTING_STARTED.md` | five-minute setup: onboard, quickstart, conductor, board |
| `PROXY.md` | upstreams (OpenAI, Anthropic/Claude Code, local), pricing, ticket cost tagging |
| `AGENT_SANDBOX.md` | MCP-only Docker harnesses for Codex and Claude Code subscription agents |
| `PLANNER_LOOP.md` | operator runbook for autonomous planner-loop supervision |
| `docker-compose.codex-agent.yml` / `docker-compose.claude-agent.yml` | isolated official agent containers with native token capture |
| `SHOWCASE.md` | measured results & safety story |
| `BENCHMARKS.md` | full benchmark tables + methodology |
| `bench/` | public benchmark fixtures, repeat runners, and the advertising benchmark spec |
| `prompts/` | worker, planner, and conductor profiles |
| `demo/board-demo.sh` | the moving demo sprint (real machinery, throwaway board) |
| `reports/` | raw per-run token reports from the bench sessions |
| `LICENSE.md` | BSL 1.1 + supplementary terms (binding) |
| `SECURITY.md` | disclosure process and fix timelines |

## Docker (ready to run)

There is no external database image or engine sidecar. `k-lani-core` is
linked into `bin/k-lani-coder`; the first `index` creates the `.mkx`, memo,
and WAL files under the directory passed as `--data-dir`. Mount that
directory to keep the board, index, and WORM evidence across containers.

When building this image from the source repository after code changes,
refresh the bundled binaries first. The Dockerfile copies `bin/`; it does
not compile the workspace:

```bash
bash publish/k-lani-coder/build.sh
cd publish/k-lani-coder
docker build -t k-lani-coder:2026.24.10 .
REPO=/absolute/path/to/your/repository

# Compose intentionally starts ONLY the metering proxy. Its own k-lani
# ledgers persist in a named /data volume.
cp .env.example .env && docker compose up -d

# Index your workspace. The embedded engine creates /work/data/coder/*.mkx;
# run as your user so the source and database files keep your ownership.
docker run --rm --user $(id -u):$(id -g) -v "$REPO":/work \
  k-lani-coder:2026.24.10 k-lani-coder index --workspace /work --data-dir /work/data/coder

# the harness as MCP server for your agent frontend:
#   "command": ["docker","run","--rm","-i","--user","UID:GID",
#               "-v","/path/to/repo:/work","k-lani-coder:2026.24.10",
#               "k-lani-coder","serve","--data-dir","/work/data/coder",
#               "--workspace","/work"]

# live board: bind inside the container, publish to HOST loopback only
docker run --rm --user $(id -u):$(id -g) \
  -p 127.0.0.1:8788:8788 -v "$REPO":/work \
  k-lani-coder:2026.24.10 k-lani-coder board-web \
  --data-dir /work/data/coder --bind 0.0.0.0:8788 --allow-remote
```

The image is Rust-toolchain-based on purpose: the write gate runs
`cargo check`/`test` and rustfmt inside the container — the toolchain
IS the safety layer. In sandboxed environments the engine automatically
falls back from io_uring direct I/O to buffered writes with fsync (you
will see a one-line `[wal]` notice; durability semantics are unchanged).
The `--allow-remote` above permits the container-facing bind only; Docker
still publishes the board exclusively on host `127.0.0.1`.

## No phoning home — and you can verify it

- `k-lani-coder` makes **zero outbound network connections**. It
  speaks MCP on stdio and, for the live board, listens on loopback.
  No telemetry, no update check, no license callback — the evaluation
  expiry is a local date comparison baked into the binary.
- The only bundled component that talks to the network at all is
  `k-lani-ai-proxy`, and it connects to exactly one place: the
  upstream URL **you** configure (`MKLANI_UPSTREAM`). Point it at a
  local llama.cpp server and the entire loop runs with zero bytes
  leaving your machine.
- Don't take our word for it — watch the binaries yourself:

  ```bash
  strace -f -e trace=network k-lani-coder index --workspace . --data-dir data/coder
  # → no connect() calls. The proxy under the same lens connects
  #   only to the host you set as MKLANI_UPSTREAM.
  ```

## What the proxy dashboard shows (read before exposing it)

- **Shown:** every request/response payload — i.e. your prompts and
  your source-code slices — plus per-request token counts and costs.
  That is its job: it is the operator's measuring instrument.
- **Never shown:** provider keys. All keys known to the proxy (vault
  entries, `MKLANI_UPSTREAM_API_KEY`) are registered as protected
  literals and masked everywhere, including inside payload text.
  Verified empirically against `/api/traces` and the dashboard HTML,
  and pinned by a unit test in the source tree.
- Consequence: treat the dashboard like your editor screen, not like a
  status page. The compose file binds it to `127.0.0.1` — keep it that
  way on shared machines.

## Why this repo is a binary evaluation bundle

This public repository is intentionally a closed-binary evaluation bundle right
now, not the full development monorepo. The reason is commercial timing, not a
technical need for secrecy: the product is still young, the harness contains
the commercial control surface around model routing, WORM evidence, and
benchmark economics, and I want early users to evaluate the workflow before the
whole implementation becomes clone-and-fork infrastructure.

The tradeoff is explicit:

- you can run the tool locally against your own repositories;
- you can inspect the shipped docs, prompts, benchmark fixtures, Docker
  wrappers, SHA256 sums, SBOM data, license, and security policy;
- `k-lani-coder` itself makes no outbound network calls;
- the proxy only connects to the upstream you configure;
- the full source is not in this public repo yet.

The license text is still binding and transparent. Free use is allowed for
personal projects and organizations under the published revenue threshold;
commercial use above that threshold needs a commercial license. The current
bundle is therefore meant for serious evaluation, not as an open-source
contribution project yet.

## License & scope

Free for personal projects and organizations under $100k annual gross
revenue; everything else needs a commercial license — see `LICENSE.md`
(the bundled text is binding, this README is not).
