mod cli_json;
mod model;
mod page_selection;
mod planner;

pub use model::{
    Diagnostic, MergeJob, MergeOperation, MergePlan, OutputOptions, PlanPage, SourceDocument,
};
pub use page_selection::parse_page_selection;
pub use planner::build_merge_plan;

#[allow(dead_code)]
pub(crate) fn parse_cli_job(text: &str) -> Result<MergeJob, Diagnostic> {
    cli_json::parse_cli_job(text)
}

#[allow(dead_code)]
pub(crate) fn format_cli_success(plan: &MergePlan) -> String {
    cli_json::format_cli_success(plan)
}

#[allow(dead_code)]
pub(crate) fn format_cli_error(diagnostics: &[Diagnostic]) -> String {
    cli_json::format_cli_error(diagnostics)
}
