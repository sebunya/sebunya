export function formatLocationLabel(jsonStr: string | null | undefined): string {
  if (!jsonStr || !jsonStr.trim()) return '';
  try {
    const data = JSON.parse(jsonStr);
    // Manual shape ("Describe where…"): the customer's own directions are the location; keep them, with the district.
    const raw = typeof data?.rawAddressText === 'string' ? data.rawAddressText.trim() : '';
    if (raw) return data.district ? `${raw} (${data.district})` : raw;
    // Lean picker shape: { district, area?, displayLabel } — human-readable by design.
    if (data.district && (data.displayLabel || data.area || (!data.parish && !data.parishWard))) {
      return String(data.displayLabel || (data.area ? `${data.area}, ${data.district}` : data.district));
    }
    // Legacy gazetteer shapes.
    if (data.district && (data.parish || data.parishWard)) {
      return `${data.parish || data.parishWard}, ${data.district}`;
    }
    return jsonStr; // Return raw if it didn't match shape
  } catch (e) {
    return String(jsonStr); // Fallback to raw string
  }
}
