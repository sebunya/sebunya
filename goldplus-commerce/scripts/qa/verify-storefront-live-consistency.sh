#!/usr/bin/env bash
# verify-storefront-live-consistency.sh
# QA script to verify storefront live consistency across search, homepage, power, sound, storage, car, and PC categories.

set -euo pipefail

TARGET_URL=${1:-"https://shopgoldplus.com"}
LOCAL_TMP_HTML="/tmp/goldplus-storefront-verify-$$.html"

echo "=================================================="
echo "GoldPlus Storefront Live Consistency Verification"
echo "Target Base: ${TARGET_URL}"
echo "=================================================="

cleanup() {
  rm -f "${LOCAL_TMP_HTML}"
}
trap cleanup EXIT

# Helper to verify HTTP status code
verify_http_200() {
  local url="$1"
  local description="$2"
  echo -n "Verifying ${description} returns 200... "
  local code
  code=$(curl -L -s -o /dev/null -w "%{http_code}" --max-time 15 "${url}")
  if [ "${code}" -eq 200 ]; then
    echo "PASS"
  else
    echo "FAIL (HTTP Status: ${code})"
    return 1
  fi
}

ALL_PASS=true

# 1. Verify index, shop, and categories return HTTP 200
verify_http_200 "${TARGET_URL}/" "Homepage" || ALL_PASS=false
verify_http_200 "${TARGET_URL}/shop" "All Shop Products" || ALL_PASS=false
verify_http_200 "${TARGET_URL}/shop?category=power" "Power Category" || ALL_PASS=false
verify_http_200 "${TARGET_URL}/shop?category=sound" "Sound Category" || ALL_PASS=false
verify_http_200 "${TARGET_URL}/shop?category=storage" "Storage Category" || ALL_PASS=false
verify_http_200 "${TARGET_URL}/shop?category=car" "Car Category" || ALL_PASS=false
verify_http_200 "${TARGET_URL}/shop?category=pc" "PC Category" || ALL_PASS=false

# 2. Check that Stale Product PDP Links are completely absent from categories and recommendations
# By checking the URL paths /products/stale-slug, we avoid substring false positives (e.g. "wireless-earbuds" matching "goldplus-wireless-earbuds-airpod")
STALE_PRODUCT_PATHS=(
  "/products/generic-fast-charger"
  "/products/wireless-earbuds"
  "/products/reinforced-usb-c-cable"
  "/products/heavy-duty-power-bank"
  "/products/bluetooth-rugged-speaker"
  "/products/car-dashboard-mount"
  "/products/usb-3-flash-drive-128gb"
  "/products/portable-audio-headset"
)

# Helper to check absence of stale product links in pages
check_absence_of_stale() {
  local category="$1"
  local url="${TARGET_URL}/shop?category=${category}&verify=$(date +%s)"
  echo "Checking absence of stale product links on /shop?category=${category}:"
  curl -L -s -o "${LOCAL_TMP_HTML}" --max-time 15 "${url}"
  for path in "${STALE_PRODUCT_PATHS[@]}"; do
    local matches
    matches=$(grep -F -o "${path}" "${LOCAL_TMP_HTML}" | wc -l || true)
    if [ "${matches}" -eq 0 ]; then
      echo "  - [PASS] Link to ${path} (0 matches)"
    else
      echo "  - [FAIL] Link to ${path} found (${matches} matches)"
      ALL_PASS=false
    fi
  done
}

check_absence_of_stale "storage"
check_absence_of_stale "car"
check_absence_of_stale "pc"
check_absence_of_stale "sound"
check_absence_of_stale "power"

# 3. Check search and category isolation state in the HTML (Header links & category filter links)
echo "Checking search & category isolation state in /shop?q=earbuds:"
curl -L -s -o "${LOCAL_TMP_HTML}" --max-time 15 "${TARGET_URL}/shop?q=earbuds"

# In the header, category segment links should NOT carry "?q=earbuds"
# E.g. href="/shop?category=storage" or href="/shop?category=car" should not have &q=earbuds or q=earbuds&
BAD_HEADER_LINKS=$(grep -E 'href="[^"]*category=[^"]*q=earbuds' "${LOCAL_TMP_HTML}" | wc -l || true)
if [ "${BAD_HEADER_LINKS}" -eq 0 ]; then
  echo "  - [PASS] Category navigation links do not carry search terms (0 bad links)"
else
  echo "  - [FAIL] Found category links containing search query parameter (${BAD_HEADER_LINKS} bad links)"
  ALL_PASS=false
fi

# 4. Check new canonical products exist on category pages
echo "Checking existence of canonical GoldPlus products on category pages:"
declare -A CATEGORY_EXPECTED=(
  ["storage"]="GoldPlus 32GB Memory Card|GoldPlus 16GB USB Flash Drive"
  ["car"]="GoldPlus Dual USB Car Charger"
  ["pc"]="GoldPlus USB Mouse|GoldPlus USB Sound Card"
  ["sound"]="GoldPlus Wireless Earbuds"
)

for cat in "${!CATEGORY_EXPECTED[@]}"; do
  url="${TARGET_URL}/shop?category=${cat}"
  curl -L -s -o "${LOCAL_TMP_HTML}" --max-time 15 "${url}"
  IFS="|" read -ra EXPECTED_LIST <<< "${CATEGORY_EXPECTED[$cat]}"
  for expected in "${EXPECTED_LIST[@]}"; do
    matches=$(grep -i -o "${expected}" "${LOCAL_TMP_HTML}" | wc -l || true)
    if [ "${matches}" -gt 0 ]; then
      echo "  - [PASS] Category: ${cat} -> Found ${expected} (${matches} occurrences)"
    else
      echo "  - [FAIL] Category: ${cat} -> ${expected} not found"
      ALL_PASS=false
    fi
  done
done

echo "=================================================="
if [ "${ALL_PASS}" = true ]; then
  echo "VERIFICATION RESULT: ALL STOREFRONT CONSISTENCY CHECKS PASSED"
  exit 0
else
  echo "VERIFICATION RESULT: FAILURES DETECTED"
  exit 1
fi
