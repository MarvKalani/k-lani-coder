use crate::Diagnostic;

pub fn parse_page_selection(_selection: &str, _page_count: u32) -> Result<Vec<u32>, Diagnostic> {
    Err(Diagnostic {
        code: "not_implemented".to_string(),
        message: "not implemented".to_string(),
    })
}
