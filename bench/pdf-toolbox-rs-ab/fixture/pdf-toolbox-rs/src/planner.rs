use crate::{Diagnostic, MergeJob, MergePlan};

pub fn build_merge_plan(_job: &MergeJob) -> Result<MergePlan, Vec<Diagnostic>> {
    Err(vec![Diagnostic {
        code: "not_implemented".to_string(),
        message: "not implemented".to_string(),
    }])
}
