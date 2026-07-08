export class GtmDiffService {
  computeDiff(plan: any, existingTags: any[]): any {
    const changes: any[] = [];
    const duplicates = new Set<string>();
    const seenNames = new Set<string>();

    for (const tag of existingTags) {
      if (seenNames.has(tag.name)) {
        duplicates.add(tag.name);
      }
      seenNames.add(tag.name);
    }

    for (const planTag of plan.tags) {
      if (seenNames.has(planTag.name)) {
        changes.push({ asset: planTag.name, action: 'update', validationNotes: 'Existing tag found' });
      } else {
        changes.push({ asset: planTag.name, action: 'create', validationNotes: 'New tag' });
      }
    }

    // Identify assets that are existing but not in the plan (noop/unmanaged)
    const planTagNames = new Set(plan.tags.map((t: any) => t.name));
    for (const tag of existingTags) {
      if (!planTagNames.has(tag.name)) {
        changes.push({ asset: tag.name, action: 'noop', validationNotes: 'Unmanaged tag' });
      }
    }

    return {
      changes,
      duplicateAssetNames: Array.from(duplicates),
      unsafePublishFound: false
    };
  }
}
