# k-lani-coder: Minimal-Context AI Coding with Verifiable Guarantees

*An architecture overview with measured results. Built on the k-lani
database engine. All numbers in this document come from the bundled
[reports/](reports/) and the project's append-only ledgers — they are
measurements, not estimates.*

## Abstract

AI coding agents read too much. A conventional agent harness answers
every task by crawling the repository — opening files, grepping,
re-reading, accumulating hundreds of thousands of tokens of mostly
irrelevant context per task. This is slow, expensive, imprecise (code
the model should never touch invites unrequested "fixes"), and it
ships your entire codebase to whoever runs the model.

k-lani-coder inverts the flow. The codebase is indexed **once** into
an embedded database at symbol granularity; every task receives
**exactly one budgeted slice** — the target symbol in full, its direct
dependencies in full, indirect dependencies as one-line signatures,
and an honest list of everything known but deliberately not shown.
Requests travel through a key-custody proxy that meters every token;
results come back through a chain of deterministic guards that ends at
the compiler. The current public Northwind fixture demonstrates the scoped
worker mechanism, but it is not yet an end-to-end savings proof: accepted
all-in comparisons must count planner, advisor, worker, reviewer, repair, and
host retry costs in one total. The latest corrected Northwind run accepted
native direct and known-scope one-shot, but rejected the LLM-planned path
because the worker timed out and did not update the required visible tests. An
older private architecture benchmark showed the same context-control mechanism
at a different scale: **703,374 tokens to 55,625 (12.6×)**, but that result is
a historical mechanism calibration, not the public advertising number.

## 1. The problem: context flooding

We measured a state-of-the-art agent harness solving a routine
architecture question in a ~700-file Rust workspace: 41 model
requests, 703,374 tokens — most of them file contents the final answer
never referenced. Beyond cost, flooding has three structural defects:

- **Precision.** Everything in context is an invitation. Unrelated
  code in the window produces unrelated edits.
- **Trust.** Whole files leave the machine. With third-party model
  providers, that is your IP in someone else's logs.
- **Verification.** When the model saw everything, you can no longer
  say what its change was *based on*.

## 2. The method: four stages, each independently verifiable

**Stage 1 — Index.** Rust, TypeScript, C#, and Python source files are
handled by language lanes chosen per file extension; adding a language adds a
lane, not a new architecture. Each function, type, and method is extracted into
the embedded **k-lani WORM/ACID engine** (write-once append-only tables,
transactional WAL-first commits) together with its documentation, signature,
and a name-based dependency graph. A full
cold index of a ~700-file workspace takes about ten seconds;
incremental re-indexing after an edit is sub-second. The index is a
derived cache — your files remain the single source of truth.

A deliberate consequence of this design: **the model never sees
history.** When a task touches `parser.rs`, the agent does not
receive the file, its git log, or yesterday's version of anything —
it receives the current state of exactly the symbols the task needs.
Stale context is one of the biggest hallucination drivers in agentic
coding ("fixing" code that no longer looks like that); here it is
structurally impossible, because every write triggers an immediate
re-index and every slice is assembled from the current state. The
append-only engine keeps the full history anyway — but as an audit
trail for humans, never as context for models.

**Stage 2 — Slice.** Per task, a deterministic assembler builds one
context package under a hard token budget: the target symbol in full
— not the file that contains it — its direct dependencies in full,
the rest demoted to signatures, everything else listed under
`omitted` so the model knows it exists and can request it — instead
of hallucinating it. A typical slice is one to two thousand tokens
where a file-reading agent ships tens of thousands. Because the unit
of context is the symbol, not the file, cost scales with the TASK,
not with the repository — the same mechanics serve a 700-file
workspace and a 100,000-file one.
The need-to-know property is enforceable per ticket: a worker can be
confined to a contract's listed symbols and is mechanically unable to
write anywhere else.

**Stage 3 — Proxy.** All model traffic passes a local relay that owns
the API keys (the agent process never sees them; key material is
masked from every log and trace), speaks the OpenAI-compatible
protocol to any upstream — commercial cloud or a llama.cpp server on
your own GPU — and records every request's exact token counts in an
append-only ledger. Cost claims in this document are read from that
ledger, not from invoices.

**Stage 4 — Gate.** Writes are surgical replacements of single
symbols, protected by an optimistic lock against concurrent change, a
host-configurable policy that rejects dangerous constructs before any
byte reaches disk, forced formatting that bounces unparseable output,
and finally the only acceptance authority that matters: the project's
own compiler and test suite. The model's opinion of its work is
irrelevant; the gate's verdict is recorded.

**The board.** On top of the loop sits an orchestration layer:
a ticket board persisted in the same append-only engine. Ideas enter
a backlog; a planner promotes them to machine-validated contracts;
workers of different capability pull tickets matching their level;
submissions enter a review queue where — enforced in code, not in
prompts — no agent can ever approve its own work. Every transition is
one immutable ledger row. A sprint is not a meeting; it is data.

Because it is data, you can watch it: `k-lani-coder board-web` serves
a read-only live kanban view (loopback-only by default) that shows,
per ticket, the planner's routing decision — which model was chosen,
at which capability level and reasoning effort, for which skill tags
— alongside the measured context tokens and per-phase cost from the
ledgers. The view runs lock-free next to a live session; it observes
the sprint, it cannot touch it.

**Many agents, one writer.** A session hub owns the data directory's
write tables; any number of agents — a local model, two cloud
coders, a planner — connect through thin per-identity bridges and
work the same board concurrently. Every guard (four-eyes, model
pinning, clearance, scope, pay grade) keys on the per-session
identity; writes serialize in milliseconds inside the hub while
model thinking runs in parallel for minutes. And on top sits the
conductor: one assistant you talk to in plain language ("we need X,
please get it done") that files, refines, contracts, routes, and
reports — bound by the same rules as every other agent, its tokens
metered in the same ledger, its planning mistakes attributed to it.

**Routing is explainable judgment.** The board joins each draft contract with
the exact deployment registry, role-specific invocation rules, declared
level/context capacity, residency policy, WORM category/tag history, and
optional proxy availability/limit evidence. Code excludes impossible routes
and explains why; it does not score or choose a winner. The planner records
the decision as an exact model pin or pool, and claim revalidates that route
against current facts before the worker sees the contract.

**The receipt.** When a ticket lands, one generated page tells the
whole story from the ledgers: what was asked, the contract, who
built it at which reasoning level, attempts and rejects, the gate's
verdict, measured tokens and cost per phase, wall time, and the
release it shipped in. Nothing estimated — which makes the receipt
simultaneously the audit answer for "who changed what, why, and
with which authority".

## 3. Results

| Measurement | Conventional harness | k-lani-coder |
|---|---|---|
| Public Northwind corrected run | Native Codex direct: 225,058 tokens, accepted | known-scope worker: 17,274 tokens, different boundary |
| Same task class with measured LLM planning | Native Codex direct: 225,058 tokens, accepted | latest all-in row invalid; no accepted saving yet |
| Historical architecture question, ~700-file workspace | 703,374 tokens / 41 requests | **55,625 tokens / 10 requests (12.6×)** |
| Typical change-task context | whole files, 10⁴–10⁵ tokens | one slice, ~1,600 tokens |
| Stable orientation prefix (cache hit rate, measured upstream) | — | 99.7 % |
| Cold index, 685 files / 24.5k symbols | — | ~10 s (incremental ~1 s) |
| Publish gate | — | `cargo test -p k-lani-coder` + `cargo test -p k-lani-ai-proxy --lib` |

**The harness holds itself to its own standard.** Public releases run the
coder and proxy test gates before publishing. Coverage proves diligence, not
correctness — correctness is what the deterministic guards and the immutable
ledgers are for — but it tells you how this thing was built.

**Correctness, not just thrift.** Across the write benchmarks (bug
fix, new feature with caller update, test-driven repair), tasks
completed gate-green on both a commercial frontier model and a free
local 12-billion-parameter model running on a single consumer GPU.
The harness equalizes *completion*; model strength shows in the
number of attempts — which the system records per model and per skill
tag, building an evidence-based report card that routing decisions
can cite.

**Discipline is configuration, not hope.** The same 26B local model
that produced 14 malformed write calls under generic settings
produced exactly one clean, gate-green write after its published
generation profile was applied — a 7× wall-clock improvement from
configuration alone. Model profiles (exact checkpoint, quantization,
runtime, per-role parameters) are therefore first-class, queryable
data in this system.

**Fully offline operation is real.** With quantized local models and
multi-token-prediction draft heads on a single 16 GB consumer GPU, we
measure 100–226 tokens/second — and the complete loop (slice → write
→ gate → board) has been run end-to-end with a local worker, a local
planner profile, and zero bytes leaving the machine.

## 4. Security and audit posture

- **Need to know.** A worker sees its slice — not your repository.
  Contract scoping makes the boundary mechanical.
- **Classification and data residency.** Tickets carry a sensitivity
  grade; the model registry records where each deployment runs. A
  `secret` ticket cannot even be SEEN by a model in a disallowed
  jurisdiction — enforced in code at claim time, deny-by-default,
  with local hardware as the strongest (and verifiable) tier.
- **Key custody.** Upstream credentials live in the proxy; agents get
  a dummy. Keys are masked from logs and the dashboard (verified).
- **No phoning home.** The harness itself opens zero outbound
  connections (stdio plus loopback listeners only); the proxy
  connects exclusively to the operator-configured upstream. Both
  claims are verifiable from outside with `strace`/`tcpdump`.
- **Immutable evidence.** Tool calls, board transitions, refused
  writes, token counts: every one is an append-only ledger row. The
  audit trail is the same data the system itself runs on.
- **Separation of duties.** Submitter ≠ approver is enforced by the
  server, not by convention — relevant for CRA Annex I logging and
  access-control posture.
- **Honest evaluation builds.** Public binaries declare their expiry
  in `--version`; after the date, operational commands stop, while
  every read path — your board, your ledgers, your reports — works
  forever. Data is never hostage.

## 5. Honest limitations

- Whole-repository refactors (rename across hundreds of files) favor
  classic tools; the harness is built for scoped change.
- Dependency edges are name-based and deliberately over-approximate;
  macro-generated references are invisible to the graph (the budget
  and search cover the gap).
- The policy guard stops careless output, not a determined adversary
  — the gate and the human-readable ledgers remain the backstop.
- One serve process owns one data directory (single-writer engine
  design); parallel workers are separate sessions by construction.

## 6. Availability

Binary evaluation releases (Linux x86_64, Docker included) at
[github.com/MarvKalani/k-lani-coder](https://github.com/MarvKalani/k-lani-coder).
The implementation — the k-lani engine, the index, the assembler, the
board — is closed source; the protocol surface (MCP), the prompts,
the benchmark reports, and this architecture are open. See
`GETTING_STARTED.md` to be productive in ten minutes, `PROXY.md` for
key custody, `SECURITY.md` for the operational rules.
