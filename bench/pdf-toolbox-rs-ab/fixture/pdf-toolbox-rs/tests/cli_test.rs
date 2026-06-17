use pdf_toolbox::{
    build_merge_plan, parse_page_selection, MergeJob, MergeOperation, OutputOptions, PlanPage,
    SourceDocument,
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
fn parses_page_selections() {
    assert_eq!(parse_page_selection("all", 4).unwrap(), vec![1, 2, 3, 4]);
    assert_eq!(parse_page_selection("odd", 5).unwrap(), vec![1, 3, 5]);
    assert_eq!(parse_page_selection("even", 5).unwrap(), vec![2, 4]);
    assert_eq!(
        parse_page_selection("1, 3, 5-6", 6).unwrap(),
        vec![1, 3, 5, 6]
    );
}

#[test]
fn rejects_bad_page_selections() {
    assert_eq!(
        parse_page_selection("3-1", 5).unwrap_err().code,
        "page_range_reversed"
    );
    assert_eq!(
        parse_page_selection("1,1", 5).unwrap_err().code,
        "duplicate_page"
    );
    assert_eq!(
        parse_page_selection("0", 5).unwrap_err().code,
        "invalid_page_number"
    );
    assert_eq!(
        parse_page_selection("6", 5).unwrap_err().code,
        "page_out_of_range"
    );
}

#[test]
fn builds_merge_plan_in_operation_order() {
    let job = MergeJob {
        documents: vec![doc("invoice", 3), doc("terms", 2)],
        operations: vec![
            MergeOperation {
                document_id: "terms".to_string(),
                pages: "all".to_string(),
            },
            MergeOperation {
                document_id: "invoice".to_string(),
                pages: "2-3".to_string(),
            },
        ],
        output: OutputOptions {
            file_name: "bundle.pdf".to_string(),
            title: Some("Bundle".to_string()),
            author: Some("Marvin".to_string()),
        },
    };

    let plan = build_merge_plan(&job).unwrap();
    assert_eq!(plan.output_file_name, "bundle.pdf");
    assert_eq!(plan.title.as_deref(), Some("Bundle"));
    assert_eq!(plan.author.as_deref(), Some("Marvin"));
    assert_eq!(
        plan.pages,
        vec![
            PlanPage {
                document_id: "terms".to_string(),
                page: 1,
            },
            PlanPage {
                document_id: "terms".to_string(),
                page: 2,
            },
            PlanPage {
                document_id: "invoice".to_string(),
                page: 2,
            },
            PlanPage {
                document_id: "invoice".to_string(),
                page: 3,
            },
        ]
    );
}
