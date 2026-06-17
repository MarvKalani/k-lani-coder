# PDF Toolbox Benchmark Lessons

These notes explain why the public benchmark only advertises the accepted
winner path.

## Winner Path

The first accepted calibration used:

- model: `gpt-5.5`
- effort: `medium`
- access path: official Codex subscription CLI
- native baseline: fresh Codex home with the full fixture workspace
- k-lani mode: `split-two`
- k-lani runtime profile: `codex_one_shot_minimal`
- one-shot output mode: `framed_json`
- MCP: disabled
- shell: disabled for k-lani workers
- web search: disabled
- user config and AGENTS rules: ignored for k-lani workers

Result:

```text
native direct:        387,677 tokens
k-lani split-two:      34,575 tokens
reduction:            91.08%
```

Both runs passed the same visible gate, hidden gate, scope check, and usage
evidence check.

## Structured Output Was Too Strict

The earlier schema-constrained one-shot mode was technically attractive but too
fragile for large patch transport. Codex could spend a long time internally
trying to satisfy the exact structured-output contract, while `codex exec
--json` exposed only `thread.started` and `turn.started` until the turn ended.

The practical fix was to keep the machine-readable contract but relax the
transport:

```text
KLANI_ONE_SHOT_RESULT_BEGIN
{ "status": "patch", "files": [...], "tests_to_run": [...] }
KLANI_ONE_SHOT_RESULT_END
```

This framed JSON block is still parseable and auditable, but it does not force
the CLI/model runtime into the same hard output-schema path.

## Split Beats Monster One-Shot

A single huge one-shot can fail for transport reasons even when the model has
planned useful replacements. Splitting the work into two bounded slices made
each worker return a small enough patch and made token attribution cleaner.

The useful split for this benchmark was:

- core slice: page selection, merge planner, planner-facing tests
- CLI slice: JSON parser/serializer, executable behavior, CLI-facing tests

## Liveness Is Not Usage

No usage row before `turn.completed` is not the same as zero tokens. OTel
liveness showed cases where Codex was actively streaming internal output-text
deltas while the public `codex exec --json` stream had not yet emitted the final
usage-bearing event.

The runner therefore treats these states separately:

- active internal generation
- completed with usage
- runaway generation
- stalled

This prevents false "0 token" results.

## Public Claim Rule

Only accepted runs belong in `results/`. Diagnostic and invalid calibration
runs can teach the harness, but they are not marketing numbers.
