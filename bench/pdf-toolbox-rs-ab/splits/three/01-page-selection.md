# Slice 01: Page Selection

Implement only the page-selection parser and its visible tests.

Required behavior:

- `all` expands to every one-based page.
- `odd` expands to odd one-based pages.
- `even` expands to even one-based pages.
- Single pages, ranges, and comma lists work.
- Whitespace around tokens is accepted.
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

No dependencies.
Run `cargo fmt --all` before final output.
