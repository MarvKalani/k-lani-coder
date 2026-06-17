# Slice 02: Merge Plan And Validation

Implement the backend-neutral merge plan builder and validation rules.

The page-selection parser from slice 01 is already present. Use it instead of
duplicating selector logic.

Required behavior:

- Do not mutate the input job.
- Preserve operation order.
- Expand each operation through `parse_page_selection`.
- Copy output file name, title, and author into the plan.
- Produce one `PlanPage` per selected page.
- Collect deterministic diagnostics before returning an error.

Validation codes:

- `empty_documents`
- `empty_operations`
- `empty_output_file_name`
- `empty_document_id`
- `duplicate_document_id`
- `unknown_document`
- `encrypted_without_password`
- `unsupported_document`
- plus page-selection diagnostic codes from slice 01

Diagnostic order must follow document order first, then operation order.

No dependencies.
Run `cargo fmt --all` before final output.
