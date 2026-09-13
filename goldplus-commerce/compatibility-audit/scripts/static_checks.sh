#!/usr/bin/env bash
# Syntax + safety invariants for the compatibility programme.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$HERE"; FAIL=0
ok() { echo "  ok   $1"; }; bad() { echo "  FAIL $1"; FAIL=1; }
for f in *.mjs helpers/*.mjs real-device/*.mjs; do node --check "$f" 2>/dev/null && ok "$f" || bad "$f"; done
for f in *.sh scripts/*.sh; do bash -n "$f" 2>/dev/null && ok "$f" || bad "$f"; done
for f in device-matrix.json network-matrix.json package.json; do python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$f" && ok "$f" || bad "$f"; done
[ -x node_modules/.bin/tsc ] && { node_modules/.bin/tsc --noEmit -p tsconfig.json 2>/dev/null && ok "typescript" || bad "typescript"; }
grep -rEn "submit\(\)|page\.click\([^)]*(Place order|Pay now)|\.press\('Enter'\)" journeys/*.spec.ts | grep -i "checkout" && bad "checkout must never be submitted" || ok "checkout is never submitted"
grep -rEn "wa\.me" journeys/*.spec.ts | grep -E "\.click\(|goto\(" && bad "WhatsApp links must never be opened" || ok "WhatsApp links never opened"
grep -rn "pesapal/start\|payments" journeys/*.spec.ts pwa/*.spec.ts network/*.spec.ts | grep -v "^.*//" && bad "payment endpoints must not be called" || ok "no payment endpoint calls"
# nothing here may be imported by the storefront
grep -rn "compatibility-audit" ../apps/web/src ../apps/web/package.json 2>/dev/null && bad "storefront references the audit package" || ok "storefront does not reference the audit package"
[ "$FAIL" = 0 ] && echo "STATIC CHECKS PASSED" || { echo "STATIC CHECKS FAILED"; exit 1; }
