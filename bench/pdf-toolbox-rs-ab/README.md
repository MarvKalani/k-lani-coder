# PDF Toolbox RS A/B Benchmark

This benchmark measures the same Rust milestone in two comparable modes:

1. native Codex with a fresh Codex home and the full fixture workspace;
2. k-lani-coder split one-shot workers with scoped need-to-know context packs.

The target product is a Rust-first PDF toolbox core that can later be compiled
to WebAssembly. This first milestone does not rewrite real PDF bytes. It builds
the deterministic job model, page-selection parser, merge-plan builder, CLI
JSON smoke path, and tests.

The result is valid only when both modes start from the same fixture, receive
the same product spec and shared engineering rules, and pass the same visible
and hidden gates.

## Accepted Calibration

The accepted public calibration used `gpt-5.5` with `medium` effort through the
official Codex subscription CLI path.

| mode | tokens | result |
|---|---:|---|
| native Codex direct | 387,677 | accepted |
| k-lani split-two one-shot | 34,575 | accepted |

This accepted sample used 353,102 fewer tokens in the k-lani path, a 91.08%
reduction for this task.

See `results/2026-06-17-accepted-native-vs-split-two-framed.md` for the full
gate and usage evidence.

## Lower-Effort Follow-up

The same k-lani split-two winner path also passed with `gpt-5.5` at `low`
effort:

| mode | tokens | result |
|---|---:|---|
| k-lani split-two one-shot, low effort | 32,818 | accepted |

This is not the headline A/B number because no native low-effort baseline was
rerun in that sample. It shows that tightly scoped worker tickets can sometimes
run below the medium-effort setting when the gates stay mandatory.

See `results/2026-06-17-accepted-split-two-low-framed.md` for the lower-effort
evidence.

## Reproduce

```sh
KLANI_PDF_AB_MODES=native,split-two \
KLANI_PDF_AB_MODEL=gpt-5.5 \
KLANI_PDF_AB_EFFORT=medium \
KLANI_PDF_AB_ONE_SHOT_OUTPUT_MODE=framed_json \
bash publish/k-lani-coder/bench/pdf-toolbox-rs-ab/run.sh
```

The report includes Codex usage rows, agent-message evidence, diff stats,
visible-gate status, hidden-gate status, scope status, and usage-evidence
status.

## Why Framed JSON

The accepted path intentionally uses `framed_json`, not hard structured output.
Earlier calibration runs showed that schema-constrained patch transport was too
strict for larger generated replacements: Codex could continue internal
generation for a long time before exposing a final `turn.completed` usage row.

The framed block keeps parsing deterministic without forcing the model through
the hard schema transport:

```text
KLANI_ONE_SHOT_RESULT_BEGIN
{ "status": "patch", "files": [...], "tests_to_run": [...] }
KLANI_ONE_SHOT_RESULT_END
```

See `LESSONS.md` for the non-advertised harness lessons from invalid
calibration runs.

One accepted sample is calibration only. It is evidence for this task and this
setup, not a universal savings claim.
