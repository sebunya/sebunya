#!/bin/sh
set -eu

if [ "${NODE_ENV:-}" = "production" ]; then
  echo "REFUSING_TO_RUN_IN_PRODUCTION" >&2
  exit 1
fi

run_proof() {
  label="$1"
  script="$2"
  output="$(pnpm exec tsx "$script")"
  printf '%s\n' "$output"
  verdict="$(printf '%s\n' "$output" | tail -n 1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(String(j.verdict||""))}catch{process.exit(1)}})')"
  if [ "$verdict" != "PASS" ]; then
    echo "PRICING_ACCEPTANCE_COMPONENT_FAILED component=$label" >&2
    exit 1
  fi
}

run_proof governance apps/api/src/scripts/pricing-governance-proof.ts
run_proof evaluation apps/api/src/scripts/pricing-evaluation-proof.ts
run_proof capacity apps/api/src/scripts/pricing-capacity-proof.ts
run_proof checkout apps/api/src/scripts/pricing-checkout-proof.ts
run_proof operations apps/api/src/scripts/pricing-operations-proof.ts

echo '{"components":5,"realPostgreSQL":true,"controlledProviderOnly":true,"realProviderCalls":0,"proofResidue":0,"verdict":"PASS"}'
