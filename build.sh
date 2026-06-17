#!/usr/bin/env bash
# Rebuild the k-lani-coder release bundle from the workspace.
# Run from the repository root: bash publish/k-lani-coder/build.sh
#
# Public builds are DECLARED evaluation builds (T-37): the expiry date
# is baked in, printed by --version and at serve startup, and gates
# only the operational commands — board/report/context reads work
# forever. Override the default with:
# env 'K_LANI_CODER_EVAL_EXPIRES=YYYY-MM-DD' bash publish/k-lani-coder/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUNDLE="$ROOT/publish/k-lani-coder"
EVAL_EXPIRES="$(printenv 'K_LANI_CODER_EVAL_EXPIRES' 2>/dev/null || true)"
EVAL_EXPIRES="${EVAL_EXPIRES:-2026-09-30}"
echo "[build] evaluation expiry baked in: $EVAL_EXPIRES"
cd "$ROOT"

if command -v cargo-auditable >/dev/null 2>&1; then
  env "K_LANI_CODER_EVAL_EXPIRES=$EVAL_EXPIRES" \
    cargo auditable build --release -p k-lani-coder -p k-lani-ai-proxy
else
  echo "[build] cargo-auditable not found — building WITHOUT embedded SBOM" >&2
  echo "[build] install it before a public release: cargo install cargo-auditable" >&2
  env "K_LANI_CODER_EVAL_EXPIRES=$EVAL_EXPIRES" \
    cargo build --release -p k-lani-coder -p k-lani-ai-proxy
fi

mkdir -p "$BUNDLE/bin" "$BUNDLE/reports" "$BUNDLE/prompts"
cp target/release/k-lani-coder target/release/k-lani-ai-proxy "$BUNDLE/bin/"
cp k-lani-coder/prompt.md k-lani-coder/prompt-small.md k-lani-coder/prompt-planner.md k-lani-coder/prompt-conductor.md "$BUNDLE/prompts/"
cp k-lani-coder/planner-contract.schema.json "$BUNDLE/prompts/"
cp LICENSE.md "$BUNDLE/"

# SHOWCASE.md is public-bundle-specific. Do not overwrite it from the
# historical internal showcase document.
if ! grep -q '^## Current public measurement track' "$BUNDLE/SHOWCASE.md"; then
  echo "[build] ABORT: public SHOWCASE.md is missing the current measurement track" >&2
  exit 1
fi
if grep -q 'serves eight tools' "$BUNDLE/SHOWCASE.md"; then
  echo "[build] ABORT: public SHOWCASE.md was overwritten with the stale internal showcase" >&2
  exit 1
fi

# SECURITY.md is deliberately bundle-specific. The workspace policy covers
# private crates and wire surfaces that are not shipped in this public mirror.
if ! grep -q '^# Security Policy -- k-lani-coder$' "$BUNDLE/SECURITY.md"; then
  echo "[build] ABORT: public SECURITY.md is missing its k-lani-coder scope heading" >&2
  exit 1
fi
for private_surface in \
  'crates/k-lani-server' 'crates/k-lani-wasm' 'crates/bindran/api' \
  'crates/k-lani-adapter-sip' 'crates/k-lani-adapter-robotics' \
  'Recovery and WAL Archive Guarantees'
do
  if grep -q "$private_surface" "$BUNDLE/SECURITY.md"; then
    echo "[build] ABORT: public SECURITY.md leaks private workspace scope: $private_surface" >&2
    exit 1
  fi
done

(cd "$BUNDLE/bin" && sha256sum k-lani-coder k-lani-ai-proxy > SHA256SUMS)
"$BUNDLE/bin/k-lani-coder" --version
echo "[build] bundle ready:"
(cd "$BUNDLE" && ls -la bin/ && cat bin/SHA256SUMS)

# IMPORTANT: the workspace binary now carries the expiry stamp; rebuild
# the internal one without it so local tooling keeps running:
echo "[build] rebuilding internal binary WITHOUT expiry..."
env -u 'K_LANI_CODER_EVAL_EXPIRES' cargo build --release -p k-lani-coder
