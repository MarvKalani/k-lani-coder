# k-lani-coder-bench — Full Results & Methodology

All runs 2026-06-10. Raw per-run token reports in `reports/`. Two
independent ledgers: the `k-lani-ai-proxy` usage log (prompt/completion
tokens and micro-cost per request, streaming included) and the k-lani-coder
WORM tool ledger (which harness tools actually ran). Workspace under
test: the k-lani repository, 603 files / 22 903 indexed symbols
(write tasks B3–B5 ran on disposable copies of a 3-file fixture
workspace so every run starts identical).

## Task set

| Id | Type | Pass criterion |
|---|---|---|
| B1 | analysis | correct explanation of an actor + its dependencies |
| B2 | deep analysis | correct walkthrough of WAL crash recovery with real fn names |
| B3 | single-fn edit | `cargo check` green, fn rewritten as required, docs kept |
| B4 | new method + caller | `cargo check` green, both edits present |
| B5 | bug fix from failing test | `cargo test` green |
| B6 | real-repo micro-edit | surgical 1-line diff in a 750-line file, gate green |

Agents: `k-lani-coder` (harness slices only, native file/shell tools
disabled) vs `baseline` (classic grep + windowed file reading,
read-only). One model per comparison pair.

## Headline: the evidence loop (B2, local Gemma 4 12B)

| Iteration | Requests | Total tokens |
|---|---|---|
| symbol tools only | 41 | 703 374 |
| + file/module slice | 10 | 137 915 |
| + small-model prompt profile | 6 | **55 625** |
| (baseline grep+read, same model) | 4 | 44 773 |

12.6× improvement in two evidence-driven fixes; answer quality
improved (the final run named the full real recovery path). The
remaining ~25% gap to the baseline is the cost of the harness's
safety/audit layer on the baseline's single friendliest task type.

## Write tasks across model classes (all gate-green)

| Task | Gemma 4 12B local, default prompt | Gemma, small profile | GLM-5.1, strong profile |
|---|---|---|---|
| B3 | 13 req / 63 029 tok / 3 write attempts | 7 / 25 104 / 1 | 7 / 22 790 / 1 |
| B4 | 13 / 65 429 / 5 | — | 11 / 47 167 / 2 |
| B5 | 11 / 42 972 / 2 | — | 9 / 35 475 / 1 |

Readings: (1) task completion is equalized by the harness — every
cell green, including a free local 12B model; (2) model strength shows
in write-argument discipline (rejected attempts are caught by the
content-hash lock and retried); (3) the small-model prompt profile
recovers most of the strength gap (B3: 25.1k vs 22.8k tokens).

## Analysis tasks (where the classic agent wins)

| Run | Requests | Total tokens | Quality |
|---|---|---|---|
| B1 k-lani-coder | 5 | 64 087 | correct |
| B1 baseline | 3 | 35 286 | correct |
| B2 best k-lani-coder | 6 | 55 625 | correct |
| B2 baseline | 4 | 44 773 | correct |

On grep-friendly questions whose answer lives in one file, whole-file
reading is cheaper. We publish this because the numbers that flatter
us are only credible next to the ones that don't.

## Scale & slice-quality facts

- Cold index: 603 files / 22 903 symbols in 33 s (release build);
  incremental re-index in seconds; zero parse failures across the
  whole repository.
- Slice cost is O(task), not O(repo): a 1 000+-line module arrives as
  a ~1 600-token slice.
- Ubiquitous-name cap: the worst observed noise slice dropped
  ~880 → ~365 tokens (30 junk entries → 0) after capping names with
  more than 5 candidates.
- B6 (real-repo write): surgical one-line diff in a 750-line file of
  the 22.9k-symbol workspace, gate green, 11 requests / 127 283 tokens
  (local model).

## Fixed-overhead disclosure

The driver frontend (opencode) costs ~7–8k prompt tokens per LLM turn
(its own system prompt + tool schemas), independent of the context
strategy. Comparisons are meaningful as deltas between agents under
the same driver, not as absolute minima.

## Reproduce

The release bundle is binary-only; the bench protocol (task prompts,
runner that slices the proxy ledger per run, disposable-workspace
setup) ships with the source distribution. The raw reports in
`reports/` carry the per-request token tables of every run referenced
above.
