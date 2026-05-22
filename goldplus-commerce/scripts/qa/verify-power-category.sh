#!/usr/bin/env bash
# verify-power-category.sh
# QA script to verify the live Power category products, PDPs, and images.

set -euo pipefail

TARGET_URL=${1:-"https://shopgoldplus.com"}
LOCAL_TMP_HTML="/tmp/goldplus-power-verify-$$.html"

echo "=================================================="
echo "GoldPlus Power Category Production Verification"
echo "Target Base: ${TARGET_URL}"
echo "=================================================="

# Cleanup handler
cleanup() {
  rm -f "${LOCAL_TMP_HTML}"
}
trap cleanup EXIT

# 1. Fetch category page
echo -n "Fetching Power category page... "
HTTP_CODE=$(curl -L -s -o "${LOCAL_TMP_HTML}" -w "%{http_code}" --max-time 20 "${TARGET_URL}/shop?category=power&verify=$(date +%s)")

if [ "${HTTP_CODE}" -ne 200 ]; then
  echo "FAIL (HTTP Status: ${HTTP_CODE})"
  exit 1
else
  echo "PASS"
fi

# 2. Check new products
echo "Checking new GoldPlus products:"
NEW_PRODUCTS=(
  "GoldPlus Built-In Cable Power Bank"
  "GoldPlus 100W Portable Power Station"
  "GoldPlus Digital Display Power Bank"
  "GoldPlus Magnetic Power Bank"
  "GoldPlus Power Bank with Handle"
  "GoldPlus Slim Power Bank"
)

ALL_NEW_PASS=true
for product in "${NEW_PRODUCTS[@]}"; do
  MATCHES=$(grep -o "${product}" "${LOCAL_TMP_HTML}" | wc -l || true)
  if [ "${MATCHES}" -gt 0 ]; then
    echo "  - [PASS] ${product} (${MATCHES} occurrences)"
  else
    echo "  - [FAIL] ${product} not found"
    ALL_NEW_PASS=false
  fi
done

# 3. Check old products (Negative tests)
echo "Checking for stale/generic products (should be 0 matches):"
STALE_PATTERNS=(
  "Generic Fast Charger"
  "Reinforced USB-C Cable"
  "Heavy Duty Power Bank"
  "generic-fast-charger"
  "reinforced-usb-c-cable"
  "heavy-duty-power-bank"
  "PWR-CHG-001"
  "PWR-CBL-002"
  "PWR-PBK-003"
  "68001def-f81c-46e3-903e-c3b51e34e8b1"
  "9a7f612b-68e9-47d5-b9ea-442bc7690a02"
  "bc1901fa-cfde-49ad-9ccf-818724bbdc6d"
  "images.unsplash.com/photo-1600003263720-95b45a4035d5"
  "images.unsplash.com/photo-1612815154858-60aa4c59eaa6"
  "images.unsplash.com/photo-1609081219090-a6d81d3085bf"
)

ALL_STALE_PASS=true
for pattern in "${STALE_PATTERNS[@]}"; do
  MATCHES=$(grep -o "${pattern}" "${LOCAL_TMP_HTML}" | wc -l || true)
  if [ "${MATCHES}" -eq 0 ]; then
    echo "  - [PASS] ${pattern} (0 matches)"
  else
    echo "  - [FAIL] ${pattern} found (${MATCHES} matches)"
    ALL_STALE_PASS=false
  fi
done

# 4. Check PDP routes
echo "Checking PDP routes (should be 200):"
PDPS=(
  "goldplus-built-in-cable-power-bank-gp-pd-w3"
  "goldplus-100w-portable-power-station-gp-09"
  "goldplus-digital-display-power-bank-gp-p07"
  "goldplus-magnetic-power-bank-gp-03"
  "goldplus-power-bank-with-handle-gp-x03"
  "goldplus-slim-power-bank-gp-04"
)

ALL_PDP_PASS=true
for slug in "${PDPS[@]}"; do
  PDP_URL="${TARGET_URL}/products/${slug}"
  CODE=$(curl -L -s -o /dev/null -w "%{http_code}" --max-time 15 "${PDP_URL}")
  if [ "${CODE}" -eq 200 ]; then
    echo "  - [PASS] ${slug} (HTTP 200)"
  else
    echo "  - [FAIL] ${slug} (HTTP ${CODE})"
    ALL_PDP_PASS=false
  fi
done

# 5. Check Image routes
echo "Checking Image routes (should be 200 image/webp):"
IMAGES=(
  "goldplus-built-in-cable-power-bank-gp-pd-w3.webp"
  "goldplus-100w-portable-power-station-gp-09.webp"
  "goldplus-digital-display-power-bank-gp-p07.webp"
  "goldplus-magnetic-power-bank-gp-03.webp"
  "goldplus-power-bank-with-handle-gp-x03.webp"
  "goldplus-slim-power-bank-gp-04.webp"
)

ALL_IMG_PASS=true
for img in "${IMAGES[@]}"; do
  IMG_URL="${TARGET_URL}/products/${img}"
  IMG_STATUS=$(curl -L -s -o /dev/null -w "%{http_code} %{content_type}" --max-time 15 "${IMG_URL}")
  if [[ "${IMG_STATUS}" == *"200 image/webp"* ]]; then
    echo "  - [PASS] ${img} (${IMG_STATUS})"
  else
    echo "  - [FAIL] ${img} (${IMG_STATUS})"
    ALL_IMG_PASS=false
  fi
done

echo "=================================================="
if [ "${ALL_NEW_PASS}" = true ] && [ "${ALL_STALE_PASS}" = true ] && [ "${ALL_PDP_PASS}" = true ] && [ "${ALL_IMG_PASS}" = true ]; then
  echo "VERIFICATION RESULT: ALL CHECKS PASSED"
  exit 0
else
  echo "VERIFICATION RESULT: FAILURES DETECTED"
  exit 1
fi
