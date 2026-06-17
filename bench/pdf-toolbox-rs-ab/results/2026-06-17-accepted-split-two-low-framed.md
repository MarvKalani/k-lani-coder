# Accepted Lower-Effort Follow-up: k-lani Split-Two One-Shot

Date: 2026-06-17

Run root:

```text
/tmp/k-lani-pdf-toolbox-rs-ab-runs/20260617T220359Z-split-two-low-framed
```

Source commit:

```text
3368d0a156d6285c7133e9d51037248f08460e13
```

## Purpose

This run checks whether the accepted winner path still works with lower Codex
reasoning effort.

It is not a complete A/B result because it only reran the k-lani path. The
headline A/B number remains the accepted `gpt-5.5 medium` comparison against
native Codex.

## Settings

```text
model: gpt-5.5
effort: low
access path: official Codex subscription CLI
mode: k-lani-split-two
runtime profile: codex_one_shot_minimal
output mode: framed_json
MCP: none
shell: none
web search: none
repair attempts: 1 configured, 0 used
```

## Gate Result

| run | worker | visible gate | hidden gate | scope | usage | accepted |
|---|---:|---:|---:|---:|---:|---|
| k-lani-split-two low | 0 | 0 | 0 | 0 | 0 | yes |

## Token Result

| run | wall time | input | cached | cache % | output | reasoning | total |
|---|---:|---:|---:|---:|---:|---:|---:|
| k-lani-split-two low | 454.3s | 22,416 | 0 | 0.0% | 10,402 | 390 | 32,818 |

## Usage Detail

```text
slice 01:
  role=worker
  phase=implementation
  runtime_profile=codex_one_shot_minimal
  context_pack_estimated_tokens=2,420
  command_executions=0
  agent_messages=1
  total_tokens=13,638

slice 02:
  role=worker
  phase=implementation
  runtime_profile=codex_one_shot_minimal
  context_pack_estimated_tokens=4,513
  command_executions=0
  agent_messages=1
  total_tokens=19,180
```

## Interpretation

`gpt-5.5 low` was enough for this scoped worker-only path. It used slightly
fewer tokens than the accepted `gpt-5.5 medium` k-lani run:

```text
medium k-lani split-two: 34,575 tokens
low k-lani split-two:    32,818 tokens
difference:               1,757 fewer tokens
```

This supports using lower effort for tightly scoped implementation tickets, as
long as the same visible and hidden gates remain mandatory.
