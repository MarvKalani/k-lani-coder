# PDF Toolbox RS Benchmark Product Spec

Build the first Rust milestone for a PDF toolbox that can later become a
browser-usable WASM module.

The benchmark workspace contains:

- `reference/` with a cleaned snapshot of the old browser PDF converter docs;
- `pdf-toolbox-rs/` with a small Rust scaffold.

Work only in `pdf-toolbox-rs`. Do not change the reference snapshot.

## Product Goal

The first milestone must not physically rewrite PDF bytes. It must build the
deterministic core that a future PDF backend or WASM wrapper can use:

- source document model;
- page-selection parser;
- merge-job validation;
- backend-neutral merge plan;
- deterministic diagnostics;
- CLI JSON smoke interface.

## Allowed Files

Only these files may change:

- `pdf-toolbox-rs/Cargo.toml`
- `pdf-toolbox-rs/src/cli_json.rs`
- `pdf-toolbox-rs/src/lib.rs`
- `pdf-toolbox-rs/src/main.rs`
- `pdf-toolbox-rs/src/model.rs`
- `pdf-toolbox-rs/src/page_selection.rs`
- `pdf-toolbox-rs/src/planner.rs`
- `pdf-toolbox-rs/tests/cli_test.rs`

Do not edit `reference/`.
Do not add dependencies.
Do not add `wasm-bindgen` yet.
Do not add a real PDF library yet.

## Required Public API

Expose these public types from the `pdf_toolbox` library:

```rust
pub struct SourceDocument {
    pub id: String,
    pub page_count: u32,
    pub encrypted: bool,
    pub password: Option<String>,
    pub unsupported: bool,
}

pub struct MergeOperation {
    pub document_id: String,
    pub pages: String,
}

pub struct OutputOptions {
    pub file_name: String,
    pub title: Option<String>,
    pub author: Option<String>,
}

pub struct MergeJob {
    pub documents: Vec<SourceDocument>,
    pub operations: Vec<MergeOperation>,
    pub output: OutputOptions,
}

pub struct PlanPage {
    pub document_id: String,
    pub page: u32,
}

pub struct MergePlan {
    pub output_file_name: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub pages: Vec<PlanPage>,
}

pub struct Diagnostic {
    pub code: String,
    pub message: String,
}
```

Implement these public functions:

```rust
pub fn parse_page_selection(selection: &str, page_count: u32) -> Result<Vec<u32>, Diagnostic>;
pub fn build_merge_plan(job: &MergeJob) -> Result<MergePlan, Vec<Diagnostic>>;
```

All structs must derive at least `Debug`, `Clone`, `PartialEq`, and `Eq`.

## Page Selection Rules

`parse_page_selection(selection, page_count)` must support:

- `all`
- `odd`
- `even`
- a single page, for example `1`
- a range, for example `1-3`
- a comma list, for example `1,3,5-7`

Rules:

- Page numbers are one-based.
- Whitespace around tokens is allowed.
- The result order follows the selection order.
- Duplicate pages are invalid.
- `page_count == 0` is invalid for every selector.
- `0`, negative values, empty tokens, reversed ranges, and out-of-range pages
  are invalid.

Diagnostic codes:

- `empty_document`
- `empty_page_selection`
- `invalid_page_number`
- `page_range_reversed`
- `page_out_of_range`
- `duplicate_page`

Diagnostic messages must be deterministic and include the problematic selector
or page number.

## Merge Plan Rules

`build_merge_plan(job)` must:

- not mutate `job`;
- preserve operation order;
- expand each operation through `parse_page_selection`;
- copy `output.file_name` to `MergePlan.output_file_name`;
- copy `output.title` and `output.author`;
- produce one `PlanPage` per selected page.

Validation:

- `documents` must not be empty.
- `operations` must not be empty.
- `output.file_name` must not be empty.
- Document ids must not be empty.
- Document ids must be unique.
- Operation document ids must exist.
- Encrypted documents require a non-empty password.
- Unsupported documents must be rejected.
- Page selections must be valid for the target document.

Diagnostic codes:

- `empty_documents`
- `empty_operations`
- `empty_output_file_name`
- `empty_document_id`
- `duplicate_document_id`
- `unknown_document`
- `encrypted_without_password`
- `unsupported_document`
- plus page-selection diagnostic codes above

When there are validation failures, return all deterministic diagnostics found
before returning a plan. Diagnostic order must follow document order first, then
operation order.

## CLI Behavior

The project must be runnable with:

```sh
cd pdf-toolbox-rs
cargo test
cargo run --quiet -- <job.json>
```

If no input path is provided:

- write `usage: pdf-toolbox <job.json>\n` to stderr;
- exit with code `2`.

If the input file cannot be read or parsed:

- write `invalid input\n` to stderr;
- exit with code `2`.

If the job is valid, print exactly one minified JSON line:

```json
{"status":"ok","plan":{"output_file_name":"merged.pdf","title":"Merged","author":"Marvin","pages":[{"document_id":"invoice","page":1}]}}
```

If the job is invalid, print exactly one minified JSON line:

```json
{"status":"error","diagnostics":[{"code":"unknown_document","message":"operation references unknown document 'missing'"}]}
```

The JSON key order shown above is part of the contract.
Output must end with a trailing newline.

The CLI only needs to parse the simple object shape used by the tests:

```json
{
  "documents": [
    {
      "id": "invoice",
      "page_count": 5,
      "encrypted": false,
      "password": null,
      "unsupported": false
    }
  ],
  "operations": [
    {
      "document": "invoice",
      "pages": "1-3"
    }
  ],
  "output": {
    "file_name": "merged.pdf",
    "title": "Merged",
    "author": "Marvin"
  }
}
```

Do not add dependencies for JSON. A small purpose-built parser/writer is enough
for this milestone.

## WASM Boundary Preparation

Keep the library free of:

- filesystem access;
- process arguments;
- stdout/stderr;
- browser APIs;
- global mutable state.

Only `src/main.rs` may handle CLI IO.

## Required Visible Tests

Add or update tests in `pdf-toolbox-rs/tests/cli_test.rs` and/or unit tests for:

- parsing `all`, `odd`, `even`, single pages, ranges, and comma lists;
- rejecting reversed ranges, duplicates, zero, negative, and out-of-range
  selections;
- rejecting encrypted documents without a password;
- rejecting unsupported documents;
- rejecting unknown operation documents;
- preserving operation order in the merge plan;
- copying output metadata into the plan;
- CLI success JSON output;
- CLI error behavior for missing arguments and invalid input.

## Gate

Visible gate:

```sh
cd pdf-toolbox-rs && cargo test && cargo fmt --all -- --check
```

Hidden gate:

```sh
bash ../hidden/pdf_toolbox_hidden.sh
```
