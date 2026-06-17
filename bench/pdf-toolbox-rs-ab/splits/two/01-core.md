# Slice 01: Core Parser And Planner

Implement the library core for the PDF toolbox milestone.

This slice owns:

- the public model types;
- `parse_page_selection`;
- `build_merge_plan`;
- visible tests for page selection, validation, metadata, and operation order.

Do not implement CLI JSON in this slice except for keeping the crate compiling.

Required behavior:

- Support page selectors `all`, `odd`, `even`, a single page, a range, and comma
  lists.
- Reject empty documents, empty selectors, invalid page numbers, reversed
  ranges, out-of-range pages, and duplicates with deterministic diagnostic
  codes.
- Build backend-neutral merge plans without mutating the input job.
- Validate empty document lists, empty operations, empty output file name, empty
  document ids, duplicate document ids, unknown operation documents, encrypted
  inputs without passwords, unsupported inputs, and invalid page selections.
- Use the canonical diagnostic codes from the product spec:
  `empty_documents`, `empty_operations`, `empty_output_file_name`,
  `empty_document_id`, `duplicate_document_id`, `unknown_document`,
  `encrypted_without_password`, `unsupported_document`, and the page-selection
  codes `empty_document`, `empty_page_selection`, `invalid_page_number`,
  `page_range_reversed`, `page_out_of_range`, `duplicate_page`.
- Preserve operation order.
- Copy output file name, title, and author into the plan.

No dependencies.
Run `cargo fmt --all` before final output.
