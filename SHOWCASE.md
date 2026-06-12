# k-lani-coder — Measured Results & Showcase

*A symbol-slice context harness that makes small models reliable Rust
engineers — and makes every AI action auditable. All numbers below are
real, dated measurements from two independent ledgers; nothing in this
document is a projection.*

Built on the k-lani database engine. One day from design document to
the full measured system (2026-06-10), developed strictly test-first:
**113 tests, every feature red→green.**

## The problem

AI coding agents read whole files. Against a real workspace that means
tens of thousands of tokens per request — most of them irrelevant,
expensive, and an open invitation for the model to "improve" code
nobody asked about. Worse: whether an agent may write into your
repository at all is usually governed by hope, not by structure.

## What it is, in 60 seconds

Every Rust item (fn, struct, impl, trait, …) of the workspace lives as
a row in `.mkx` tables of our own engine: body, signature, docs, exact
byte span, content hash, and name-based dependency edges. An MCP server
serves eight tools to any agent frontend (opencode, Claude Code):

- `context` — ONE budgeted slice per task: target symbol full, direct
  deps full, indirect deps as one-line signatures, everything else
  honestly listed as *omitted*. File targets return a whole module in
  one call.
- `search` / `symbol` / `overview` — orientation without bodies.
- `write` — byte-span surgery behind an optimistic content-hash lock.
- `replace` — the strict single-purpose replacement contract for models that
  do not reliably handle polymorphic write arguments.
- `check` — `cargo check`/`test` as the only authority on "done".
- `ticket` — the WORM work board and exact-deployment model-profile lookup.

The agent's native file/shell tools are disabled. The only path to your
code is the harness.

## Headline numbers (2026-06-10, all reproducible via `bench/`)

**The evidence loop works.** One concept question ("how does WAL
recovery work?"), local 12B model, three iterations of measure → fix →
measure:

| Iteration | Requests | Tokens |
|---|---|---|
| Symbol tools only | 41 | 703 374 |
| + file/module slice (T-21) | 10 | 137 915 |
| + small-model prompt profile (T-20) | 6 | **55 625** |

**12.6× cheaper in two evidence-driven fixes — answer quality went UP**
(the final run named every real function in the recovery path).

**A free local 12B model does real Rust work.** All write benches green
across model classes:

| Task (all gate-green) | Gemma 4 12B (local, $0) | GLM-5.1 |
|---|---|---|
| Rewrite fn with max/min | 7 req / 25 104 tok | 7 / 22 790 |
| New method + caller update | 13 / 65 429 | 11 / 47 167 |
| Bug fix from failing test | 11 / 42 972 | 9 / 35 475 |

The harness equalizes *task completion* across model strength; model
quality shows in write discipline (GLM: 1/2/1 write attempts; Gemma:
3/5/2 — every bad attempt caught by the hash guard and retried).

**Scale does not degrade slices.** Real workspace: 603 files, 22 903
symbols, indexed in 33 s cold, seconds incremental, zero parse
failures. Slice cost is O(task), not O(repo): a 1 000+-line module
becomes a ~1 600-token slice; after the ubiquitous-name cap the worst
observed noise case dropped ~880 → ~365 tokens with zero junk entries.

**Claude as driver, day one.** Registered as an MCP server in Claude
Code, the harness answered an architecture question about a never-read
subsystem in one tool call — and that very first self-test exposed a
noise bug that became a fix the same day (see T-22 in `Tasks.md`).
The system measures and improves itself.

## The safety story (what closed-binary users can verify themselves)

Five independent layers stand between the model and your code:

1. **Optimistic hash lock** — a write against a stale slice is rejected
   with instructions, never applied.
2. **Forced beautify** — rustfmt runs after every write; if the result
   does not parse, the original file is restored byte-identically.
3. **Symbol-diff swallow guard** — if a symbol silently disappears from
   a file (the classic "code line merged into a // comment" failure,
   which can compile cleanly), the response names it loudly.
4. **Comment heuristic** — plain `//` comments containing `;` or `{`
   are flagged (doc comments exempt: Rust doc examples are code).
5. **Cargo gate** — `cargo check`/`test`, spawned without any shell,
   crate names validated against the index. Green gate = done; nothing
   else counts.

Plus: new files only under `crates/**.rs`, no path traversal, no
overwrite, **no shell access of any kind** — and a WORM audit ledger
(`sys_coder_sessions`) that records every single tool call immutably:
what was asked, how big the answer was, how long it took, whether it
succeeded. Token accounting comes from a second, independent ledger
(the `k-lani-ai-proxy` relay, which also keeps provider keys
server-side — the agent frontend never holds a real secret).

Source-code confidentiality is a written policy, not a vibe: real-repo
slices go only to local models or providers with an accepted
no-training posture; third-party cloud endpoints get synthetic fixture
content only.

## What we tell you that marketing usually doesn't

- On grep-friendly analysis questions a classic whole-file agent is
  still ~25% cheaper than our best result (44.7k vs 55.6k tokens). Our
  edge is write safety, auditability, weak-model reliability, and
  scale-independence — not winning every benchmark line.
- The driver frontend (opencode) costs ~7–8k tokens of fixed overhead
  per LLM turn regardless of context strategy.
- Weak models pay in iterations, not slice size.
- Known gaps are documented in the repo, including the one quiet
  failure case our guards do not catch yet (a swallowed attribute
  line like `#[test]`).

## Try it (closed binary release)

The release ships the `k-lani-coder` and `k-lani-ai-proxy` binaries
with an embedded SBOM, the bench protocol, and this document. Bring
your own driver (opencode or Claude Code), point it at the MCP server,
and verify every claim above against your own audit ledger — that is
what it is for. License: see the bundled `LICENSE.md` (BSL 1.1 with
supplementary terms; free for personal projects and organizations
under $100k annual revenue).
