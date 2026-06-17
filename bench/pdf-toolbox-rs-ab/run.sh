#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLISH_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
FIXTURE_DIR="$SCRIPT_DIR/fixture"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ROOT="${KLANI_PDF_AB_RUN_ROOT:-/tmp/k-lani-pdf-toolbox-rs-ab-runs/$RUN_ID}"
PORT="${KLANI_PDF_AB_HUB_PORT:-8799}"
MODEL="${KLANI_PDF_AB_MODEL:-gpt-5.5}"
EFFORT="${KLANI_PDF_AB_EFFORT:-medium}"
ROLE_TIMEOUT_SECS="${KLANI_PDF_AB_ROLE_TIMEOUT_SECS:-1800}"
REPAIR_ATTEMPTS="${KLANI_PDF_AB_REPAIR_ATTEMPTS:-1}"
MODE_CSV="${KLANI_PDF_AB_MODES:-native,one-shot}"
ONE_SHOT_RUNTIME_PROFILE="${KLANI_PDF_AB_ONE_SHOT_RUNTIME_PROFILE:-codex_one_shot_minimal}"
ONE_SHOT_OUTPUT_MODE="${KLANI_PDF_AB_ONE_SHOT_OUTPUT_MODE:-schema}"
REPAIR_RUNTIME_PROFILE="${KLANI_PDF_AB_REPAIR_RUNTIME_PROFILE:-codex_one_shot_with_gate}"
KLANI_BIN="${KLANI_CODER_BIN:-$REPO_ROOT/target/release/k-lani-coder}"
CODEX_AUTH_SOURCE="${KLANI_CODEX_AUTH_SOURCE:-${HOME:-}/.codex}"

MODEL_SLUG="$(printf '%s' "$MODEL" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9.]+/-/g; s/^-//; s/-$//')"
if [[ -z "$MODEL_SLUG" ]]; then
  MODEL_SLUG="model"
fi

NATIVE_AGENT="${MODEL_SLUG}-${EFFORT}-codex-subscription"
WORKER_AGENT="${MODEL_SLUG}-${EFFORT}-codex-subscription:worker"
REPAIR_AGENT="${MODEL_SLUG}-${EFFORT}-codex-with-gate-subscription:worker"

TASK_PROMPT="$RUN_ROOT/task_prompt.md"
CONTRACT_PROMPT="$RUN_ROOT/host_contract.md"

NATIVE_DIR="$RUN_ROOT/native"
NATIVE_WORK="$NATIVE_DIR/work"
NATIVE_USAGE="$NATIVE_DIR/usage"
NATIVE_CODEX_HOME="$NATIVE_DIR/codex-home"
NATIVE_CODEX_HOME_MANIFEST="$NATIVE_DIR/codex-home-manifest.txt"

ONE_DIR="$RUN_ROOT/k-lani-one-shot"
ONE_WORK="$ONE_DIR/work"
ONE_DATA="$ONE_DIR/data"
ONE_USAGE="$ONE_DATA/agent-usage/codex"

SPLIT_TWO_DIR="$RUN_ROOT/k-lani-split-two"
SPLIT_TWO_WORK="$SPLIT_TWO_DIR/work"
SPLIT_TWO_USAGE="$SPLIT_TWO_DIR/usage"

SPLIT_THREE_DIR="$RUN_ROOT/k-lani-split-three"
SPLIT_THREE_WORK="$SPLIT_THREE_DIR/work"
SPLIT_THREE_USAGE="$SPLIT_THREE_DIR/usage"

if [[ ! -x "$KLANI_BIN" ]]; then
  echo "k-lani-coder binary not executable: $KLANI_BIN" >&2
  echo "Run: cargo build --release -p k-lani-coder" >&2
  exit 2
fi

for required in cargo docker git node timeout tar; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "$required is required" >&2
    exit 2
  fi
done

canonical_mode() {
  case "$1" in
    native|direct|codex-native) printf 'native' ;;
    one-shot|oneshot|k-lani-one-shot|klani-one-shot) printf 'one-shot' ;;
    split-two|split2|k-lani-split-two|klani-split-two) printf 'split-two' ;;
    split-three|split3|k-lani-split-three|klani-split-three) printf 'split-three' ;;
    *) printf '%s' "$1" ;;
  esac
}

mode_enabled() {
  local want="$1"
  local raw part
  IFS=',' read -r -a raw <<< "$MODE_CSV"
  for part in "${raw[@]}"; do
    part="$(canonical_mode "${part// /}")"
    if [[ "$part" == "$want" ]]; then
      return 0
    fi
  done
  return 1
}

enabled_modes_text() {
  local modes=()
  mode_enabled native && modes+=("native")
  mode_enabled one-shot && modes+=("k-lani-one-shot")
  mode_enabled split-two && modes+=("k-lani-split-two")
  mode_enabled split-three && modes+=("k-lani-split-three")
  local IFS=","
  printf '%s' "${modes[*]}"
}

copy_fixture_workspace() {
  local dest="$1"
  mkdir -p "$dest"
  (
    cd "$FIXTURE_DIR"
    tar -cf - .
  ) | (
    cd "$dest"
    tar -xf -
  )
  rm -rf "$dest/pdf-toolbox-rs/target"
  git -C "$dest" init -q
  git -C "$dest" config user.email "benchmark@k-lani.local"
  git -C "$dest" config user.name "k-lani benchmark"
  git -C "$dest" add -A
  git -C "$dest" commit -m "pdf toolbox benchmark baseline" -q
  git -C "$dest" tag benchmark-baseline
  chmod -R a+rwX "$dest"
}

prepare_codex_home() {
  local home="$1"
  local label="$2"
  local manifest="$3"

  case "$home" in
    "$RUN_ROOT"/*) ;;
    *)
      echo "refusing to prepare Codex home outside run root: $home" >&2
      return 2
      ;;
  esac

  if [[ ! -f "$CODEX_AUTH_SOURCE/auth.json" ]]; then
    echo "Codex auth source is missing auth.json: $CODEX_AUTH_SOURCE" >&2
    echo "Log in with the official Codex CLI first, or set KLANI_CODEX_AUTH_SOURCE." >&2
    return 2
  fi

  rm -rf "$home"
  mkdir -p "$home"
  cp "$CODEX_AUTH_SOURCE/auth.json" "$home/auth.json"
  chmod 0700 "$home"
  chmod 0600 "$home/auth.json"

  {
    printf 'mode: auth-only-fresh\n'
    printf 'label: %s\n' "$label"
    printf 'created_utc: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'contains_auth_json: yes\n'
    printf 'excluded_history_config_cache: yes\n'
    printf 'files:\n'
    (
      cd "$home"
      find . -maxdepth 2 -type f -printf '%P\n' | sort | sed 's/^/- /'
    )
  } > "$manifest"
  chmod a+r "$manifest"
}

run_compose() {
  local compose_file="$1"
  local service="$2"
  local prompt_file="$3"
  local stdout_file="$4"
  local stderr_file="$5"
  shift 5
  (
    cd "$PUBLISH_DIR"
    timeout "${ROLE_TIMEOUT_SECS}s" \
      env "$@" docker compose -f "$compose_file" run --build --rm "$service" < "$prompt_file"
  ) >"$stdout_file" 2>"$stderr_file"
}

prebuild_codex_agent() {
  local out_dir="$1"
  (
    cd "$PUBLISH_DIR"
    docker compose -f "$PUBLISH_DIR/docker-compose.codex-agent.yml" build codex-agent
  ) >"$out_dir/codex-agent-build.log" 2>&1
}

write_task_prompt() {
  cat "$SCRIPT_DIR/BENCH_AGENT_RULES.md" > "$TASK_PROMPT"
  printf '\n' >> "$TASK_PROMPT"
  cat "$SCRIPT_DIR/product_spec.md" >> "$TASK_PROMPT"
}

write_source_metadata() {
  {
    printf 'fixture: publish/k-lani-coder/bench/pdf-toolbox-rs-ab/fixture\n'
    printf 'one-shot-output-mode: %s\n' "$ONE_SHOT_OUTPUT_MODE"
    printf 'repo-commit: '
    git -C "$REPO_ROOT" rev-parse HEAD
    printf 'fixture-files:\n'
    (
      cd "$FIXTURE_DIR"
      find . -path '*/target' -prune -o -type f -print | sort
    )
  } > "$RUN_ROOT/source.txt"
}

write_contract_prompt() {
  cat > "$CONTRACT_PROMPT" <<EOF
Implement the first PDF Toolbox RS milestone.
allowed_symbols: pdf-toolbox-rs/Cargo.toml, pdf-toolbox-rs/src/cli_json.rs, pdf-toolbox-rs/src/lib.rs, pdf-toolbox-rs/src/main.rs, pdf-toolbox-rs/src/model.rs, pdf-toolbox-rs/src/page_selection.rs, pdf-toolbox-rs/src/planner.rs, pdf-toolbox-rs/tests/cli_test.rs
docs: pdf-toolbox-rs/README.md
gate: cd pdf-toolbox-rs && cargo test && cargo fmt --all -- --check
done: visible gate and hidden gate are green; public API, CLI JSON, diagnostics, and WASM-ready core boundary match the product spec
level: 1
tags: benchmark, pdf-toolbox, rust, wasm-ready-core, one-shot
model: ${WORKER_AGENT}
effort: ${EFFORT}
runtime_profile: ${ONE_SHOT_RUNTIME_PROFILE}
one_shot_output_mode: ${ONE_SHOT_OUTPUT_MODE}
context_pack: boundary_local_edges
boundary_mode: modify_existing
max_context_tokens: 30000
context_tokens: 30000

# Contract Source

The following task prompt is the benchmark product requirement. Preserve the
literal API names, diagnostic codes, CLI output shape, and allowed file scope.

EOF
  cat "$TASK_PROMPT" >> "$CONTRACT_PROMPT"
}

write_slice_contract() {
  local out="$1"
  local title="$2"
  local allowed="$3"
  local docs="$4"
  local slice_spec="$5"
  local agent="${6:-$WORKER_AGENT}"
  local runtime_profile="${7:-$ONE_SHOT_RUNTIME_PROFILE}"
  cat > "$out" <<EOF
${title}
allowed_symbols: ${allowed}
docs: ${docs}
gate: cd pdf-toolbox-rs && cargo test && cargo fmt --all -- --check
done: this slice is applied through guarded one-shot writeback; final acceptance is the aggregate visible and hidden gate after all slices
level: 1
tags: benchmark, pdf-toolbox, rust, wasm-ready-core, split-one-shot
model: ${agent}
effort: ${EFFORT}
runtime_profile: ${runtime_profile}
one_shot_output_mode: ${ONE_SHOT_OUTPUT_MODE}
context_pack: boundary_local_edges
boundary_mode: modify_existing
max_context_tokens: 22000
context_tokens: 22000

# Slice Contract

The worker receives a deliberately sliced task. Do not ask for more context.
If the provided context is insufficient, return status needs_context. Otherwise
return a complete patch for the allowed files only.

EOF
  cat "$SCRIPT_DIR/BENCH_AGENT_RULES.md" >> "$out"
  printf '\n' >> "$out"
  cat "$slice_spec" >> "$out"
}

write_benchmark_models() {
  local data_dir="$1"
  mkdir -p "$data_dir"
  cat > "$data_dir/k-lani-coder-models.json" <<EOF
{
  "_doc": "Benchmark-local exact model registry for the PDF Toolbox A/B runner.",
  "${WORKER_AGENT}": {
    "billing": "subscription",
    "routing_status": "qualified",
    "residency": "us",
    "level": 3,
    "context_tokens": 258000,
    "runtime_profile": "${ONE_SHOT_RUNTIME_PROFILE}",
    "deployment": {
      "base_model": "OpenAI/${MODEL}",
      "checkpoint": "${MODEL}",
      "quantization": "provider-managed",
      "quantizer": "OpenAI",
      "artifact": "ChatGPT/Codex subscription via official Codex CLI",
      "runtime": "Codex CLI in isolated Docker",
      "runtime_kind": "codex",
      "runtime_profile": "${ONE_SHOT_RUNTIME_PROFILE}"
    },
    "roles": ["worker"],
    "tasks": {
      "worker": {
        "generation": { "reasoning_effort": "${EFFORT}" },
        "output_contract": "one_shot_patch",
        "prompt_contract": {
          "language": "English",
          "style": "TDD, KISS, SINE, minimal changes"
        }
      }
    }
  },
  "${REPAIR_AGENT}": {
    "billing": "subscription",
    "routing_status": "qualified",
    "residency": "us",
    "level": 3,
    "context_tokens": 258000,
    "runtime_profile": "${REPAIR_RUNTIME_PROFILE}",
    "deployment": {
      "base_model": "OpenAI/${MODEL}",
      "checkpoint": "${MODEL}",
      "quantization": "provider-managed",
      "quantizer": "OpenAI",
      "artifact": "ChatGPT/Codex subscription via official Codex CLI",
      "runtime": "Codex CLI in isolated Docker",
      "runtime_kind": "codex",
      "runtime_profile": "${REPAIR_RUNTIME_PROFILE}"
    },
    "roles": ["worker"],
    "tasks": {
      "worker": {
        "generation": { "reasoning_effort": "${EFFORT}" },
        "output_contract": "one_shot_patch_with_gate",
        "prompt_contract": {
          "language": "English",
          "style": "repair with visible gate before final structured patch"
        }
      }
    }
  }
}
EOF
  cat > "$data_dir/k-lani-coder-policy.json" <<'EOF'
{
  "deny_rust": [
    "unsafe",
    "std::fs::remove",
    "include!",
    "#[no_mangle]"
  ],
  "deny_ts": [
    "child_process",
    "eval(",
    "new Function("
  ],
  "deny_csharp": [
    "System.Diagnostics.Process",
    "ProcessStartInfo",
    "DllImport",
    "NativeLibrary",
    "unsafe",
    "File.Delete",
    "Directory.Delete"
  ],
  "deny_python": [
    "subprocess",
    "os.system",
    "eval(",
    "exec(",
    "ctypes",
    "pickle.loads",
    "shutil.rmtree"
  ],
  "deny_paths": [
    "build.rs"
  ],
  "format_on_write": {
    "rust": true,
    "typescript": true,
    "csharp": false,
    "python": false
  },
  "max_symbol_lines": 120,
  "allow_owner_override": false,
  "require_acceptance_criteria": true,
  "planner_loop": {
    "budget_tokens": 200000,
    "max_rejections": 2,
    "max_runs": 25,
    "max_wall_seconds": 3600,
    "require_owner_before_worker_launch": false
  },
  "assurance": {
    "mode": "shadow",
    "default_profile": "trace",
    "large_impact": {
      "crates": 3,
      "symbols": 25,
      "tickets": 5
    },
    "owner_ids": [
      "owner"
    ]
  },
  "csharp_stylecop": "off"
}
EOF
}

parse_ticket_id() {
  local file="$1"
  grep -Eo '[0-9a-fA-F]{8}' "$file" | head -n 1 | tr 'A-F' 'a-f'
}

run_gate_cmd() {
  local dir="$1"
  local command="$2"
  local out="$3"
  (
    cd "$dir"
    eval "$command"
  ) >"$out" 2>&1
}

clean_build_artifacts() {
  local dir="$1"
  rm -rf "$dir/pdf-toolbox-rs/target"
}

save_diff() {
  local work="$1"
  local out_dir="$2"
  local base="HEAD"
  if git -C "$work" rev-parse --verify benchmark-baseline >/dev/null 2>&1; then
    base="benchmark-baseline"
  fi
  clean_build_artifacts "$work"
  git -C "$work" add -N . >/dev/null 2>&1 || true
  git -C "$work" status --short > "$out_dir/git-status.txt"
  git -C "$work" diff --stat "$base" > "$out_dir/diff-stat.txt"
  git -C "$work" diff "$base" > "$out_dir/diff.patch"
  git -C "$work" diff --name-only "$base" > "$out_dir/scope.txt"
}

checkpoint_split_workspace() {
  local work="$1"
  local slice_id="$2"
  clean_build_artifacts "$work"
  git -C "$work" add -A
  if git -C "$work" diff --cached --quiet; then
    return 0
  fi
  git -C "$work" commit -m "pdf toolbox benchmark ${slice_id}" -q
}

validate_scope() {
  local scope_file="$1"
  local status=0
  while IFS= read -r changed; do
    case "$changed" in
      pdf-toolbox-rs/Cargo.toml) ;;
      pdf-toolbox-rs/src/cli_json.rs) ;;
      pdf-toolbox-rs/src/lib.rs) ;;
      pdf-toolbox-rs/src/main.rs) ;;
      pdf-toolbox-rs/src/model.rs) ;;
      pdf-toolbox-rs/src/page_selection.rs) ;;
      pdf-toolbox-rs/src/planner.rs) ;;
      pdf-toolbox-rs/tests/cli_test.rs) ;;
      "") ;;
      *) status=1 ;;
    esac
  done < "$scope_file"
  return "$status"
}

run_host_gates() {
  local work="$1"
  local out_dir="$2"
  local gate_status=0
  local hidden_status=0
  local scope_status=0

  run_gate_cmd "$work" "cd pdf-toolbox-rs && cargo test && cargo fmt --all -- --check" "$out_dir/gate.txt" || gate_status=$?
  printf '%s\n' "$gate_status" > "$out_dir/gate.status"

  run_gate_cmd "$work" "bash '$SCRIPT_DIR/hidden/pdf_toolbox_hidden.sh'" "$out_dir/hidden-gate.txt" || hidden_status=$?
  printf '%s\n' "$hidden_status" > "$out_dir/hidden-gate.status"

  save_diff "$work" "$out_dir"
  validate_scope "$out_dir/scope.txt" || scope_status=$?
  printf '%s\n' "$scope_status" > "$out_dir/scope.status"
}

host_gates_ok() {
  local out_dir="$1"
  [[ "$(cat "$out_dir/gate.status" 2>/dev/null || printf missing)" == "0" ]] &&
    [[ "$(cat "$out_dir/hidden-gate.status" 2>/dev/null || printf missing)" == "0" ]] &&
    [[ "$(cat "$out_dir/scope.status" 2>/dev/null || printf missing)" == "0" ]]
}

workspace_changed_from_baseline() {
  local work="$1"
  git -C "$work" rev-parse --verify benchmark-baseline >/dev/null 2>&1 &&
    ! git -C "$work" diff --quiet benchmark-baseline
}

append_log_excerpt() {
  local title="$1"
  local file="$2"
  local lines="${3:-160}"
  printf '\n## %s\n\n' "$title"
  if [[ -f "$file" ]]; then
    printf '```text\n'
    tail -n "$lines" "$file"
    printf '\n```\n'
  else
    printf 'missing: `%s`\n' "$file"
  fi
}

write_repair_spec() {
  local out="$1"
  local run_dir="$2"
  local attempt="$3"
  cat > "$out" <<EOF
# Repair Attempt ${attempt}

The previous split workers produced a candidate implementation. It is already
present in the workspace you receive. Do not restart the whole task and do not
ask for more context. Repair only what is needed to make the visible gate,
hidden gate, and policy writeback pass.

Required repair behavior:

- Keep the existing public API and CLI behavior unless a gate failure proves it
  wrong.
- Preserve the already passing visible tests.
- Fix the hidden-gate failure by collecting all relevant diagnostics; do not
  stop operation/page-selection validation merely because document validation
  already found diagnostics.
- std::process::exit is allowed for this CLI benchmark.
- Return a complete patch for the allowed files only.

Authoritative diagnostic codes from the product spec:

- Page selection: empty_document, empty_page_selection, invalid_page_number,
  page_range_reversed, page_out_of_range, duplicate_page.
- Merge job validation: empty_documents, empty_operations,
  empty_output_file_name, empty_document_id, duplicate_document_id,
  unknown_document, encrypted_without_password, unsupported_document.
- Do not invent aliases such as unknown_operation_document,
  encrypted_input_without_password, or unsupported_input.

EOF
  append_log_excerpt "Visible Gate Output" "$run_dir/gate.txt" 220 >> "$out"
  append_log_excerpt "Hidden Gate Output" "$run_dir/hidden-gate.txt" 260 >> "$out"
  append_log_excerpt "Scope Output" "$run_dir/scope.txt" 120 >> "$out"
  {
    printf '\n## Previous Worker Logs\n'
    for log in "$run_dir"/slice-*/worker.stderr.log; do
      if [[ -f "$log" ]]; then
        append_log_excerpt "$(basename "$(dirname "$log")") stderr" "$log" 80
      fi
    done
  } >> "$out"
}

validate_usage() {
  local usage_file="$1"
  local out_file="$2"
  local run_kind="$3"
  local expected_profile="$4"
  local min_rows="${5:-1}"
  local expected_output_mode="${6:-}"
  node - "$usage_file" "$MODEL" "$EFFORT" "$run_kind" "$expected_profile" "$min_rows" "$expected_output_mode" > "$out_file" <<'NODE'
const fs = require("node:fs");
const usageFile = process.argv[2];
const model = process.argv[3];
const effort = process.argv[4];
const runKind = process.argv[5];
const expectedProfile = process.argv[6];
const minRows = Number(process.argv[7] || 1);
const expectedOutputMode = process.argv[8] || "";
const expectedProfiles = new Set(expectedProfile.split(",").map((item) => item.trim()).filter(Boolean));
let rows = [];
try {
  rows = fs.readFileSync(usageFile, "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
} catch (error) {
  console.log(`missing or unreadable usage file: ${error.message}`);
  process.exit(1);
}
const validRows = rows.filter((row) =>
  row.source === "codex_exec_json" &&
  expectedProfiles.has(row.runtime_profile) &&
  row.mcp_mode === "none" &&
  row.model === model &&
  row.effort === effort &&
  row.resume === false &&
  row.codex_home_isolated === true &&
  row.codex_home_mode === "auth-only-fresh" &&
  (!expectedOutputMode || row.one_shot_output_mode === expectedOutputMode) &&
  typeof row.codex_home_manifest_path === "string" &&
  row.codex_home_manifest_path.length > 0
);
if (validRows.length < minRows) {
  const outputModeText = expectedOutputMode ? ` and one_shot_output_mode=${expectedOutputMode}` : "";
  console.log(`expected at least ${minRows} valid ${runKind} Codex usage row(s) with isolated auth-only CODEX_HOME${outputModeText}, got ${validRows.length}`);
  process.exit(1);
}
console.log(`valid ${runKind} Codex usage rows with isolated auth-only CODEX_HOME: ${validRows.length}`);
NODE
}

run_native() {
  mkdir -p "$NATIVE_WORK" "$NATIVE_USAGE"
  chmod 0777 "$NATIVE_USAGE"
  copy_fixture_workspace "$NATIVE_WORK"
  prepare_codex_home "$NATIVE_CODEX_HOME" "native-pdf-toolbox" "$NATIVE_CODEX_HOME_MANIFEST" || return $?

  local status=0
  run_compose \
    "$PUBLISH_DIR/docker-compose.codex-direct-agent.yml" \
    codex-direct-agent \
    "$TASK_PROMPT" \
    "$NATIVE_DIR/codex.stdout.jsonl" \
    "$NATIVE_DIR/codex.stderr.log" \
    KLANI_DIRECT_WORK_HOST_DIR="$NATIVE_WORK" \
    KLANI_CODEX_USAGE_HOST_DIR="$NATIVE_USAGE" \
    KLANI_CODEX_HOME_HOST_DIR="$NATIVE_CODEX_HOME" \
    KLANI_CODEX_HOME_ISOLATED=1 \
    KLANI_CODEX_HOME_MODE=auth-only-fresh \
    KLANI_CODEX_HOME_LABEL=native-pdf-toolbox \
    KLANI_CODEX_HOME_MANIFEST_PATH="$NATIVE_CODEX_HOME_MANIFEST" \
    KLANI_CODEX_CONTAINER_USER="$(id -u):$(id -g)" \
    KLANI_TICKET=00000001 \
    KLANI_AGENT_ID="$NATIVE_AGENT" \
    KLANI_MODEL="$MODEL" \
    KLANI_REASONING_EFFORT="$EFFORT" \
    KLANI_CODEX_RUNTIME_PROFILE=native_default \
    KLANI_ROLE=worker \
    KLANI_PHASE=native_direct \
    KLANI_READ_STDIN=1 || status=$?
  printf '%s\n' "$status" > "$NATIVE_DIR/codex.status"
  run_host_gates "$NATIVE_WORK" "$NATIVE_DIR"
  local usage_status=0
  validate_usage "$NATIVE_USAGE/codex-usage.ndjson" "$NATIVE_DIR/usage-evidence.txt" native native_default || usage_status=$?
  printf '%s\n' "$usage_status" > "$NATIVE_DIR/usage-evidence.status"
}

run_one_shot() {
  mkdir -p "$ONE_WORK" "$ONE_DATA" "$ONE_USAGE"
  chmod 0777 "$ONE_USAGE"
  copy_fixture_workspace "$ONE_WORK"
  write_benchmark_models "$ONE_DATA"
  "$KLANI_BIN" index --workspace "$ONE_WORK" --data-dir "$ONE_DATA" --rebuild > "$ONE_DIR/index.txt"
  "$KLANI_BIN" ticket new \
    --data-dir "$ONE_DATA" \
    --title "PDF Toolbox RS first milestone benchmark" \
    --spec-file "$CONTRACT_PROMPT" \
    --category benchmark \
    --priority 0 > "$ONE_DIR/seed-ticket.txt"

  local ticket
  ticket="$(parse_ticket_id "$ONE_DIR/seed-ticket.txt")"
  if [[ -z "$ticket" ]]; then
    echo "could not parse one-shot ticket id from $ONE_DIR/seed-ticket.txt" >&2
    return 1
  fi
  printf '%s\n' "$ticket" > "$ONE_DIR/ticket.txt"

  local status=0
  local codex_home="$ONE_DIR/worker-implementation-codex-home"
  local codex_home_manifest="$ONE_DIR/worker-implementation-codex-home-manifest.txt"
  local codex_home_label="one-shot-worker-$ticket"
  prebuild_codex_agent "$ONE_DIR" || status=$?
  if [[ "$status" == "0" ]]; then
    prepare_codex_home "$codex_home" "$codex_home_label" "$codex_home_manifest" || status=$?
    chmod -R a+rwX "$codex_home" 2>/dev/null || true
  fi
  if [[ "$status" == "0" ]]; then
    (
      cd "$REPO_ROOT"
      timeout "${ROLE_TIMEOUT_SECS}s" env \
        KLANI_CODEX_HOME_HOST_DIR="$codex_home" \
        KLANI_CODEX_HOME_ISOLATED=1 \
        KLANI_CODEX_HOME_MODE=auth-only-fresh \
        KLANI_CODEX_HOME_LABEL="$codex_home_label" \
        KLANI_CODEX_HOME_MANIFEST_PATH="$codex_home_manifest" \
        "$KLANI_BIN" planner-loop \
        --data-dir "$ONE_DATA" \
        --workspace "$ONE_WORK" \
        --worker-launch enforce \
        --hub "127.0.0.1:$PORT" \
        --level 3 \
        --max-runs 1 \
        --json
    ) >"$ONE_DIR/worker.stdout.json" 2>"$ONE_DIR/worker.stderr.log" || status=$?
  fi
  if [[ "$status" == "0" ]]; then
    status="$(node - "$ONE_DIR/worker.stdout.json" <<'NODE'
const fs = require("node:fs");
try {
  const decision = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (decision.worker_run && Number.isInteger(decision.worker_run.exit_code)) {
    process.stdout.write(String(decision.worker_run.exit_code));
  } else if (decision.action === "worker_launched") {
    process.stdout.write("0");
  } else {
    process.stdout.write("1");
  }
} catch {
  process.stdout.write("1");
}
NODE
)"
  fi
  printf '%s\n' "$status" > "$ONE_DIR/worker.status"
  run_host_gates "$ONE_WORK" "$ONE_DIR"
  "$KLANI_BIN" ticket show "$ticket" --data-dir "$ONE_DATA" > "$ONE_DIR/ticket-after-worker.txt" 2>&1 || true
  local usage_status=0
  validate_usage "$ONE_USAGE/codex-usage.ndjson" "$ONE_DIR/usage-evidence.txt" one-shot "$ONE_SHOT_RUNTIME_PROFILE" 1 "$ONE_SHOT_OUTPUT_MODE" || usage_status=$?
  printf '%s\n' "$usage_status" > "$ONE_DIR/usage-evidence.status"
}

append_slice_usage() {
  local slice_usage="$1"
  local combined_usage="$2"
  local slice_usage_dir
  local combined_usage_dir
  slice_usage_dir="$(dirname "$slice_usage")"
  combined_usage_dir="$(dirname "$combined_usage")"
  if [[ -f "$slice_usage" ]]; then
    cat "$slice_usage" >> "$combined_usage"
  fi
  if [[ -d "$slice_usage_dir" ]]; then
    find "$slice_usage_dir" -maxdepth 1 -type f \( -name 'codex-events-*.jsonl' -o -name 'codex-one-shot-result-*.json' \) -exec cp {} "$combined_usage_dir/" \;
  fi
}

run_split_slice() {
  local run_dir="$1"
  local work_dir="$2"
  local combined_usage="$3"
  local index="$4"
  local title="$5"
  local allowed="$6"
  local docs="$7"
  local spec="$8"
  local agent="${9:-$WORKER_AGENT}"
  local runtime_profile="${10:-$ONE_SHOT_RUNTIME_PROFILE}"

  local slice_id
  slice_id="$(printf 'slice-%02d' "$index")"
  local slice_dir="$run_dir/$slice_id"
  local data_dir="$slice_dir/data"
  local contract="$slice_dir/contract.md"
  local status=0

  mkdir -p "$slice_dir" "$data_dir/agent-usage/codex"
  chmod 0777 "$data_dir/agent-usage/codex"
  write_benchmark_models "$data_dir"
  "$KLANI_BIN" index --workspace "$work_dir" --data-dir "$data_dir" --rebuild > "$slice_dir/index.txt"
  write_slice_contract "$contract" "$title" "$allowed" "$docs" "$spec" "$agent" "$runtime_profile"
  "$KLANI_BIN" ticket new \
    --data-dir "$data_dir" \
    --title "$title" \
    --spec-file "$contract" \
    --category benchmark \
    --priority 0 > "$slice_dir/seed-ticket.txt"

  local ticket
  ticket="$(parse_ticket_id "$slice_dir/seed-ticket.txt")"
  if [[ -z "$ticket" ]]; then
    echo "could not parse split ticket id from $slice_dir/seed-ticket.txt" >&2
    printf '1\n' > "$slice_dir/worker.status"
    return 1
  fi
  printf '%s\n' "$ticket" > "$slice_dir/ticket.txt"

  local codex_home="$slice_dir/worker-implementation-codex-home"
  local codex_home_manifest="$slice_dir/worker-implementation-codex-home-manifest.txt"
  local codex_home_label="$slice_id-$ticket"
  prepare_codex_home "$codex_home" "$codex_home_label" "$codex_home_manifest" || status=$?
  chmod -R a+rwX "$codex_home" 2>/dev/null || true

  if [[ "$status" == "0" ]]; then
    (
      cd "$REPO_ROOT"
      timeout "${ROLE_TIMEOUT_SECS}s" env \
        KLANI_CODEX_HOME_HOST_DIR="$codex_home" \
        KLANI_CODEX_HOME_ISOLATED=1 \
        KLANI_CODEX_HOME_MODE=auth-only-fresh \
        KLANI_CODEX_HOME_LABEL="$codex_home_label" \
        KLANI_CODEX_HOME_MANIFEST_PATH="$codex_home_manifest" \
        "$KLANI_BIN" planner-loop \
        --data-dir "$data_dir" \
        --workspace "$work_dir" \
        --worker-launch enforce \
        --hub "127.0.0.1:$PORT" \
        --level 3 \
        --max-runs 1 \
        --json
    ) >"$slice_dir/worker.stdout.json" 2>"$slice_dir/worker.stderr.log" || status=$?
  fi
  if [[ "$status" == "0" ]]; then
    status="$(node - "$slice_dir/worker.stdout.json" <<'NODE'
const fs = require("node:fs");
try {
  const decision = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (decision.worker_run && Number.isInteger(decision.worker_run.exit_code)) {
    process.stdout.write(String(decision.worker_run.exit_code));
  } else if (decision.action === "worker_launched") {
    process.stdout.write("0");
  } else {
    process.stdout.write("1");
  }
} catch {
  process.stdout.write("1");
}
NODE
)"
  fi
  printf '%s\n' "$status" > "$slice_dir/worker.status"
  append_slice_usage "$data_dir/agent-usage/codex/codex-usage.ndjson" "$combined_usage"
  if [[ "$status" == "0" ]]; then
    checkpoint_split_workspace "$work_dir" "$slice_id"
  fi
  "$KLANI_BIN" ticket show "$ticket" --data-dir "$data_dir" > "$slice_dir/ticket-after-worker.txt" 2>&1 || true
  return "$status"
}

run_repair_attempts() {
  local run_dir="$1"
  local work_dir="$2"
  local combined_usage="$3"
  local label="$4"
  local index_base="$5"
  local current_status="$6"

  if [[ "$current_status" == "0" ]] && host_gates_ok "$run_dir"; then
    return 0
  fi
  if [[ "$REPAIR_ATTEMPTS" -le 0 ]]; then
    return 1
  fi
  if ! workspace_changed_from_baseline "$work_dir"; then
    return 1
  fi

  local attempt=1
  local attempt_status=0
  while [[ "$attempt" -le "$REPAIR_ATTEMPTS" ]]; do
    checkpoint_split_workspace "$work_dir" "${label}-pre-repair-${attempt}"
    local repair_spec="$run_dir/repair-${attempt}.md"
    write_repair_spec "$repair_spec" "$run_dir" "$attempt"

    attempt_status=0
    run_split_slice \
      "$run_dir" \
      "$work_dir" \
      "$combined_usage" \
      "$((index_base + attempt))" \
      "PDF Toolbox ${label} repair ${attempt}" \
      "pdf-toolbox-rs/Cargo.toml, pdf-toolbox-rs/src/cli_json.rs, pdf-toolbox-rs/src/lib.rs, pdf-toolbox-rs/src/main.rs, pdf-toolbox-rs/src/model.rs, pdf-toolbox-rs/src/page_selection.rs, pdf-toolbox-rs/src/planner.rs, pdf-toolbox-rs/tests/cli_test.rs" \
      "pdf-toolbox-rs/README.md" \
      "$repair_spec" \
      "$REPAIR_AGENT" \
      "$REPAIR_RUNTIME_PROFILE" || attempt_status=$?

    run_host_gates "$work_dir" "$run_dir"
    if [[ "$attempt_status" == "0" ]] && host_gates_ok "$run_dir"; then
      return 0
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

run_split_two() {
  mkdir -p "$SPLIT_TWO_WORK" "$SPLIT_TWO_USAGE"
  : > "$SPLIT_TWO_USAGE/codex-usage.ndjson"
  chmod 0777 "$SPLIT_TWO_USAGE"
  copy_fixture_workspace "$SPLIT_TWO_WORK"
  prebuild_codex_agent "$SPLIT_TWO_DIR" || {
    printf '1\n' > "$SPLIT_TWO_DIR/worker.status"
    return 1
  }

  local status=0
  run_split_slice \
    "$SPLIT_TWO_DIR" \
    "$SPLIT_TWO_WORK" \
    "$SPLIT_TWO_USAGE/codex-usage.ndjson" \
    1 \
    "PDF Toolbox split-two core parser and planner" \
    "pdf-toolbox-rs/src/lib.rs, pdf-toolbox-rs/src/model.rs, pdf-toolbox-rs/src/page_selection.rs, pdf-toolbox-rs/src/planner.rs, pdf-toolbox-rs/tests/cli_test.rs" \
    "pdf-toolbox-rs/README.md" \
    "$SCRIPT_DIR/splits/two/01-core.md" || status=$?

  if [[ "$status" == "0" ]]; then
    run_split_slice \
      "$SPLIT_TWO_DIR" \
      "$SPLIT_TWO_WORK" \
      "$SPLIT_TWO_USAGE/codex-usage.ndjson" \
      2 \
      "PDF Toolbox split-two CLI JSON" \
      "pdf-toolbox-rs/src/cli_json.rs, pdf-toolbox-rs/src/lib.rs, pdf-toolbox-rs/src/main.rs, pdf-toolbox-rs/tests/cli_test.rs" \
      "pdf-toolbox-rs/README.md, pdf-toolbox-rs/src/model.rs, pdf-toolbox-rs/src/page_selection.rs, pdf-toolbox-rs/src/planner.rs" \
      "$SCRIPT_DIR/splits/two/02-cli.md" || status=$?
  fi

  run_host_gates "$SPLIT_TWO_WORK" "$SPLIT_TWO_DIR"
  if run_repair_attempts "$SPLIT_TWO_DIR" "$SPLIT_TWO_WORK" "$SPLIT_TWO_USAGE/codex-usage.ndjson" "split-two" 80 "$status"; then
    status=0
  else
    status=$?
  fi
  printf '%s\n' "$status" > "$SPLIT_TWO_DIR/worker.status"
  local usage_status=0
  validate_usage "$SPLIT_TWO_USAGE/codex-usage.ndjson" "$SPLIT_TWO_DIR/usage-evidence.txt" split-two "$ONE_SHOT_RUNTIME_PROFILE,$REPAIR_RUNTIME_PROFILE" 2 "$ONE_SHOT_OUTPUT_MODE" || usage_status=$?
  printf '%s\n' "$usage_status" > "$SPLIT_TWO_DIR/usage-evidence.status"
  return "$status"
}

run_split_three() {
  mkdir -p "$SPLIT_THREE_WORK" "$SPLIT_THREE_USAGE"
  : > "$SPLIT_THREE_USAGE/codex-usage.ndjson"
  chmod 0777 "$SPLIT_THREE_USAGE"
  copy_fixture_workspace "$SPLIT_THREE_WORK"
  prebuild_codex_agent "$SPLIT_THREE_DIR" || {
    printf '1\n' > "$SPLIT_THREE_DIR/worker.status"
    return 1
  }

  local status=0
  run_split_slice \
    "$SPLIT_THREE_DIR" \
    "$SPLIT_THREE_WORK" \
    "$SPLIT_THREE_USAGE/codex-usage.ndjson" \
    1 \
    "PDF Toolbox split-three page selection" \
    "pdf-toolbox-rs/src/page_selection.rs, pdf-toolbox-rs/tests/cli_test.rs" \
    "pdf-toolbox-rs/README.md, pdf-toolbox-rs/src/model.rs" \
    "$SCRIPT_DIR/splits/three/01-page-selection.md" || status=$?

  if [[ "$status" == "0" ]]; then
    run_split_slice \
      "$SPLIT_THREE_DIR" \
      "$SPLIT_THREE_WORK" \
      "$SPLIT_THREE_USAGE/codex-usage.ndjson" \
      2 \
      "PDF Toolbox split-three merge plan" \
      "pdf-toolbox-rs/src/model.rs, pdf-toolbox-rs/src/planner.rs, pdf-toolbox-rs/tests/cli_test.rs" \
      "pdf-toolbox-rs/README.md, pdf-toolbox-rs/src/page_selection.rs" \
      "$SCRIPT_DIR/splits/three/02-merge-plan.md" || status=$?
  fi

  if [[ "$status" == "0" ]]; then
    run_split_slice \
      "$SPLIT_THREE_DIR" \
      "$SPLIT_THREE_WORK" \
      "$SPLIT_THREE_USAGE/codex-usage.ndjson" \
      3 \
      "PDF Toolbox split-three CLI JSON" \
      "pdf-toolbox-rs/src/cli_json.rs, pdf-toolbox-rs/src/lib.rs, pdf-toolbox-rs/src/main.rs, pdf-toolbox-rs/tests/cli_test.rs" \
      "pdf-toolbox-rs/README.md, pdf-toolbox-rs/src/model.rs, pdf-toolbox-rs/src/page_selection.rs, pdf-toolbox-rs/src/planner.rs" \
      "$SCRIPT_DIR/splits/three/03-cli-json.md" || status=$?
  fi

  run_host_gates "$SPLIT_THREE_WORK" "$SPLIT_THREE_DIR"
  if run_repair_attempts "$SPLIT_THREE_DIR" "$SPLIT_THREE_WORK" "$SPLIT_THREE_USAGE/codex-usage.ndjson" "split-three" 80 "$status"; then
    status=0
  else
    status=$?
  fi
  printf '%s\n' "$status" > "$SPLIT_THREE_DIR/worker.status"
  local usage_status=0
  validate_usage "$SPLIT_THREE_USAGE/codex-usage.ndjson" "$SPLIT_THREE_DIR/usage-evidence.txt" split-three "$ONE_SHOT_RUNTIME_PROFILE,$REPAIR_RUNTIME_PROFILE" 3 "$ONE_SHOT_OUTPUT_MODE" || usage_status=$?
  printf '%s\n' "$usage_status" > "$SPLIT_THREE_DIR/usage-evidence.status"
  return "$status"
}

write_report() {
  local status_note="$1"
  node - "$RUN_ROOT" "$status_note" "$(enabled_modes_text)" <<'NODE' > "$RUN_ROOT/report.md"
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const statusNote = process.argv[3] || "";
const enabledModes = process.argv[4] || "";
const runs = [
  {
    name: "native",
    dir: "native",
    usage: "native/usage/codex-usage.ndjson",
    statuses: [["codex", "native/codex.status"], ["visible_gate", "native/gate.status"], ["hidden_gate", "native/hidden-gate.status"], ["scope", "native/scope.status"], ["usage", "native/usage-evidence.status"]],
  },
  {
    name: "k-lani-one-shot",
    dir: "k-lani-one-shot",
    usage: "k-lani-one-shot/data/agent-usage/codex/codex-usage.ndjson",
    statuses: [["worker", "k-lani-one-shot/worker.status"], ["visible_gate", "k-lani-one-shot/gate.status"], ["hidden_gate", "k-lani-one-shot/hidden-gate.status"], ["scope", "k-lani-one-shot/scope.status"], ["usage", "k-lani-one-shot/usage-evidence.status"]],
  },
  {
    name: "k-lani-split-two",
    dir: "k-lani-split-two",
    usage: "k-lani-split-two/usage/codex-usage.ndjson",
    statuses: [["worker", "k-lani-split-two/worker.status"], ["visible_gate", "k-lani-split-two/gate.status"], ["hidden_gate", "k-lani-split-two/hidden-gate.status"], ["scope", "k-lani-split-two/scope.status"], ["usage", "k-lani-split-two/usage-evidence.status"]],
  },
  {
    name: "k-lani-split-three",
    dir: "k-lani-split-three",
    usage: "k-lani-split-three/usage/codex-usage.ndjson",
    statuses: [["worker", "k-lani-split-three/worker.status"], ["visible_gate", "k-lani-split-three/gate.status"], ["hidden_gate", "k-lani-split-three/hidden-gate.status"], ["scope", "k-lani-split-three/scope.status"], ["usage", "k-lani-split-three/usage-evidence.status"]],
  },
];
function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}
function read(rel) {
  try { return fs.readFileSync(path.join(root, rel), "utf8"); } catch { return ""; }
}
function status(rel) {
  const text = read(rel).trim();
  return text === "" ? "missing" : text;
}
function rows(rel, run) {
  return read(rel).split(/\n+/).filter(Boolean).map((line) => ({ run, ...JSON.parse(line) }));
}
function cell(value) {
  return String(value ?? "-").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}
function truncate(value, max) {
  const text = cell(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}
function itemText(item) {
  if (!item) return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    return item.content.map((part) => typeof part === "string" ? part : (part.text || "")).join("");
  }
  return "";
}
function usageDir(runName) {
  const run = activeRuns.find((item) => item.name === runName);
  return run ? path.dirname(path.join(root, run.usage)) : root;
}
function resolveUsageArtifact(row, field) {
  const value = row[field];
  if (!value) return "";
  if (path.isAbsolute(value)) {
    if (value.startsWith("/usage/")) return path.join(usageDir(row.run), value.slice("/usage/".length));
    return value;
  }
  return path.join(root, value);
}
function addPathMatches(text, files) {
  for (const match of text.matchAll(/"path"\s*:\s*"([^"]+)"/g)) {
    files.add(match[1]);
  }
}
function parseOneShotResult(text) {
  try {
    return JSON.parse(text);
  } catch {
    const begin = "KLANI_ONE_SHOT_RESULT_BEGIN";
    const end = "KLANI_ONE_SHOT_RESULT_END";
    const start = text.indexOf(begin);
    if (start < 0) throw new Error("missing result frame");
    const rest = text.slice(start + begin.length);
    const stop = rest.indexOf(end);
    if (stop < 0) throw new Error("missing result frame end");
    return JSON.parse(rest.slice(0, stop).trim());
  }
}
function summarizeFinalResult(row) {
  const resultPath = resolveUsageArtifact(row, "one_shot_result_path");
  if (!resultPath || !fs.existsSync(resultPath)) return { status: "-", note: "-" };
  try {
    const parsed = parseOneShotResult(fs.readFileSync(resultPath, "utf8"));
    const needs = Array.isArray(parsed.needs_context) ? parsed.needs_context : [];
    const note = needs.map((item) => item.reason || item.symbol || item.path || "").filter(Boolean).join("; ");
    return { status: parsed.status || "-", note: note || "-" };
  } catch {
    return { status: "unreadable", note: resultPath };
  }
}
function summarizeAgentMessages(row) {
  const eventPath = resolveUsageArtifact(row, "events_path");
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  const statuses = new Map();
  const files = new Set();
  let messages = 0;
  let jsonMessages = 0;
  let bytes = 0;
  for (const line of fs.readFileSync(eventPath, "utf8").split(/\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const item = event.item || event.data?.item || event.msg?.item;
    if (!item || item.type !== "agent_message") continue;
    const text = itemText(item);
    messages += 1;
    bytes += Buffer.byteLength(text, "utf8");
    addPathMatches(text, files);
    try {
      const parsed = JSON.parse(text);
      jsonMessages += 1;
      const status = parsed.status || "-";
      statuses.set(status, (statuses.get(status) || 0) + 1);
      if (Array.isArray(parsed.files)) {
        for (const file of parsed.files) {
          if (file && file.path) files.add(file.path);
        }
      }
    } catch {
      const match = text.match(/"status"\s*:\s*"([^"]+)"/);
      if (match) {
        const status = `${match[1]}?`;
        statuses.set(status, (statuses.get(status) || 0) + 1);
      }
    }
  }
  const finalResult = summarizeFinalResult(row);
  return {
    run: row.run,
    eventFile: path.basename(eventPath),
    messages,
    bytes,
    jsonMessages,
    statuses: [...statuses.entries()].map(([key, value]) => `${key}:${value}`).join(", ") || "-",
    files: [...files],
    finalStatus: finalResult.status,
    finalNote: finalResult.note,
  };
}
function ok(run) {
  return run.statuses.every(([, rel]) => status(rel) === "0");
}
function noteTiming(total, row) {
  const started = Date.parse(row.started_ts || "");
  const ended = Date.parse(row.ended_ts || row.ts || "");
  if (Number.isFinite(started)) {
    total.startedMs = total.startedMs === null ? started : Math.min(total.startedMs, started);
  }
  if (Number.isFinite(ended)) {
    total.endedMs = total.endedMs === null ? ended : Math.max(total.endedMs, ended);
  }
}
const activeRuns = runs.filter((run) => exists(run.dir));
const usage = activeRuns.flatMap((run) => rows(run.usage, run.name));
const messageEvidence = usage.map(summarizeAgentMessages).filter(Boolean);
const byRole = new Map();
const totals = new Map();
for (const row of usage) {
  const key = [row.run, row.role || "-", row.phase || "-", row.runtime_profile || "-", row.one_shot_output_mode || "-", row.mcp_mode || "-", row.agent || "-", row.model || "-", row.effort || "-"].join("\t");
  const group = byRole.get(key) || { rows: 0, input: 0, cached: 0, output: 0, reasoning: 0, total: 0, mcpCalls: 0, commands: 0, contextPack: 0 };
  group.rows += 1;
  group.input += Number(row.input_tokens || 0);
  group.cached += Number(row.cached_input_tokens || row.cache_read_input_tokens || 0);
  group.output += Number(row.output_tokens || 0);
  group.reasoning += Number(row.reasoning_output_tokens || 0);
  group.total += Number(row.total_tokens || 0);
  group.mcpCalls += Number(row.mcp_tool_calls || 0);
  group.commands += Number(row.command_executions || 0);
  group.contextPack += Number(row.context_pack_estimated_tokens || 0);
  byRole.set(key, group);
  const total = totals.get(row.run) || { input: 0, cached: 0, output: 0, reasoning: 0, total: 0, startedMs: null, endedMs: null };
  total.input += Number(row.input_tokens || 0);
  total.cached += Number(row.cached_input_tokens || row.cache_read_input_tokens || 0);
  total.output += Number(row.output_tokens || 0);
  total.reasoning += Number(row.reasoning_output_tokens || 0);
  total.total += Number(row.total_tokens || 0);
  noteTiming(total, row);
  totals.set(row.run, total);
}
const nativeTotal = totals.get("native")?.total || 0;
function percent(value, base) {
  if (!base) return "-";
  return `${((value / base) * 100).toFixed(1)}%`;
}
function ratio(value) {
  if (!nativeTotal) return "-";
  return `${(value / nativeTotal).toFixed(2)}x`;
}
function wall(total) {
  if (total.startedMs === null || total.endedMs === null) return "-";
  return `${((total.endedMs - total.startedMs) / 1000).toFixed(1)}s`;
}

let out = "# PDF Toolbox RS A/B Benchmark Report\n\n";
out += `Run root: \`${root}\`\n\n`;
out += `Enabled modes: \`${enabledModes || "none"}\`\n\n`;
out += "Source:\n\n```text\n" + read("source.txt") + "```\n\n";
if (statusNote) out += `Status: ${statusNote}\n\n`;
out += "## Status\n\n";
out += "| run | step | status |\n|---|---|---:|\n";
for (const run of activeRuns) {
  for (const [step, rel] of run.statuses) {
    out += `| ${run.name} | ${step} | ${status(rel)} |\n`;
  }
  out += `| ${run.name} | accepted | ${ok(run) ? "yes" : "no"} |\n`;
}
out += "\n## Usage By Role\n\n";
out += "| run | role | phase | runtime profile | output mode | mcp | agent | model | effort | rows | input | cached | output | reasoning | total | mcp calls | commands | context pack |\n";
out += "|---|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n";
for (const [key, group] of [...byRole.entries()].sort()) {
  const [run, role, phase, profile, outputMode, mcp, agent, model, effort] = key.split("\t");
  out += `| ${run} | ${role} | ${phase} | ${profile} | ${outputMode} | ${mcp} | ${agent} | ${model} | ${effort} | ${group.rows} | ${group.input} | ${group.cached} | ${group.output} | ${group.reasoning} | ${group.total} | ${group.mcpCalls} | ${group.commands} | ${group.contextPack} |\n`;
}
out += "\n## Usage Totals\n\n";
out += "| run | wall time | input | cached | cache % | output | reasoning | total | vs native |\n";
out += "|---|---:|---:|---:|---:|---:|---:|---:|---:|\n";
for (const run of activeRuns.map((item) => item.name)) {
  const total = totals.get(run) || { input: 0, cached: 0, output: 0, reasoning: 0, total: 0, startedMs: null, endedMs: null };
  out += `| ${run} | ${wall(total)} | ${total.input} | ${total.cached} | ${percent(total.cached, total.input)} | ${total.output} | ${total.reasoning} | ${total.total} | ${ratio(total.total)} |\n`;
}
out += "\n## Agent Message Evidence\n\n";
if (messageEvidence.length === 0) {
  out += "No Codex event evidence found.\n\n";
} else {
  out += "| run | event file | messages | bytes | JSON messages | message status | files mentioned | final result | final note |\n";
  out += "|---|---|---:|---:|---:|---|---|---|---|\n";
  for (const evidence of messageEvidence) {
    const shownFiles = evidence.files.slice(0, 8).join(", ");
    const extraFiles = evidence.files.length > 8 ? `, +${evidence.files.length - 8} more` : "";
    out += `| ${cell(evidence.run)} | ${cell(evidence.eventFile)} | ${evidence.messages} | ${evidence.bytes} | ${evidence.jsonMessages} | ${cell(evidence.statuses)} | ${truncate(shownFiles + extraFiles, 180)} | ${cell(evidence.finalStatus)} | ${truncate(evidence.finalNote, 180)} |\n`;
  }
  out += "\n";
}
out += "\n## Diff Stats\n\n";
for (const run of activeRuns) {
  out += `### ${run.name}\n\n`;
  out += "```text\n" + read(`${run.dir}/diff-stat.txt`) + "```\n\n";
}
out += "## Validity Notes\n\n";
out += "- Native Codex receives the whole fixture workspace.\n";
out += "- k-lani-one-shot receives a measured context pack and returns a schema-constrained patch.\n";
out += "- k-lani-split-two and k-lani-split-three run multiple fresh one-shot workers on one evolving workspace and aggregate their usage rows.\n";
out += "- All modes use the same product spec, agent rules, model, effort, visible gate, and hidden gate.\n";
out += "- One accepted sample is calibration only, not a publication-grade claim.\n";
process.stdout.write(out);
NODE
}

mkdir -p "$RUN_ROOT"
write_source_metadata
write_task_prompt
write_contract_prompt

echo "run root: $RUN_ROOT"
echo "enabled modes: $(enabled_modes_text)"
echo "task prompt: $TASK_PROMPT"

FINAL_STATUS_NOTE=""
EXIT_STATUS=0

if mode_enabled native; then
  echo "running native Codex..."
  run_native || EXIT_STATUS=1
  if [[ ! -f "$NATIVE_DIR/codex.status" || "$(cat "$NATIVE_DIR/codex.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: native Codex process failed."
    EXIT_STATUS=1
  elif [[ "$(cat "$NATIVE_DIR/gate.status")" != "0" || "$(cat "$NATIVE_DIR/hidden-gate.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: native Codex did not pass all gates."
    EXIT_STATUS=1
  elif [[ "$(cat "$NATIVE_DIR/scope.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: native Codex changed files outside the allowed scope."
    EXIT_STATUS=1
  elif [[ "$(cat "$NATIVE_DIR/usage-evidence.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: native Codex usage evidence is missing or not isolated."
    EXIT_STATUS=1
  fi
fi

if mode_enabled one-shot; then
  echo "running k-lani one-shot..."
  run_one_shot || EXIT_STATUS=1
  if [[ ! -f "$ONE_DIR/worker.status" || "$(cat "$ONE_DIR/worker.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: k-lani one-shot worker failed."
    EXIT_STATUS=1
  elif [[ "$(cat "$ONE_DIR/gate.status")" != "0" || "$(cat "$ONE_DIR/hidden-gate.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: k-lani one-shot did not pass all gates."
    EXIT_STATUS=1
  elif [[ "$(cat "$ONE_DIR/scope.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: k-lani one-shot changed files outside the allowed scope."
    EXIT_STATUS=1
  elif [[ "$(cat "$ONE_DIR/usage-evidence.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: k-lani one-shot usage evidence is missing or not isolated."
    EXIT_STATUS=1
  fi
fi

if mode_enabled split-two; then
  echo "running k-lani split-two..."
  run_split_two || EXIT_STATUS=1
  if [[ ! -f "$SPLIT_TWO_DIR/worker.status" || "$(cat "$SPLIT_TWO_DIR/worker.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: k-lani split-two worker sequence failed."
    EXIT_STATUS=1
  elif [[ "$(cat "$SPLIT_TWO_DIR/gate.status")" != "0" || "$(cat "$SPLIT_TWO_DIR/hidden-gate.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: k-lani split-two did not pass all gates."
    EXIT_STATUS=1
  elif [[ "$(cat "$SPLIT_TWO_DIR/scope.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: k-lani split-two changed files outside the allowed scope."
    EXIT_STATUS=1
  elif [[ "$(cat "$SPLIT_TWO_DIR/usage-evidence.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: k-lani split-two usage evidence is missing or incomplete."
    EXIT_STATUS=1
  fi
fi

if mode_enabled split-three; then
  echo "running k-lani split-three..."
  run_split_three || EXIT_STATUS=1
  if [[ ! -f "$SPLIT_THREE_DIR/worker.status" || "$(cat "$SPLIT_THREE_DIR/worker.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: k-lani split-three worker sequence failed."
    EXIT_STATUS=1
  elif [[ "$(cat "$SPLIT_THREE_DIR/gate.status")" != "0" || "$(cat "$SPLIT_THREE_DIR/hidden-gate.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: k-lani split-three did not pass all gates."
    EXIT_STATUS=1
  elif [[ "$(cat "$SPLIT_THREE_DIR/scope.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: k-lani split-three changed files outside the allowed scope."
    EXIT_STATUS=1
  elif [[ "$(cat "$SPLIT_THREE_DIR/usage-evidence.status")" != "0" ]]; then
    FINAL_STATUS_NOTE="invalid: k-lani split-three usage evidence is missing or incomplete."
    EXIT_STATUS=1
  fi
fi

write_report "$FINAL_STATUS_NOTE"
echo "report: $RUN_ROOT/report.md"
exit "$EXIT_STATUS"
