#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
CRATE_DIR="$ROOT/pdf-toolbox-rs"

if [[ ! -d "$CRATE_DIR" ]]; then
  echo "missing pdf-toolbox-rs crate" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"; rm -f "$CRATE_DIR/tests/hidden_behavior.rs"' EXIT

cat > "$CRATE_DIR/tests/hidden_behavior.rs" <<'RS'
use pdf_toolbox::{
    build_merge_plan, parse_page_selection, MergeJob, MergeOperation, OutputOptions, SourceDocument,
};

fn doc(id: &str, pages: u32) -> SourceDocument {
    SourceDocument {
        id: id.to_string(),
        page_count: pages,
        encrypted: false,
        password: None,
        unsupported: false,
    }
}

#[test]
fn hidden_page_selection_edges() {
    assert_eq!(parse_page_selection(" odd ", 7).unwrap(), vec![1, 3, 5, 7]);
    assert_eq!(parse_page_selection("even", 6).unwrap(), vec![2, 4, 6]);
    assert_eq!(parse_page_selection("2-4, 6", 6).unwrap(), vec![2, 3, 4, 6]);
    assert_eq!(parse_page_selection("", 6).unwrap_err().code, "empty_page_selection");
    assert_eq!(parse_page_selection("1", 0).unwrap_err().code, "empty_document");
    assert_eq!(parse_page_selection("-1", 6).unwrap_err().code, "invalid_page_number");
}

#[test]
fn hidden_validation_collects_document_and_operation_diagnostics() {
    let job = MergeJob {
        documents: vec![
            SourceDocument {
                id: "secret".to_string(),
                page_count: 2,
                encrypted: true,
                password: None,
                unsupported: false,
            },
            SourceDocument {
                id: "bad".to_string(),
                page_count: 1,
                encrypted: false,
                password: None,
                unsupported: true,
            },
        ],
        operations: vec![
            MergeOperation {
                document_id: "missing".to_string(),
                pages: "all".to_string(),
            },
            MergeOperation {
                document_id: "secret".to_string(),
                pages: "3".to_string(),
            },
        ],
        output: OutputOptions {
            file_name: "out.pdf".to_string(),
            title: None,
            author: None,
        },
    };

    let diagnostics = build_merge_plan(&job).unwrap_err();
    let codes: Vec<&str> = diagnostics.iter().map(|item| item.code.as_str()).collect();
    assert!(codes.contains(&"encrypted_without_password"), "{codes:?}");
    assert!(codes.contains(&"unsupported_document"), "{codes:?}");
    assert!(codes.contains(&"unknown_document"), "{codes:?}");
    assert!(codes.contains(&"page_out_of_range"), "{codes:?}");
}

#[test]
fn hidden_merge_plan_does_not_mutate_job() {
    let job = MergeJob {
        documents: vec![doc("a", 3)],
        operations: vec![MergeOperation {
            document_id: "a".to_string(),
            pages: "1-2".to_string(),
        }],
        output: OutputOptions {
            file_name: "out.pdf".to_string(),
            title: Some("Title".to_string()),
            author: Some("Author".to_string()),
        },
    };
    let before = job.clone();
    let plan = build_merge_plan(&job).unwrap();
    assert_eq!(job, before);
    assert_eq!(plan.pages.len(), 2);
}
RS

(
  cd "$CRATE_DIR"
  cargo test
)

cat > "$TMP_DIR/job.json" <<'JSON'
{
  "documents": [
    {"id": "invoice", "page_count": 3, "encrypted": false, "password": null, "unsupported": false},
    {"id": "appendix", "page_count": 4, "encrypted": false, "password": null, "unsupported": false}
  ],
  "operations": [
    {"document": "invoice", "pages": "2-3"},
    {"document": "appendix", "pages": "even"}
  ],
  "output": {"file_name": "bundle.pdf", "title": "Bundle", "author": "QA"}
}
JSON

expected='{"status":"ok","plan":{"output_file_name":"bundle.pdf","title":"Bundle","author":"QA","pages":[{"document_id":"invoice","page":2},{"document_id":"invoice","page":3},{"document_id":"appendix","page":2},{"document_id":"appendix","page":4}]}}'
actual="$(cd "$CRATE_DIR" && cargo run --quiet -- "$TMP_DIR/job.json")"
if [[ "$actual" != "$expected" ]]; then
  printf 'unexpected CLI success JSON\nexpected: %s\nactual:   %s\n' "$expected" "$actual" >&2
  exit 1
fi

cat > "$TMP_DIR/bad.json" <<'JSON'
{
  "documents": [
    {"id": "invoice", "page_count": 1, "encrypted": false, "password": null, "unsupported": false}
  ],
  "operations": [
    {"document": "missing", "pages": "all"}
  ],
  "output": {"file_name": "bundle.pdf", "title": null, "author": null}
}
JSON

bad_actual="$(cd "$CRATE_DIR" && cargo run --quiet -- "$TMP_DIR/bad.json")"
case "$bad_actual" in
  *'"status":"error"'*'"code":"unknown_document"'*) ;;
  *)
    printf 'unexpected CLI error JSON: %s\n' "$bad_actual" >&2
    exit 1
    ;;
esac
