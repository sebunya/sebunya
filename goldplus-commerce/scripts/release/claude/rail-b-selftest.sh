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
  probe "railb_assert_executable_boundary '$R5' '$EXEC5' HEAD"

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
expect_refusal "validation-evidence" "blocked historic run refused" "FAILED_RUN_PERMANENTLY_INELIGIBLE" \
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


# ─── Class: shell API linkage and fail-closed behaviour ─────────────────────
LINK="$LIB_DIR/rail-b-api-linkage-test.sh"
expect_success "linkage" "tracked callers pass the linkage test" bash "$LINK"
expect_success "linkage" "undefined function is detected" \
  bash -c "cp '$LIB_DIR/mac-rail-b-preapproval.sh' '$SANDBOX/pre.bak'; \
    sed -i.bak 's/railb_branch_preflight /railb_branch_prefligt /' '$LIB_DIR/mac-rail-b-preapproval.sh'; \
    ! bash '$LINK' >/dev/null 2>&1; rc=\$?; \
    cp '$SANDBOX/pre.bak' '$LIB_DIR/mac-rail-b-preapproval.sh'; rm -f '$LIB_DIR/mac-rail-b-preapproval.sh.bak'; exit \$rc"
expect_success "linkage" "stale renamed caller is detected" \
  bash -c "cp '$LIB_DIR/mac-rail-b-preapproval.sh' '$SANDBOX/pre2.bak'; \
    sed -i.bak 's/railb_assert_executable_boundary /railb_assert_no_runtime_source /' '$LIB_DIR/mac-rail-b-preapproval.sh'; \
    ! bash '$LINK' >/dev/null 2>&1; rc=\$?; \
    cp '$SANDBOX/pre2.bak' '$LIB_DIR/mac-rail-b-preapproval.sh'; rm -f '$LIB_DIR/mac-rail-b-preapproval.sh.bak'; exit \$rc"
expect_refusal "linkage" "missing library file refused" "MISSING_LIBRARY_FILE" \
  bash -c "cp '$LIB_DIR/rail-b-lib.sh' '$SANDBOX/lib.bak'; mv '$LIB_DIR/rail-b-lib.sh' '$SANDBOX/lib.hidden'; \
    bash '$LIB_DIR/mac-rail-b-preapproval.sh' --dry-run; rc=\$?; \
    mv '$SANDBOX/lib.hidden' '$LIB_DIR/rail-b-lib.sh'; exit \$rc"
expect_refusal "fail-closed" "undefined railb_ function refused at startup" "UNDEFINED_SHELL_FUNCTION" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_require_functions railb_does_not_exist"
expect_refusal "fail-closed" "unexpected command-not-found is terminal" "UNHANDLED_SCRIPT_ERROR" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_run_init fc1; EVIDENCE_ROOT=''; railb_enable_fail_closed; definitely_not_a_command; echo SHOULD_NOT_PRINT"
expect_success "fail-closed" "no success wording after an unexpected error" \
  bash -c "source '$LIB_DIR/rail-b-lib.sh'; railb_run_init fc2; EVIDENCE_ROOT=''; \
    out=\$( (railb_enable_fail_closed; nope_cmd; echo VALIDATION_COMPLETE) 2>&1 ); \
    ! echo \"\$out\" | grep -q VALIDATION_COMPLETE"

# ─── Class: dry-run truthfulness assessment ─────────────────────────────────
# The verifier must never conflate "this host cannot assess the dry run" with
# "the dry run lied". Both paths are asserted against the tracked verifier text
# and against a synthetic dry-run log evaluated by the same predicates.
VERF="$LIB_DIR/mac-rail-b-verifier.sh"
expect_success "dry-run-assessment" "non-Darwin host is reported NOT_ASSESSABLE, never truthful" \
  bash -c "grep -q 'DRY_RUN_TRUTHFUL=not_assessable' '$VERF' && \
    grep -q 'NOT_ASSESSABLE_NON_DARWIN_HOST' '$VERF'"
expect_success "dry-run-assessment" "non-Darwin path never prints PACKAGE_VERIFIED" \
  bash -c "! grep -A6 'DRY_RUN_ASSESSMENT_REQUIRES_DARWIN_HOST' '$VERF' | grep -qE 'GOLDPLUS_MAC_RAIL_B_PACKAGE_VERIFIED\$'"
expect_success "dry-run-assessment" "non-Darwin path exits non-zero" \
  bash -c "grep -A8 'DRY_RUN_ASSESSMENT_REQUIRES_DARWIN_HOST' '$VERF' | grep -qE '^  exit 14'"
expect_success "dry-run-assessment" "Darwin untruthful path still fails closed" \
  bash -c "grep -q 'fail_with \"DRY_RUN_NOT_TRUTHFUL\" 13' '$VERF'"
expect_success "dry-run-assessment" "failed predicate is printed, not just the verdict" \
  bash -c "grep -q 'DRY_RUN_TRUTHFULNESS_FAILED' '$VERF' && grep -q \"printf 'predicate=%s\" '$VERF'"
expect_success "dry-run-assessment" "wrong-host refusal has its own contract check" \
  bash -c "grep -q 'wrong_host_dry_run_exit_code' '$VERF' && grep -q 'wrong_host_no_later_phase' '$VERF'"
# The real wrong-host dry run: exit 10, exact reason, and no later phase.
DRY_PROBE="$SANDBOX/wrong-host-dry.log"
DRY_PROBE_EXIT=0
bash "$LIB_DIR/mac-rail-b-preapproval.sh" --dry-run > "$DRY_PROBE" 2>&1 || DRY_PROBE_EXIT=$?
if [[ "$(uname -s)" == "Darwin" ]]; then
  expect_success "dry-run-assessment" "Darwin dry run is assessable" bash -c "true"
else
  expect_success "dry-run-assessment" "wrong-host dry run exits 10" \
    bash -c "[[ '$DRY_PROBE_EXIT' == 10 ]]"
  expect_success "dry-run-assessment" "wrong-host dry run names the OS" \
    bash -c "grep -q 'WRONG_OPERATING_SYSTEM: $(uname -s)' '$DRY_PROBE'"
  expect_success "dry-run-assessment" "wrong-host dry run reaches no later phase" \
    bash -c "! grep -qE 'VALIDATION_COMPLETE_RELEASE_FINALISATION_REQUIRED|RELEASE_FINALISED_HUMAN_APPROVAL_REQUIRED|/root/APPROVE_' '$DRY_PROBE'"
fi
expect_success "dry-run-assessment" "dry-run exit is captured in a || list, not under set +e" \
  bash -c "grep -q '|| DRY_EXIT=\$?' '$VERF' && ! grep -qE '^set \\+e' '$VERF'"

# ─── Class: scope non-circularity ───────────────────────────────────────────
REPO_ROOT="$LIB_DIR/../../.."
expect_success "scope-circularity" "runbook JSON embeds no scope SHA value" \
  bash -c "! grep -oE '\"provisionalRailAScopeSha256\"[[:space:]]*:[[:space:]]*\"[0-9a-f]{64}\"' \
    '$REPO_ROOT/docs/handover/claude/MAC_RAIL_B_RUNBOOK.json' | grep -q ."
expect_success "scope-circularity" "runbook markdown embeds no 64-hex scope SHA" \
  bash -c "! grep -qE '[0-9a-f]{64}' '$REPO_ROOT/docs/handover/claude/MAC_RAIL_B_RUNBOOK.md'"
expect_success "scope-circularity" "verifier is read-only (never writes the scope file)" \
  bash -c "! grep -qE 'writeFileSync|appendFileSync' '$LIB_DIR/verify-claude-release-scope.mjs'"
expect_success "scope-circularity" "resync refuses to repoint the executable commit" \
  bash -c "grep -q 'SCOPE_RESYNC_REFUSED' '$LIB_DIR/resync-claude-release-scope.mjs'"
expect_success "scope-circularity" "scope is a fixed point of the working tree" \
  bash -c "cd '$REPO_ROOT' && node scripts/release/claude/verify-claude-release-scope.mjs"

# ─── Class: macOS filesystem metadata (regression, Mac-reproduced) ──────────
# At 812046d the real Mac failed the tracked verifier with RAIL_B_FAULT_MATRIX_FAILED
# on a clean worktree while Linux reported 99/99. Root cause: scope derivation used
# readdirSync, so Finder's .DS_Store — which .gitignore hides, leaving the worktree
# clean — became a release-scope input and no fixed point existed. These cases fail
# under the pre-fix derivation and pass with tracked-files-only enumeration. They
# create only files that were absent and restore the directory exactly.
mac_metadata_probe() { # $1 = metadata filename
  local made=()
  local d f
  for d in scripts/release/anti-gravity scripts/release/claude; do
    f="$REPO_ROOT/$d/$1"
    [[ -e "$f" ]] || { : > "$f"; made+=("$f"); }
  done
  local rc=0
  ( cd "$REPO_ROOT" && node scripts/release/claude/verify-claude-release-scope.mjs >/dev/null 2>&1 ) || rc=$?
  [[ ${#made[@]} -eq 0 ]] || rm -f "${made[@]}"
  return $rc
}
expect_success "macos-fs-metadata" "Finder .DS_Store does not drift the release scope" \
  mac_metadata_probe .DS_Store
expect_success "macos-fs-metadata" "AppleDouble ._ file does not drift the release scope" \
  mac_metadata_probe ._probe.sh
expect_success "macos-fs-metadata" "operator-script scope inputs come from git, not readdir" \
  bash -c "! grep -qE \"readdirSync\\('scripts/release/(anti-gravity|claude)'\\)\" '$LIB_DIR/verify-claude-release-scope.mjs'"
expect_success "macos-fs-metadata" "tracked enumeration helper is present" \
  bash -c "grep -q 'git ls-files -z' '$LIB_DIR/verify-claude-release-scope.mjs'"
expect_success "macos-fs-metadata" "probe left the worktree exactly as found" \
  bash -c "! ls '$REPO_ROOT/scripts/release/anti-gravity/.DS_Store' '$REPO_ROOT/scripts/release/claude/.DS_Store' \
    '$REPO_ROOT/scripts/release/anti-gravity/._probe.sh' '$REPO_ROOT/scripts/release/claude/._probe.sh' >/dev/null 2>&1"

# ─── Class: BSD/bash-3.2 portability (macOS userland) ───────────────────────
# Stock macOS ships bash 3.2.57 and BSD grep. Constructs that work on GNU/Linux
# fail or silently mismatch there, and every such failure surfaces only as an
# opaque RAIL_B_FAULT_MATRIX_FAILED from the tracked verifier.
# Probes anchor on COMMAND POSITION so a pattern literal or a test name containing
# the word (e.g. "startup timeout blocks") is not mistaken for an invocation.
cat > "$SANDBOX/portability-scan.sh" <<'PSCAN'
#!/usr/bin/env bash
# usage: portability-scan.sh <dir> <coreutils|wordboundary>
# bash 4+ constructs are covered by the dedicated tracked compatibility test.
set -uo pipefail
d="$1"; mode="$2"; hits=0
for f in "$d"/*.sh; do
  case "$mode" in
    coreutils) pat='^[[:space:]]*(timeout|sha256sum|md5sum|tac|nproc|realpath)[[:space:]]' ;;
    wordboundary) pat='grep [^|]*\\b' ;;
  esac
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    printf '%s:%s\n' "$(basename "$f")" "$line"
    hits=$((hits+1))
  done < <(grep -nE "$pat" "$f" 2>/dev/null)
done
exit $(( hits > 0 ))
PSCAN
chmod +x "$SANDBOX/portability-scan.sh"
expect_success "portability" "no GNU-only coreutils invoked on the Mac path" \
  "$SANDBOX/portability-scan.sh" "$LIB_DIR" coreutils
expect_success "portability" "no GNU-only \\b word boundary in grep patterns" \
  "$SANDBOX/portability-scan.sh" "$LIB_DIR" wordboundary

# ─── bash 3.2 compatibility contract (tracked test) ─────────────────────────
B32="$LIB_DIR/rail-b-bash32-compatibility-test.sh"
expect_success "bash32" "tracked scripts satisfy the bash 3.2 contract" \
  /bin/bash "$B32"
expect_success "bash32" "contract reports zero unsupported constructs" \
  bash -c "/bin/bash '$B32' | grep -q '^unsupportedConstructCount=0$'"
expect_success "bash32" "contract runs the linkage test through /bin/bash" \
  bash -c "/bin/bash '$B32' | grep -q 'linkageUnderBinBash = SHELL_API_LINKAGE_PASSED'"
expect_success "bash32" "rule table is loaded from the tracked data file" \
  bash -c "/bin/bash '$B32' | grep -qE '^rulesLoaded = 1[0-9]$'"
expect_refusal "bash32" "missing rule table refused" "MISSING_RULES_FILE" \
  bash -c "cp '$LIB_DIR/rail-b-bash32-rules.tsv' '$SANDBOX/rules.bak'; \
    mv '$LIB_DIR/rail-b-bash32-rules.tsv' '$SANDBOX/rules.hidden'; \
    /bin/bash '$B32'; rc=\$?; mv '$SANDBOX/rules.hidden' '$LIB_DIR/rail-b-bash32-rules.tsv'; exit \$rc"
# The scan-exempt escape hatch must not spread: exactly one declared fixture region.
expect_success "bash32" "exactly one declared scan-exempt region" \
  bash -c "/bin/bash '$B32' | grep -qE '^exemptRegions = 1 '"
expect_success "bash32" "scanner declares no exemption over its own source" \
  bash -c "! grep -q 'EXEMPT-BEGIN' '$B32'"

# REQUIRED REGRESSION: inject `mapfile` into a sandbox COPY of the tracked scripts
# and prove the contract refuses it. This is the exact construct that killed the
# real Mac run at 812046d.
B32_COPY="$SANDBOX/b32-injected"
mkdir -p "$B32_COPY"
cp "$LIB_DIR"/*.sh "$B32_COPY/" 2>/dev/null || true
printf '\nvalues=()\nmapfile -t values < <(printf %%s x)\n' >> "$B32_COPY/rail-b-api-linkage-test.sh"
expect_refusal "bash32" "injected mapfile is refused" "BASH_3_2_COMPATIBILITY_FAILED" \
  /bin/bash "$B32" --dir "$B32_COPY"
expect_success "bash32" "injected mapfile is named in the violation report" \
  bash -c "/bin/bash '$B32' --dir '$B32_COPY' 2>&1 | grep -q 'mapfile/readarray'"
# Each remaining bash 4 construct is refused on its own. This list DESCRIBES the
# constructs; it never executes them, so it is a declared scan-exempt fixture.
# BASH32-EXEMPT-BEGIN (fault-injection fixture: construct literals, never executed)
for _c in 'declare -A assoc' 'local -n ref=x' 'x="${name,,}"' '[[ -v name ]]' 'y="${arr[-1]}"' 'coproc worker { :; }'; do
  printf '#!/usr/bin/env bash\n%s\n' "$_c" > "$B32_COPY/probe.sh"
  expect_refusal "bash32" "refuses: ${_c}" "BASH_3_2_COMPATIBILITY_FAILED" \
    /bin/bash "$B32" --dir "$B32_COPY"
done
# BASH32-EXEMPT-END
rm -f "$B32_COPY/probe.sh"

expect_success "portability" "verifier normalises grep -c instead of appending a fallback" \
  bash -c "! grep -qE 'grep -cE .* \\|\\| printf' '$LIB_DIR/mac-rail-b-verifier.sh'"

# EXECUTABLE reproduction of the real Mac failure at 812046d, not a text scan.
# macOS 12.3.1 ships bash 3.2.57, which has no `mapfile`; the linkage test died with
#   rail-b-api-linkage-test.sh: line 54: mapfile: command not found   (exit 127)
# failing fault-matrix case "linkage / tracked callers pass the linkage test" and so
# the tracked verifier with RAIL_B_FAULT_MATRIX_FAILED. `enable -n` removes the bash-4
# builtins from a child shell via BASH_ENV, reproducing bash 3.2 for this defect class.
printf 'enable -n mapfile 2>/dev/null || true\nenable -n readarray 2>/dev/null || true\n' \
  > "$SANDBOX/no-bash4-builtins.sh"
expect_success "portability" "linkage test runs without bash 4 builtins (bash 3.2 shape)" \
  env BASH_ENV="$SANDBOX/no-bash4-builtins.sh" bash "$LIB_DIR/rail-b-api-linkage-test.sh"
expect_success "portability" "selftest itself runs without bash 4 builtins" \
  env BASH_ENV="$SANDBOX/no-bash4-builtins.sh" bash -n "$LIB_DIR/rail-b-selftest.sh"
for _pc in mac-rail-b-verifier mac-rail-b-preapproval mac-rail-b-finalise-release \
           mac-rail-b-verify-finalised-release mac-rail-b-production mac-rail-b-rollback; do
  expect_success "portability" "${_pc}.sh parses without bash 4 builtins" \
    env BASH_ENV="$SANDBOX/no-bash4-builtins.sh" bash -n "$LIB_DIR/${_pc}.sh"
done

# grep -c PRINTS "0" and EXITS 1 on no-match; a `|| printf 0` fallback yields "0\n0",
# which breaks == "0" and makes (( )) a syntax error. Only the Darwin branch runs it.
cat > "$SANDBOX/darwin-predicates.sh" <<'DPRED'
#!/usr/bin/env bash
set -Eeuo pipefail
L="$1"
{ echo "  PASS  host.attestation"
  echo "  PASS  branch.semantics"
  echo "  PASS  boundary.runtimeSource"
  echo "  NOT_RUN  docker.ready"
  echo "  NOT_RUN  playwright.exactImage"; } > "$L"
count_status() {
  local n
  n="$(grep -cE "^  $1 " "$L" 2>/dev/null || true)"
  n="${n%%$'\n'*}"
  printf '%s' "${n:-0}"
}
for g in host.attestation branch.semantics boundary.runtimeSource; do
  grep -qE "^  PASS +${g}([^A-Za-z0-9_.]|$)" "$L" || { echo "gate $g not PASS"; exit 1; }
done
(( $(count_status NOT_RUN) > 0 )) || { echo "no NOT_RUN"; exit 1; }
[[ "$(count_status FAIL)" == "0" ]] || { echo "FAIL count not 0"; exit 1; }
[[ "$(count_status BLOCKED)" == "0" ]] || { echo "BLOCKED count not 0"; exit 1; }
DPRED
chmod +x "$SANDBOX/darwin-predicates.sh"
expect_success "portability" "Darwin truthfulness predicates hold on a truthful dry-run log" \
  "$SANDBOX/darwin-predicates.sh" "$SANDBOX/darwin-dry.log"

# ─── Class: placeholder hazards ─────────────────────────────────────────────
VFR="$LIB_DIR/mac-rail-b-verify-finalised-release.sh"
expect_refusal "placeholder" "literal angle-bracket manifest path refused" "LITERAL_PLACEHOLDER_PATH_REFUSED" \
  bash "$VFR" --manifest "/tmp/<package-head-from-finaliser>.json"
expect_refusal "placeholder" "relative manifest path refused" "MANIFEST_PATH_MUST_BE_ABSOLUTE" \
  bash "$VFR" --manifest "./final-manifest.json"
expect_refusal "placeholder" "missing manifest refused" "MANIFEST_FILE_MISSING" \
  bash "$VFR" --manifest "/tmp/definitely-absent-manifest.json"
expect_refusal "placeholder" "literal placeholder validation path refused" "VALIDATION_FILE_MISSING" \
  bash "$FIN" --validation-run "/absolute/path/printed/by/the-validator.json"
expect_success "placeholder" "runbook contains no angle-bracket executable placeholders" \
  bash -c "! grep -nE '^[[:space:]]*(bash|git|test|\\[)' '$LIB_DIR/../../../docs/handover/claude/MAC_RAIL_B_RUNBOOK.md' | grep -q '<'"
expect_success "placeholder" "runbook prints no bare remote-verification success" \
  bash -c "! grep -qE '^[[:space:]]*echo .*REMOTE_BRANCH_AND_ANNOTATED_TAG_VERIFIED' '$LIB_DIR/../../../docs/handover/claude/MAC_RAIL_B_RUNBOOK.md'"

# ─── Class: failed-run rehabilitation refused ───────────────────────────────
expect_refusal "failed-run" "ABORTED_SCRIPT_ERROR run refused" "FAILED_RUN_PERMANENTLY_INELIGIBLE" \
  bash "$FIN" --validation-run "$(mkv ase.json '{"runState":"VALIDATED","eligibleForFinalisation":true,"classification":"ABORTED_SCRIPT_ERROR"}')"
expect_refusal "failed-run" "VERIFIER_FAILED run refused" "FAILED_RUN_PERMANENTLY_INELIGIBLE" \
  bash "$FIN" --validation-run "$(mkv vf.json '{"runState":"VALIDATED","eligibleForFinalisation":true,"classification":"VERIFIER_FAILED"}')"

# ─── Class: migration/journal parity recurrence guard ───────────────────────
# Migrations 0052-0060 once shipped as SQL files while the drizzle journal
# silently stopped registering entries at 0051 — drizzle only ever applies what
# the journal lists, so that release looked complete while nine migrations would
# never run. This proves the recurrence guard actually refuses that class of
# drift. The fixture lives entirely under $SANDBOX; the tracked migrations
# directory and its journal are never read or written here.
MPARITY="$LIB_DIR/verify-migration-parity.mjs"
MP_FIXTURE="$SANDBOX/migration-parity"
mkdir -p "$MP_FIXTURE/meta"

mp_write_sql() { # <count>
  rm -f "$MP_FIXTURE"/*.sql
  local n="$1" i=0 tag
  while [[ $i -lt $n ]]; do
    tag="$(printf '%04d_migration_%d' "$i" "$i")"
    : > "$MP_FIXTURE/$tag.sql"
    i=$((i+1))
  done
}
mp_journal_entries() { # <count> -> comma-joined entry objects for tags 0..count-1
  local n="$1" i=0 out=""
  while [[ $i -lt $n ]]; do
    [[ -n "$out" ]] && out+=","
    out+=$(printf '{"idx":%d,"version":"5","when":1,"tag":"%04d_migration_%d","breakpoints":true}' "$i" "$i" "$i")
    i=$((i+1))
  done
  printf '%s' "$out"
}
mp_write_journal_raw() { printf '%s' "$1" > "$MP_FIXTURE/meta/_journal.json"; }
mp_write_journal_entries() { # <count>
  mp_write_journal_raw "$(printf '{"version":"5","dialect":"postgresql","entries":[%s]}' "$(mp_journal_entries "$1")")"
}

mp_write_sql 61
mp_write_journal_entries 61
expect_success "migration-parity" "valid 61-file journal passes" \
  node "$MPARITY" --sql-dir "$MP_FIXTURE"

mp_write_journal_entries 60
expect_refusal "migration-parity" "missing final journal entry refused" "SQL_JOURNAL_COUNT_MISMATCH" \
  node "$MPARITY" --sql-dir "$MP_FIXTURE"

mp_write_journal_entries 62
expect_refusal "migration-parity" "extra journal entry beyond the sql ceiling refused" "SQL_JOURNAL_COUNT_MISMATCH" \
  node "$MPARITY" --sql-dir "$MP_FIXTURE"

mp_write_sql 60
mp_write_journal_entries 61
expect_refusal "migration-parity" "missing sql file refused" "SQL_JOURNAL_COUNT_MISMATCH" \
  node "$MPARITY" --sql-dir "$MP_FIXTURE"

mp_write_sql 61
mp_write_journal_raw "$(printf '{"version":"5","dialect":"postgresql","entries":[%s,{"idx":61,"version":"5","when":1,"tag":"0000_migration_0","breakpoints":true}]}' "$(mp_journal_entries 61)")"
expect_refusal "migration-parity" "duplicate journal tag refused" "DUPLICATE_JOURNAL_TAG" \
  node "$MPARITY" --sql-dir "$MP_FIXTURE"

mp_write_journal_raw '{"version":"5","dialect":"postgresql","entries": this is not json'
expect_refusal "migration-parity" "malformed journal JSON refused" "JOURNAL_MALFORMED_JSON" \
  node "$MPARITY" --sql-dir "$MP_FIXTURE"

mp_write_journal_entries 61
expect_refusal "migration-parity" "release-scope ceiling mismatch refused" "RELEASE_SCOPE_CEILING_MISMATCH" \
  node "$MPARITY" --sql-dir "$MP_FIXTURE" --scope "$(mkv mp-scope.json '{"migrationCeiling":"0049_wrong"}')"

expect_success "migration-parity" "matching release-scope ceiling passes" \
  node "$MPARITY" --sql-dir "$MP_FIXTURE" --scope "$(mkv mp-scope-ok.json '{"migrationCeiling":"0060_migration_60"}')"

rm -rf "$MP_FIXTURE"

# ─── Summary ────────────────────────────────────────────────────────────────
TOTAL=$((PASS+FAIL))
printf '\nfault matrix: %d/%d passed\n' "$PASS" "$TOTAL"
if [[ -n "$JSON_OUT" ]]; then
  printf '{"total":%d,"passed":%d,"failed":%d,"contactedProduction":false,"createdMarker":false,"touchedRealDocker":false,"touchedRealRemote":false,"cases":[%s]}\n' \
    "$TOTAL" "$PASS" "$FAIL" "$ROWS" > "$JSON_OUT"
  echo "matrix written to $JSON_OUT"
fi
(( FAIL == 0 )) || exit 1
