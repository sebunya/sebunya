#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS RAIL B — FAULT-INJECTION SELF-TEST HARNESS
#
# Deterministic and hermetic. Uses temporary Git repositories, fake command
# adapters on PATH and mocked remote responses.
#
# It NEVER contacts production, never creates a real approval marker, never
# touches real Docker resources and never modifies a real Git remote.
#
# Usage: rail-b-selftest.sh [--json <path>]
# =============================================================================
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
JSON_OUT=""
[[ "${1:-}" == "--json" ]] && JSON_OUT="${2:?}"

PASS=0; FAIL=0; ROWS=""
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT INT TERM

row() { # class, case, expected, observed, verdict
  [[ -n "$ROWS" ]] && ROWS+=","
  ROWS+=$(printf '{"class":"%s","case":"%s","expectedCode":"%s","observed":"%s","verdict":"%s"}' "$1" "$2" "$3" "$4" "$5")
  if [[ "$5" == "REFUSED_AS_REQUIRED" || "$5" == "ACCEPTED_AS_REQUIRED" ]]; then
    PASS=$((PASS+1)); printf '  %-26s %-42s %s\n' "$1" "$2" "$5"
  else
    FAIL=$((FAIL+1)); printf '  %-26s %-42s %s  (expected %s, saw %s)\n' "$1" "$2" "$5" "$3" "$4"
  fi
}

# expect_refusal <class> <case> <expected-code> <command...>
expect_refusal() {
  local cls="$1" name="$2" want="$3"; shift 3
  local out code
  # set -e must not abort on the deliberately-failing probe.
  if out="$("$@" 2>&1)"; then code=0; else code=$?; fi
  if (( code == 0 )); then
    row "$cls" "$name" "$want" "exit0" "NOT_REFUSED"
  elif printf '%s' "$out" | grep -qF -- "$want"; then
    row "$cls" "$name" "$want" "$want" "REFUSED_AS_REQUIRED"
  else
    row "$cls" "$name" "$want" "$(printf '%s' "$out" | tail -1 | cut -c1-60)" "WRONG_CODE"
  fi
}

expect_success() {
  local cls="$1" name="$2"; shift 2
  if "$@" >/dev/null 2>&1; then row "$cls" "$name" "exit0" "exit0" "ACCEPTED_AS_REQUIRED"
  else row "$cls" "$name" "exit0" "nonzero" "UNEXPECTED_REFUSAL"; fi
  return 0
}

echo "Rail B fault matrix (sandbox: $SANDBOX)"

# ─── Fixture: a hermetic origin + worktree ──────────────────────────────────
mk_repo() {
  local root="$1" target="$2"
  mkdir -p "$root/origin" "$root/work"
  git init -q --bare "$root/origin"
  git init -q "$root/work"
  git -C "$root/work" config user.email t@t.local
  git -C "$root/work" config user.name  T
  mkdir -p "$root/work/goldplus-commerce"
  echo '{}' > "$root/work/goldplus-commerce/package.json"
  git -C "$root/work" add -A >/dev/null
  git -C "$root/work" commit -qm base
  git -C "$root/work" remote add origin "$root/origin"
  git -C "$root/work" push -q origin "HEAD:refs/heads/$target"
  git -C "$root/work" fetch -q origin "$target"
}

TARGET=phase-2-test
mk_repo "$SANDBOX/r1" "$TARGET"
APP="$SANDBOX/r1/work/goldplus-commerce"

probe() { # runs a library function in a subshell against the fixture
  bash -c "set -euo pipefail; source '$LIB_DIR/rail-b-lib.sh'; $1"
}

# ─── Class: host and local source ───────────────────────────────────────────
git -C "$SANDBOX/r1/work" checkout -qb claude/mac-side-branch
expect_success "host/local-source" "side branch at target origin accepted" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_branch_preflight '$APP' '$TARGET'"

echo dirty > "$SANDBOX/r1/work/goldplus-commerce/package.json"
expect_refusal "host/local-source" "dirty tracked file" "WORKTREE_NOT_CLEAN" \
  probe "railb_branch_preflight '$APP' '$TARGET'"
git -C "$SANDBOX/r1/work" checkout -q -- .

touch "$SANDBOX/r1/work/goldplus-commerce/untracked.tmp"
expect_refusal "host/local-source" "untracked file" "WORKTREE_NOT_CLEAN" \
  probe "railb_branch_preflight '$APP' '$TARGET'"
rm -f "$SANDBOX/r1/work/goldplus-commerce/untracked.tmp"

git -C "$SANDBOX/r1/work" reset -q --hard HEAD~0
git -C "$SANDBOX/r1/work" commit -q --allow-empty -m ahead
git -C "$SANDBOX/r1/work" push -q origin "HEAD:refs/heads/$TARGET"
git -C "$SANDBOX/r1/work" reset -q --hard HEAD~1
expect_refusal "host/local-source" "behind target origin" "LOCAL_HEAD_NOT_AT_TARGET_REMOTE_HEAD" \
  probe "railb_branch_preflight '$APP' '$TARGET'"

mk_repo "$SANDBOX/r2" "$TARGET"
git -C "$SANDBOX/r2/work" checkout -qb side
git -C "$SANDBOX/r2/work" commit -q --allow-empty -m divergent
expect_refusal "host/local-source" "divergent history" "LOCAL_HEAD_NOT_AT_TARGET_REMOTE_HEAD" \
  probe "railb_branch_preflight '$SANDBOX/r2/work/goldplus-commerce' '$TARGET'"

expect_refusal "host/local-source" "missing target branch on origin" "TARGET_BRANCH_FETCH_FAILED" \
  probe "railb_branch_preflight '$APP' 'no-such-branch'"

# ─── Class: remote movement and finalisation ────────────────────────────────
mk_repo "$SANDBOX/r3" "$TARGET"
R3="$SANDBOX/r3/work/goldplus-commerce"
BASE="$(git -C "$SANDBOX/r3/work" rev-parse HEAD)"
git -C "$SANDBOX/r3/work" commit -q --allow-empty -m moved
git -C "$SANDBOX/r3/work" push -q origin "HEAD:refs/heads/$TARGET"
expect_refusal "remote-movement" "target moved during run" "TARGET_BRANCH_MOVED_DURING_RAIL_B" \
  probe "railb_assert_target_unmoved '$R3' '$TARGET' '$BASE'"
expect_success "remote-movement" "unmoved target accepted" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_assert_target_unmoved '$R3' '$TARGET' \$(git -C '$R3' rev-parse origin/$TARGET)"

mk_repo "$SANDBOX/r4" "$TARGET"
R4="$SANDBOX/r4/work/goldplus-commerce"
git -C "$SANDBOX/r4/work" checkout -q --detach
git -C "$SANDBOX/r4/work" commit -q --allow-empty -m unrelated
UNREL="$(git -C "$SANDBOX/r4/work" rev-parse HEAD)"
expect_refusal "remote-movement" "non-fast-forward finalisation" "NON_FAST_FORWARD_FINALISATION" \
  probe "railb_assert_fast_forward '$R4' '$UNREL' \$(git -C '$R4' rev-parse origin/$TARGET)"

# ─── Class: executable boundary ─────────────────────────────────────────────
mk_repo "$SANDBOX/r5" "$TARGET"
R5="$SANDBOX/r5/work/goldplus-commerce"
EXEC5="$(git -C "$SANDBOX/r5/work" rev-parse HEAD)"
mkdir -p "$SANDBOX/r5/work/goldplus-commerce/apps/api/src"
echo 'export const x = 1;' > "$SANDBOX/r5/work/goldplus-commerce/apps/api/src/leak.ts"
git -C "$SANDBOX/r5/work" add -A >/dev/null
git -C "$SANDBOX/r5/work" commit -qm "runtime leak"
expect_refusal "release-identity" "runtime source in exec..package diff" "RAIL_A_EXECUTABLE_BOUNDARY_INVALID" \
  probe "railb_assert_no_runtime_source '$R5' '$EXEC5' HEAD"

# ─── Class: evidence-path safety ────────────────────────────────────────────
GITROOT="$SANDBOX/r1/work"
expect_refusal "evidence-path" "inside Git root" "EVIDENCE_PATH_INSIDE_GIT_ROOT" \
  probe "assert_evidence_path_safe '$GITROOT/evidence' '$GITROOT'"
expect_refusal "evidence-path" "inside .git metadata" "EVIDENCE_PATH_INSIDE_GIT" \
  probe "assert_evidence_path_safe '$GITROOT/.git/evidence' '$GITROOT'"
mkdir -p "$SANDBOX/GoldPlusFinal"
expect_refusal "evidence-path" "inside quarantined GoldPlusFinal" "EVIDENCE_PATH_INSIDE_QUARANTINED_WORKTREE" \
  probe "assert_evidence_path_safe '$SANDBOX/GoldPlusFinal/evidence' '$GITROOT'"
ln -sfn "$GITROOT" "$SANDBOX/symlink-into-repo"
expect_refusal "evidence-path" "symlink into Git root" "EVIDENCE_PATH_INSIDE_GIT_ROOT" \
  probe "assert_evidence_path_safe '$SANDBOX/symlink-into-repo/evidence' '$GITROOT'"
expect_success "evidence-path" "sibling of Git root accepted" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; assert_evidence_path_safe '$SANDBOX/outside-evidence' '$GITROOT'"

# ─── Class: approval marker (mocked ssh; production never contacted) ────────
MOCK="$SANDBOX/bin"; mkdir -p "$MOCK"
make_ssh_mock() { # $1 = stat output, $2 = content grep result (0/1), $3 = test -f result (0/1)
  cat > "$MOCK/ssh" <<EOF
#!/usr/bin/env bash
# Hermetic ssh mock: never leaves this machine.
case "\$*" in
  *"stat -c"*) echo "$1"; exit 0 ;;
  *"grep -qx"*) exit $2 ;;
  *"test -f"*) exit $3 ;;
  *) exit 0 ;;
esac
EOF
  chmod +x "$MOCK/ssh"
}
PROD="$LIB_DIR/mac-rail-b-production.sh"
run_prod() { PATH="$MOCK:$PATH" bash "$PROD" "$@"; }

expect_refusal "approval-marker" "missing --release" "--release is required" \
  run_prod --marker /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_x
expect_refusal "approval-marker" "missing --marker" "--marker is required" \
  run_prod --release goldplus-programme-x
expect_refusal "approval-marker" "non-approval marker path" "not an approval marker" \
  run_prod --release goldplus-programme-x --marker /root/NOT_A_MARKER
expect_refusal "approval-marker" "wildcard marker path" "wildcard" \
  run_prod --release goldplus-programme-x --marker '/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_*'
expect_refusal "approval-marker" "unknown argument" "unknown argument" run_prod --bogus

make_ssh_mock "root:root 600 1" 0 1
expect_refusal "approval-marker" "marker absent" "absent" \
  run_prod --release goldplus-programme-x --marker /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_x --check-only
make_ssh_mock "root:root 644 1" 0 0
expect_refusal "approval-marker" "wrong mode" "marker metadata is wrong" \
  run_prod --release goldplus-programme-x --marker /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_x --check-only
make_ssh_mock "goldplus:goldplus 600 1" 0 0
expect_refusal "approval-marker" "wrong owner/group" "marker metadata is wrong" \
  run_prod --release goldplus-programme-x --marker /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_x --check-only
make_ssh_mock "root:root 600 2" 0 0
expect_refusal "approval-marker" "wrong link count" "marker metadata is wrong" \
  run_prod --release goldplus-programme-x --marker /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_x --check-only
make_ssh_mock "root:root 600 1" 1 0
expect_refusal "approval-marker" "wrong content" "does not bind" \
  run_prod --release goldplus-programme-x --marker /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_x --check-only

# ─── Class: rollback arguments ──────────────────────────────────────────────
RB="$LIB_DIR/mac-rail-b-rollback.sh"
expect_refusal "deployment/rollback" "missing --api-image" "--api-image is required" bash "$RB" --web-image sha256:b
expect_refusal "deployment/rollback" "missing --web-image" "--web-image is required" bash "$RB" --api-image sha256:a
expect_refusal "deployment/rollback" "unknown argument"   "unknown argument"        bash "$RB" --bogus

# ─── Class: catalogue and commerce safety ───────────────────────────────────
ASSERT="$LIB_DIR/assert-catalogue-collection.mjs"
expect_refusal "commerce-safety" "data.items shape rejected" "CATALOGUE_COLLECTION_MALFORMED" \
  bash -c "echo '{\"data\":{\"items\":[]}}' | node '$ASSERT'"
expect_refusal "commerce-safety" "missing collection rejected" "CATALOGUE_COLLECTION_MISSING" \
  bash -c "echo '{\"success\":true}' | node '$ASSERT'"
expect_refusal "commerce-safety" "malformed body rejected" "CATALOGUE_RESPONSE_MALFORMED" \
  bash -c "echo 'not json' | node '$ASSERT'"
expect_success "commerce-safety" "collection at data accepted" \
  bash -c "echo '{\"data\":[{\"slug\":\"a\"}]}' | node '$ASSERT'"

# ─── Class: gate-state truthfulness ─────────────────────────────────────────
expect_refusal "gate-state" "invalid gate status rejected" "INVALID_GATE_STATUS" \
  probe "record_gate g BOGUS cmd 0 /tmp ''"
expect_success "gate-state" "dry run never reports PASS" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; DRY_RUN=1; out=\$(gate g1 'true'); echo \"\$out\" | grep -q NOT_RUN && ! echo \"\$out\" | grep -q PASS"
expect_success "gate-state" "FAIL blocks a final result" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; DRY_RUN=0; gate g2 'false' >/dev/null; ! gates_allow_final_result"
expect_success "gate-state" "all-PASS allows a final result" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; DRY_RUN=0; gate g3 'true' >/dev/null; gates_allow_final_result"

# ─── Summary ────────────────────────────────────────────────────────────────
TOTAL=$((PASS+FAIL))
printf '\nfault matrix: %d/%d passed\n' "$PASS" "$TOTAL"
if [[ -n "$JSON_OUT" ]]; then
  printf '{"total":%d,"passed":%d,"failed":%d,"contactedProduction":false,"createdMarker":false,"touchedRealDocker":false,"touchedRealRemote":false,"cases":[%s]}\n' \
    "$TOTAL" "$PASS" "$FAIL" "$ROWS" > "$JSON_OUT"
  echo "matrix written to $JSON_OUT"
fi
(( FAIL == 0 )) || exit 1
