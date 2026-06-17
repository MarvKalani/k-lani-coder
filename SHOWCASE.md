# k-lani-coder — Measured Results & Showcase

*A scoped context harness for AI coding: give the model the code it actually
needs, guard every write, and make the token spend visible per run.*

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

Every indexed source item lives as a row in `.mkx` tables of our own engine:
body, signature, docs, exact byte span, content hash, and name-based dependency
edges. Rust, TypeScript, C#, and Python are language lanes, not separate
products. An MCP server serves eleven tools to any agent frontend (Codex,
Claude Code, opencode):

- `context` — ONE budgeted slice per task: target symbol full, direct
  deps full, indirect deps as one-line signatures, everything else
  honestly listed as *omitted*. File targets return a whole module in
  one call.
- `search` / `symbol` / `overview` / `file` — orientation and ticket-scoped
  file reads without broad repo access.
- `write` — byte-span surgery behind an optimistic content-hash lock.
- `replace` — the strict single-purpose replacement contract for models that
  do not reliably handle polymorphic write arguments.
- `check` — `cargo check`/`test` as the only authority on "done".
- `ticket` — the WORM work board and exact-deployment model-profile lookup.
- `case` — risk-tailored Change Assurance with typed evidence and suspect
  links.
- `knowledge` — small evidence-backed facts that are only rendered into a
  context pack when the planner selected them, and later measured against
  ticket outcomes.

In scoped MCP mode the agent's native file/shell tools are disabled. In
one-shot mode the worker receives a measured context pack and returns a patch
that the host applies through the same guarded write path. Either way, broad
unattributed repo edits are outside the accepted path.

## Current public measurement track (2026-06-17)

The public benchmark now focuses on one accepted, reproducible path:
`bench/pdf-toolbox-rs-ab`.

The task is a Rust-first PDF toolbox milestone that can later compile to
WebAssembly. The model has to implement deterministic page selection, merge
plan validation, CLI JSON input/output, and tests. Both paths use the same
product spec, shared engineering rules, visible gate, hidden gate, and fresh
Codex authentication state.

The accepted A/B calibration used `gpt-5.5` with `medium` effort through the
official Codex subscription CLI path:

| Path | Tokens | Status |
|---|---:|---|
| Native Codex direct, full fixture workspace | 387 677 | accepted |
| k-lani split-two one-shot, need-to-know context packs | 34 575 | accepted |

That is 353 102 fewer tokens in the k-lani path for this accepted sample:
**91.08% less token traffic**.

Evidence:
`bench/pdf-toolbox-rs-ab/results/2026-06-17-accepted-native-vs-split-two-framed.md`.

The same k-lani winner path also passed with `gpt-5.5` at `low` effort:

| Path | Tokens | Status |
|---|---:|---|
| k-lani split-two one-shot, low effort | 32 818 | accepted |

Evidence:
`bench/pdf-toolbox-rs-ab/results/2026-06-17-accepted-split-two-low-framed.md`.

The lower-effort run is not the headline A/B number because no native low
baseline was rerun. It shows the next optimization direction: tightly scoped
worker tickets can sometimes run below medium effort while the same gates remain
mandatory.

The key lesson was not "more structure is always better". Hard structured
output was too strict for large patch transport. The accepted path uses framed
JSON instead: machine-readable enough to parse and audit, but not forced
through the brittle output-schema transport.

See `bench/pdf-toolbox-rs-ab/LESSONS.md` for the harness lessons that were kept
out of public benchmark results.

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
- The native agent frontend can cost ~7-8k tokens of fixed overhead
  per LLM turn before task context. That was visible in our opencode-era
  runs and remains a caveat for Codex/Claude Code subscription wrappers:
  the overhead is real usage emitted by the frontend, not k-lani's selected
  source slice.
- Weak models pay in iterations, not slice size.
- Known gaps are documented in the repo, including the one quiet
  failure case our guards do not catch yet (a swallowed attribute
  line like `#[test]`).

## Try it (closed binary release)

The release ships the `k-lani-coder` and `k-lani-ai-proxy` binaries
with an embedded SBOM, the bench protocol, and this document. Bring
your own driver (Codex, Claude Code, opencode, or any MCP-capable frontend),
point it at the MCP server, and verify every claim above against your own audit
ledger — that is what it is for. License: see the bundled `LICENSE.md` (BSL 1.1 with
supplementary terms; free for personal projects and organizations
under $100k annual revenue).
