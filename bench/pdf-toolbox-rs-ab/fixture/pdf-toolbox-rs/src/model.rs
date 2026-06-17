#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceDocument {
    pub id: String,
    pub page_count: u32,
    pub encrypted: bool,
    pub password: Option<String>,
    pub unsupported: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeOperation {
    pub document_id: String,
    pub pages: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputOptions {
    pub file_name: String,
    pub title: Option<String>,
    pub author: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeJob {
    pub documents: Vec<SourceDocument>,
    pub operations: Vec<MergeOperation>,
    pub output: OutputOptions,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanPage {
    pub document_id: String,
    pub page: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergePlan {
    pub output_file_name: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub pages: Vec<PlanPage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
}
