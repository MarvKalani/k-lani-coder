use crate::{Diagnostic, MergeJob, MergePlan};

pub fn parse_cli_job(_text: &str) -> Result<MergeJob, Diagnostic> {
    Err(Diagnostic {
        code: "not_implemented".to_string(),
        message: "not implemented".to_string(),
    })
}

pub fn format_cli_success(_plan: &MergePlan) -> String {
    String::new()
}

pub fn format_cli_error(_diagnostics: &[Diagnostic]) -> String {
    String::new()
}
