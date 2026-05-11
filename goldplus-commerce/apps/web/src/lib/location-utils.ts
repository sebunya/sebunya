export function formatLocationLabel(jsonStr: string | null | undefined): string {
  if (!jsonStr || !jsonStr.trim()) return '';
  try {
    const data = JSON.parse(jsonStr);
    if (data.district && data.parish) {
      return `${data.district} · ${data.subcounty} · ${data.parish} (Postcode: ${data.postcode || 'N/A'})`;
    }
    return jsonStr; // Return raw if it didn't match shape
  } catch (e) {
    return String(jsonStr); // Fallback to raw string
  }
}
