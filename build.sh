#!/usr/bin/env bash
# Rebuild the k-lani-coder release bundle from the workspace.
# Run from the repository root: bash publish/k-lani-coder/build.sh
#
# Public builds are DECLARED evaluation builds (T-37): the expiry date
# is baked in, printed by --version and at serve startup, and gates
# only the operational commands — board/report/context reads work
# forever. Set KCODER_EVAL_EXPIRES before calling, or accept the
# default below (last day of the release quarter).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUNDLE="$ROOT/publish/k-lani-coder"
export KCODER_EVAL_EXPIRES="${KCODER_EVAL_EXPIRES:-2026-09-30}"
echo "[build] evaluation expiry baked in: $KCODER_EVAL_EXPIRES"
cd "$ROOT"

if command -v cargo-auditable >/dev/null 2>&1; then
  cargo auditable build --release -p k-lani-coder -p k-lani-ai-proxy
else
  echo "[build] cargo-auditable not found — building WITHOUT embedded SBOM" >&2
  echo "[build] install it before a public release: cargo install cargo-auditable" >&2
  cargo build --release -p k-lani-coder -p k-lani-ai-proxy
fi

mkdir -p "$BUNDLE/bin" "$BUNDLE/reports" "$BUNDLE/prompts"
cp target/release/k-lani-coder target/release/k-lani-ai-proxy "$BUNDLE/bin/"
cp k-lani-coder/SHOWCASE.md "$BUNDLE/SHOWCASE.md"
cp k-lani-coder/prompt.md k-lani-coder/prompt-small.md k-lani-coder/prompt-planner.md k-lani-coder/prompt-conductor.md "$BUNDLE/prompts/"
cp LICENSE.md SECURITY.md "$BUNDLE/"

(cd "$BUNDLE/bin" && sha256sum k-lani-coder k-lani-ai-proxy > SHA256SUMS)
"$BUNDLE/bin/k-lani-coder" --version
echo "[build] bundle ready:"
(cd "$BUNDLE" && ls -la bin/ && cat bin/SHA256SUMS)

# IMPORTANT: the workspace binary now carries the expiry stamp; rebuild
# the internal one without it so local tooling keeps running:
echo "[build] rebuilding internal binary WITHOUT expiry..."
env -u KCODER_EVAL_EXPIRES cargo build --release -p k-lani-coder
