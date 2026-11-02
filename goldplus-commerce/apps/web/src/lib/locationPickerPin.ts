/**
 * Does a pin still belong to the place being committed? A Google building (map_place) is kept: the customer names
 * its area next, by design. A phone fix or a pasted link that was offered a set of nearby areas belongs to those
 * areas only: when the customer ignores them and commits a different area, that pin is somewhere else (a laptop's
 * rough fix, an old link) and must not travel with the new area, or the quote and the rider go to the wrong spot.
 */
export function keepPinOnCommit(input: {
  pinSource: string | null | undefined;
  offeredAreaSlugs: string[] | null;
  chosenAreaSlug: string | null | undefined;
  chosenFromPin: boolean;
}): boolean {
  if (!input.pinSource) return false;
  if (input.pinSource === 'map_place') return true;
  if (input.chosenFromPin) return true;
  if (!input.offeredAreaSlugs || input.offeredAreaSlugs.length === 0) return true;
  return Boolean(input.chosenAreaSlug && input.offeredAreaSlugs.includes(input.chosenAreaSlug));
}
