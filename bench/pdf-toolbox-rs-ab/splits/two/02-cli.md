# Slice 02: CLI JSON Smoke Interface

Implement the deterministic CLI JSON smoke path for the PDF toolbox milestone.

This slice owns:

- parsing the simple JSON job shape used by the benchmark tests;
- formatting deterministic success and error JSON;
- `src/main.rs` argument handling and IO behavior;
- CLI visible tests.

The library core from slice 01 is already present. Do not rewrite it unless the
CLI integration requires a small public API exposure.

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

Do not add a JSON dependency. Use a small purpose-built parser/writer.
Run `cargo fmt --all` before final output.
