# Shared Agent Rules

- TDD: add or update tests first, then implement until the gate is green.
- KISS: use the simplest readable solution that satisfies the task.
- SINE: keep the user-facing API simple; put necessary complexity in the core
  logic.
- Minimal changes: edit only files required by the task.
- Bare-metal first: prefer `std` and hand-written code over dependencies.
- No dependency creep: do not add dependencies for this milestone.
- Code is the spec: clear names, readable code, no clever hacks.
- Deterministic output: tests must not depend on wall-clock time, filesystem
  ordering, locale, network, or random values.
- Gate is authority: done means the configured visible and hidden gates pass.
- Formatting is part of the gate: run `cargo fmt --all` before the final
  `cargo test && cargo fmt --all -- --check` verification.
- No broad refactor: do not redesign outside the requested feature.
- English only in code, comments, tests, and docs.
