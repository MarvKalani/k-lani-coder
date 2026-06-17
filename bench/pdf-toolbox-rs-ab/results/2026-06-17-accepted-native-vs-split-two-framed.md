# Accepted Calibration: Native Codex vs k-lani Split-Two One-Shot

Date: 2026-06-17

Run root:

```text
/tmp/k-lani-pdf-toolbox-rs-ab-runs/20260617T213243Z-framed-native-vs-split-two-v2
```

Source commit:

```text
603f1251d4e413eed993f76d3ca5038a1b2bdf8c
```

## Task

Implement the same PDF toolbox milestone in both modes:

- Rust library and CLI only.
- TDD-style implementation.
- Page selection parsing.
- Merge plan validation.
- JSON CLI input/output.
- No new dependencies.
- Same visible gate and same hidden gate.

Both runs used `gpt-5.5` with `medium` effort through the official Codex subscription CLI path.

## Compared Modes

| mode | description |
|---|---|
| native | Fresh Codex home, native direct run, whole fixture workspace available. |
| k-lani-split-two | Two fresh one-shot workers, no MCP, no shell, no web, scoped context packs, framed JSON patch result. |

## Gate Result

| run | codex/worker | visible gate | hidden gate | scope | usage | accepted |
|---|---:|---:|---:|---:|---:|---|
| native | 0 | 0 | 0 | 0 | 0 | yes |
| k-lani-split-two | 0 | 0 | 0 | 0 | 0 | yes |

## Token Result

| run | wall time | input | cached | cache % | output | reasoning | total |
|---|---:|---:|---:|---:|---:|---:|---:|
| native | 211.4s | 378,109 | 343,040 | 90.7% | 9,568 | 1,344 | 387,677 |
| k-lani-split-two | 234.6s | 22,780 | 0 | 0.0% | 11,795 | 1,032 | 34,575 |

Reduction in this accepted calibration sample:

```text
387,677 - 34,575 = 353,102 fewer tokens
34,575 / 387,677 = 0.0892
Token reduction = 91.08%
Native token total = 11.21x k-lani split-two
```

## Usage Detail

Native:

```text
role=worker
phase=native_direct
runtime_profile=native_default
turn_count=1
command_executions=18
agent_messages=13
total_tokens=387,677
```

k-lani split-two:

```text
slice 01:
  role=worker
  phase=implementation
  runtime_profile=codex_one_shot_minimal
  context_pack_estimated_tokens=2,421
  command_executions=0
  agent_messages=1
  total_tokens=14,372

slice 02:
  role=worker
  phase=implementation
  runtime_profile=codex_one_shot_minimal
  context_pack_estimated_tokens=4,889
  command_executions=0
  agent_messages=1
  total_tokens=20,203
```

## Validity Notes

- This is the first accepted PDF toolbox calibration run after the Codex minimal runtime and framed JSON result mode were fixed.
- Earlier invalid calibration runs were removed from public benchmark results; their harness lessons are summarized in `../LESSONS.md`.
- This is one accepted sample, not a statistical product claim.
- The subscription path does not expose per-call invoice cost. The measured value is exact token usage from Codex JSON/OTEL usage evidence, not API billing.
- Native direct still benefited from a high cache-read share. The k-lani one-shot workers used fresh isolated Codex homes and showed no cache reuse in this run.
