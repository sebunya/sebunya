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
expect_refusal "release-identity" "runtime source in exec..package diff" "EXECUTABLE_BOUNDARY_INVALID" \
  probe "railb_assert_boundary_clean '$R5' '$EXEC5' HEAD"

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
expect_refusal "gate-state" "FAIL terminates rather than continuing" "MAC_RAIL_B_VALIDATION_FAILED" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_run_init gs2; EVIDENCE_ROOT=''; DRY_RUN=0; gate g2 'false'"
expect_success "gate-state" "all-PASS reaches VALIDATED" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_run_init gs3; DRY_RUN=0; gate g3 'true' >/dev/null; railb_finalise_run_state"


# ─── Class: terminal gate state machine ─────────────────────────────────────
expect_refusal "terminal-abort" "mandatory BLOCKED terminates immediately" "MAC_RAIL_B_VALIDATION_BLOCKED" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_run_init t1; EVIDENCE_ROOT=''; gate_blocked g.block 'cmd' 'external prerequisite'; echo LATER_PHASE_RAN"
expect_refusal "terminal-abort" "mandatory FAIL terminates immediately" "MAC_RAIL_B_VALIDATION_FAILED" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_run_init t2; EVIDENCE_ROOT=''; DRY_RUN=0; gate g.fail 'false'; echo LATER_PHASE_RAN"
expect_success "terminal-abort" "no later phase runs after a terminal gate" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_run_init t3; EVIDENCE_ROOT=''; DRY_RUN=0; out=\$( (gate g.fail 'false'; echo LATER_PHASE_RAN) 2>&1 ); ! echo \"\$out\" | grep -q LATER_PHASE_RAN"
expect_success "terminal-abort" "no later PASS after a terminal gate" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_run_init t4; EVIDENCE_ROOT=''; DRY_RUN=0; out=\$( (gate g.fail 'false'; gate g.ok 'true') 2>&1 ); ! echo \"\$out\" | grep -q 'PASS *g.ok'"
expect_success "terminal-abort" "earliest terminal gate is authoritative" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_run_init t5; EVIDENCE_ROOT=''; DRY_RUN=0; out=\$( (gate first.fail 'false'; gate second.fail 'false') 2>&1 ); echo \"\$out\" | grep -q 'terminal gate: first.fail'"
expect_success "terminal-abort" "mandatory NOT_RUN is not a valid final state" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_run_init t6; DRY_RUN=1; gate g.dry 'true' >/dev/null; ! railb_finalise_run_state"
expect_refusal "terminal-abort" "NOT_APPLICABLE requires a reason" "NOT_APPLICABLE_REQUIRES_REASON" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_run_init t7; gate_not_applicable g.na 'cmd' ''"

# ─── Class: Docker context selection ────────────────────────────────────────
DBIN="$SANDBOX/dbin"; mkdir -p "$DBIN"
mk_docker() { # $1 = context that responds ("none" = nothing responds)
  printf '%s' "$1" > "$DBIN/.target"
  cat > "$DBIN/docker" <<'DOCKERMOCK'
#!/usr/bin/env bash
target="$(cat "$(dirname "$0")/.target")"
case "$1" in
  context) echo "current-ctx"; exit 0 ;;
  info) [ "${DOCKER_CONTEXT:-current-ctx}" = "$target" ] && exit 0 || exit 1 ;;
esac
exit 0
DOCKERMOCK
  chmod +x "$DBIN/docker"
}
mk_docker current-ctx
expect_success "docker-context" "current context selected" \
  env PATH="$DBIN:$PATH" bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_docker_ready; test \"\$SELECTED_DOCKER_CONTEXT\" = current-ctx"
mk_docker desktop-linux
expect_success "docker-context" "desktop-linux fallback selected" \
  env PATH="$DBIN:$PATH" bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_docker_ready; test \"\$SELECTED_DOCKER_CONTEXT\" = desktop-linux"
mk_docker default
expect_success "docker-context" "default fallback selected" \
  env PATH="$DBIN:$PATH" bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_docker_ready; test \"\$SELECTED_DOCKER_CONTEXT\" = default"
mk_docker none
expect_success "docker-context" "startup timeout blocks with DOCKER_DESKTOP_NOT_READY" \
  env PATH="$DBIN:$PATH" RAIL_B_DOCKER_TIMEOUT=0 bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_docker_ready; test \$? -ne 0 && test \"\$DOCKER_READY_REASON\" = DOCKER_DESKTOP_NOT_READY"
mk_docker current-ctx
expect_success "docker-context" "selected context propagates via DOCKER_CONTEXT" \
  env PATH="$DBIN:$PATH" bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_docker_ready; test \"\$DOCKER_CONTEXT\" = current-ctx"
expect_success "docker-context" "operator global context never changed" \
  bash -c "! grep -qE '^[^#]*docker context use' '$LIB_DIR/rail-b-lib.sh'"

# ─── Class: validation evidence admissibility ───────────────────────────────
FIN="$LIB_DIR/mac-rail-b-finalise-release.sh"
VDIR="$SANDBOX/vdir"; mkdir -p "$VDIR"
mkv() { printf '%s' "$2" > "$VDIR/$1"; printf '%s' "$VDIR/$1"; }
GOOD='{"runId":"r1","runState":"VALIDATED","eligibleForFinalisation":true,"failCount":0,"blockedCount":0,"notRunCount":0,"gates":[{"gateId":"a","status":"PASS"}],"validatedSourceHead":"deadbeef","expectedRemoteHead":"deadbeef","executableCandidate":"x","migrationCeiling":"0048","apiImageDigest":"d","webImageDigest":"d","backupSha256":"b","moduleInventorySha256":"m"}'
expect_refusal "validation-evidence" "missing validation file" "VALIDATION_FILE_MISSING" bash "$FIN" --validation-run /nonexistent/v.json
expect_refusal "validation-evidence" "relative validation path" "VALIDATION_PATH_MUST_BE_ABSOLUTE" bash "$FIN" --validation-run ./v.json
ln -sf "$(mkv real.json "$GOOD")" "$VDIR/link.json"
expect_refusal "validation-evidence" "symlink validation file" "VALIDATION_PATH_IS_SYMLINK" bash "$FIN" --validation-run "$VDIR/link.json"
GITV="$(cd "$LIB_DIR/../../.." && pwd -P)/rail-b-selftest-tmp-validation.json"
printf '%s' "$GOOD" > "$GITV"
expect_refusal "validation-evidence" "validation inside Git root" "VALIDATION_PATH_INSIDE_GIT_ROOT" \
  bash "$FIN" --validation-run "$GITV"
rm -f "$GITV"
expect_refusal "validation-evidence" "invalid JSON" "VALIDATION_JSON_INVALID" bash "$FIN" --validation-run "$(mkv bad.json 'not json')"
expect_refusal "validation-evidence" "runState not VALIDATED" "VALIDATION_RUN_STATE_NOT_VALIDATED" \
  bash "$FIN" --validation-run "$(mkv rs.json '{"runState":"RUNNING"}')"
expect_refusal "validation-evidence" "not eligible for finalisation" "VALIDATION_NOT_ELIGIBLE" \
  bash "$FIN" --validation-run "$(mkv el.json '{"runState":"VALIDATED","eligibleForFinalisation":false}')"
expect_refusal "validation-evidence" "blocked historic run refused" "BLOCKED_RUN_PERMANENTLY_INELIGIBLE" \
  bash "$FIN" --validation-run "$(mkv bl.json '{"runState":"VALIDATED","eligibleForFinalisation":true,"classification":"ABORTED_BLOCKED"}')"
expect_refusal "validation-evidence" "contains FAIL" "VALIDATION_CONTAINS_FAIL" \
  bash "$FIN" --validation-run "$(mkv f.json '{"runState":"VALIDATED","eligibleForFinalisation":true,"failCount":1}')"
expect_refusal "validation-evidence" "contains BLOCKED" "VALIDATION_CONTAINS_BLOCKED" \
  bash "$FIN" --validation-run "$(mkv b.json '{"runState":"VALIDATED","eligibleForFinalisation":true,"failCount":0,"blockedCount":1}')"
expect_refusal "validation-evidence" "contains NOT_RUN" "VALIDATION_CONTAINS_NOT_RUN" \
  bash "$FIN" --validation-run "$(mkv n.json '{"runState":"VALIDATED","eligibleForFinalisation":true,"failCount":0,"blockedCount":0,"notRunCount":1}')"
expect_refusal "validation-evidence" "mandatory gate not PASS" "MANDATORY_GATE_NOT_PASS" \
  bash "$FIN" --validation-run "$(mkv g.json '{"runState":"VALIDATED","eligibleForFinalisation":true,"failCount":0,"blockedCount":0,"notRunCount":0,"gates":[{"gateId":"a","status":"BLOCKED"}]}')"
# The finaliser resolves its repository from its own location, so this case is
# only meaningful when that tree is clean; a dirty tree correctly refuses earlier.
if [ -z "$(git -C "$(cd "$LIB_DIR/../../.." && pwd -P)" status --porcelain --untracked-files=all)" ]; then
  expect_refusal "validation-evidence" "source head mismatch" "VALIDATION_SOURCE_HEAD_MISMATCH" \
    bash "$FIN" --validation-run "$(mkv sh.json "$GOOD")"
else
  expect_refusal "validation-evidence" "dirty tree refused before head comparison" "WORKTREE_NOT_CLEAN" \
    bash "$FIN" --validation-run "$(mkv sh.json "$GOOD")"
fi

# ─── Class: final scope ─────────────────────────────────────────────────────
VF="$LIB_DIR/verify-final-scope.mjs"
expect_refusal "final-scope" "self-referential scope rejected" "FINAL_SCOPE_SELF_REFERENTIAL" \
  bash -c "printf '%s' '{\"a\":1,\"releaseTag\":\"t\"}' > '$SANDBOX/s1.json'; node '$VF' '$SANDBOX/s1.json' --print"
expect_success "final-scope" "both verifiers agree on a clean scope" \
  bash -c "printf '%s' '{\"b\":2,\"a\":[1,2]}' > '$SANDBOX/s2.json'; A=\$(node '$VF' '$SANDBOX/s2.json' --print); B=\$(node '$VF' '$SANDBOX/s2.json' --independent); [ \"\$A\" = \"\$B\" ]"
expect_success "final-scope" "scope-input drift changes the hash" \
  bash -c "printf '%s' '{\"a\":1}' > '$SANDBOX/s3.json'; A=\$(node '$VF' '$SANDBOX/s3.json' --print); printf '%s' '{\"a\":2}' > '$SANDBOX/s3.json'; B=\$(node '$VF' '$SANDBOX/s3.json' --print); [ \"\$A\" != \"\$B\" ]"

# ─── Class: production contract ─────────────────────────────────────────────
# A fully valid marker must still be refused when no finalised release exists.
make_ssh_mock "root:root 600 1" 0 0
expect_refusal "production-contract" "valid marker without a finalised release refused" "MISSING_FINAL_SCOPE" \
  env PATH="$MOCK:$PATH" bash "$LIB_DIR/mac-rail-b-production.sh" --release goldplus-programme-x --marker /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_x --check-only
expect_success "production-contract" "verifier attachment is not release authority" \
  bash -c "grep -q 'tracked repository script' '$LIB_DIR/mac-rail-b-verifier.sh'"
expect_success "production-contract" "preapproval never claims approval readiness" \
  bash -c "! grep -qE '^[^#]*HUMAN_APPROVAL_REQUIRED' '$LIB_DIR/mac-rail-b-preapproval.sh'"
expect_success "production-contract" "only the finaliser returns the finalised status" \
  bash -c "grep -q 'CLAUDE_MAC_RAIL_B_RELEASE_FINALISED_HUMAN_APPROVAL_REQUIRED' '$LIB_DIR/mac-rail-b-finalise-release.sh'"

# ─── Summary ────────────────────────────────────────────────────────────────
TOTAL=$((PASS+FAIL))
printf '\nfault matrix: %d/%d passed\n' "$PASS" "$TOTAL"
if [[ -n "$JSON_OUT" ]]; then
  printf '{"total":%d,"passed":%d,"failed":%d,"contactedProduction":false,"createdMarker":false,"touchedRealDocker":false,"touchedRealRemote":false,"cases":[%s]}\n' \
    "$TOTAL" "$PASS" "$FAIL" "$ROWS" > "$JSON_OUT"
  echo "matrix written to $JSON_OUT"
fi
(( FAIL == 0 )) || exit 1
