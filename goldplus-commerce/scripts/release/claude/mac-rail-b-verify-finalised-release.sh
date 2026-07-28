#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS MAC RAIL B — FINALISED-RELEASE VERIFIER
#
# Independently verifies a finalised release. It replaces the copy-paste
# placeholder block that previously printed a false success line after fatal
# git errors: this script fails non-zero BEFORE printing any success wording.
#
# Usage:
#   mac-rail-b-verify-finalised-release.sh --manifest /absolute/path/final-manifest.json
# =============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &&
  pwd -P
)"
APP_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd -P)"
[[ -f "${SCRIPT_DIR}/rail-b-lib.sh" ]] || {
  printf '\nFINALISED_RELEASE_VERIFICATION_FAILED\nreasonCode=MISSING_LIBRARY_FILE\n' >&2; exit 92; }
# shellcheck source=rail-b-lib.sh
source "${SCRIPT_DIR}/rail-b-lib.sh"
railb_enable_fail_closed

MANIFEST=""
TARGET_BRANCH="${RAIL_B_TARGET_BRANCH:-phase-2-measurement-control-tower-completion}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest)      MANIFEST="${2:?}"; shift 2 ;;
    --target-branch) TARGET_BRANCH="${2:?}"; shift 2 ;;
    *) printf '\nFINALISED_RELEASE_VERIFICATION_FAILED\nreasonCode=UNKNOWN_ARGUMENT arg=%s\n' "$1" >&2; exit 2 ;;
  esac
done

die() { printf '\nFINALISED_RELEASE_VERIFICATION_FAILED\nreasonCode=%s\n' "$1" >&2; exit "${2:-1}"; }

[[ -n "$MANIFEST" ]]      || die MANIFEST_REQUIRED 30
[[ "$MANIFEST" = /* ]]    || die MANIFEST_PATH_MUST_BE_ABSOLUTE 31
[[ "$MANIFEST" != *'<'* && "$MANIFEST" != *'>'* ]] || die LITERAL_PLACEHOLDER_PATH_REFUSED 32
[[ ! -L "$MANIFEST" ]]    || die MANIFEST_PATH_IS_SYMLINK 33
[[ -f "$MANIFEST" ]]      || die MANIFEST_FILE_MISSING 34
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$MANIFEST" 2>/dev/null \
  || die MANIFEST_JSON_INVALID 35

field() { node -e '
  const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const k=process.argv[2].split("."); let v=d; for(const p of k) v=(v==null?undefined:v[p]);
  process.stdout.write(v===undefined||v===null?"":String(v));' "$MANIFEST" "$1"; }

RELEASE_ID="$(field release.id)";           [[ -n "$RELEASE_ID" ]]  || die MANIFEST_MISSING_RELEASE_ID 36
PKG_HEAD="$(field release.releasePackageHead)"; [[ -n "$PKG_HEAD" ]] || die MANIFEST_MISSING_PACKAGE_HEAD 37
SCOPE_SHA="$(field release.finalScopeSha256)"
API_DIGEST="$(field images.api.digest)"
WEB_DIGEST="$(field images.web.digest)"
[[ "$RELEASE_ID" != *'<'* && "$PKG_HEAD" != *'<'* ]] || die LITERAL_PLACEHOLDER_VALUE_REFUSED 38

# Remote target branch must be exactly at the package head.
REMOTE_BRANCH="$(git -C "$APP_ROOT" ls-remote origin "refs/heads/${TARGET_BRANCH}" | cut -f1)"
[[ -n "$REMOTE_BRANCH" ]] || die REMOTE_TARGET_BRANCH_MISSING 39
[[ "$REMOTE_BRANCH" == "$PKG_HEAD" ]] || die REMOTE_BRANCH_NOT_AT_PACKAGE_HEAD 40

# The annotated tag must exist and dereference to the package head.
REMOTE_TAG_REF="$(git -C "$APP_ROOT" ls-remote origin "refs/tags/${RELEASE_ID}" | cut -f1)"
[[ -n "$REMOTE_TAG_REF" ]] || die REMOTE_ANNOTATED_TAG_MISSING 41
REMOTE_TAG_TARGET="$(git -C "$APP_ROOT" ls-remote origin "refs/tags/${RELEASE_ID}^{}" | cut -f1)"
[[ -n "$REMOTE_TAG_TARGET" ]] || die REMOTE_TAG_NOT_ANNOTATED 42
[[ "$REMOTE_TAG_TARGET" == "$PKG_HEAD" ]] || die REMOTE_TAG_TARGET_MISMATCH 43

# Final scope must exist and both verifiers must agree with the manifest.
FINAL_SCOPE="$APP_ROOT/docs/platform/releases/claude/CLAUDE_FINAL_RELEASE_SCOPE.json"
[[ -f "$FINAL_SCOPE" ]] || die MISSING_FINAL_SCOPE 44
A="$(node "$SCRIPT_DIR/verify-final-scope.mjs" "$FINAL_SCOPE" --print)" || die FINAL_SCOPE_VERIFIER_FAILED 45
B="$(node "$SCRIPT_DIR/verify-final-scope.mjs" "$FINAL_SCOPE" --independent)" || die FINAL_SCOPE_INDEPENDENT_VERIFIER_FAILED 46
[[ "$A" == "$B" ]] || die FINAL_SCOPE_VERIFIER_DISAGREEMENT 47
[[ -z "$SCOPE_SHA" || "$SCOPE_SHA" == "$A" ]] || die FINAL_SCOPE_SHA_MISMATCH 48

[[ -n "$API_DIGEST" ]] || die MANIFEST_MISSING_API_IMAGE_DIGEST 49
[[ -n "$WEB_DIGEST" ]] || die MANIFEST_MISSING_WEB_IMAGE_DIGEST 50

printf 'release ID:           %s\n' "$RELEASE_ID"
printf 'release-package head: %s\n' "$PKG_HEAD"
printf 'remote target branch: %s\n' "$REMOTE_BRANCH"
printf 'remote tag target:    %s\n' "$REMOTE_TAG_TARGET"
printf 'final scope SHA-256:  %s\n' "$A"
printf 'API image digest:     %s\n' "$API_DIGEST"
printf 'web image digest:     %s\n' "$WEB_DIGEST"
printf '\nREMOTE_BRANCH_AND_ANNOTATED_TAG_VERIFIED\n'
