# Slice 03: CLI JSON Smoke Interface

Implement the deterministic CLI JSON smoke path.

The page-selection parser and merge-plan builder are already present. Use the
library API and avoid rewriting the core.

Required behavior:

- `cargo run --quiet -- <job.json>` prints exactly one minified JSON line.
- Missing input path writes `usage: pdf-toolbox <job.json>\n` to stderr and
  exits with code `2`.
- Unreadable or unparsable input writes `invalid input\n` to stderr and exits
  with code `2`.
- Operation JSON uses the input key `"document"` and maps it to
  `MergeOperation.document_id`; output plan pages still use `"document_id"`.
- Valid jobs print `{"status":"ok","plan":...}` with the exact key order from
  the product spec.
- Invalid jobs print `{"status":"error","diagnostics":[...]}` with stable key
  order.

The parser only needs to support the benchmark object shape. It does not need
to be a general JSON implementation.

No dependencies.
Run `cargo fmt --all` before final output.
