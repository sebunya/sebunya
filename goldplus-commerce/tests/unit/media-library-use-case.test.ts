import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { MediaLibraryUseCase, MediaStoragePort } from '../../apps/api/src/application/use-cases/media/MediaLibraryUseCase';
import {
  IMediaLibraryRepository,
  IMediaVariantGenerator,
  MediaAssetRecord,
} from '../../apps/api/src/application/ports/IMediaLibrary';

/**
 * Wave 2B DAM invariants: identical bytes deduplicate to one asset; unsupported and
 * oversized files are refused per-file with a named reason; deletion refuses while
 * the usage graph still references the asset; assign-to-product records the usage.
 */

function makeRecord(partial: Partial<MediaAssetRecord>): MediaAssetRecord {
  return {
    id: partial.id ?? 'a-1',
    filename: partial.filename ?? 'f.png',
    mime: 'image/png',
    byteSize: partial.byteSize ?? 3,
    width: null,
    height: null,
    checksum: partial.checksum ?? 'c',
    storageKey: partial.storageKey ?? 'uploads/assets/aa/x/f.png',
    url: partial.url ?? '/uploads/assets/aa/x/f.png',
    altText: null,
    caption: null,
    rights: null,
    rightsExpiresAt: null,
    focalX: null,
    focalY: null,
    status: 'ACTIVE',
    createdBy: null,
    createdAt: new Date(0),
    usageCount: partial.usageCount ?? 0,
    variants: partial.variants ?? [],
  };
}

class FakeRepo implements IMediaLibraryRepository {
  assets = new Map<string, MediaAssetRecord>();
  usageRows: Array<{ assetId: string; entity: string; entityId: string; field: string }> = [];
  assigned: Array<{ productId: string; url: string }> = [];
  deleted: string[] = [];

  async findByChecksum(checksum: string) {
    return [...this.assets.values()].find((a) => a.checksum === checksum) ?? null;
  }
  async findById(id: string) {
    return this.assets.get(id) ?? null;
  }
  async create(input: Parameters<IMediaLibraryRepository['create']>[0]) {
    const rec = makeRecord({ id: `a-${this.assets.size + 1}`, checksum: input.checksum, filename: input.filename, url: input.url, storageKey: input.storageKey, byteSize: input.byteSize });
    this.assets.set(rec.id, rec);
    return rec;
  }
  async addVariants() {}
  async list() { return { items: [...this.assets.values()], total: this.assets.size }; }
  async updateMetadata(id: string) { return this.assets.get(id) ?? null; }
  async setStatus(id: string, status: 'ACTIVE' | 'ARCHIVED') {
    const a = this.assets.get(id); if (!a) return null; const next = { ...a, status }; this.assets.set(id, next); return next;
  }
  async usages(assetId: string) {
    return this.usageRows.filter((u) => u.assetId === assetId).map((u) => ({ entity: u.entity, entityId: u.entityId, field: u.field, createdAt: new Date(0) }));
  }
  async recordUsage(assetId: string, entity: string, entityId: string, field: string) {
    this.usageRows.push({ assetId, entity, entityId, field });
  }
  async removeUsage() {}
  async deleteRow(id: string) { this.deleted.push(id); this.assets.delete(id); }
  async productsMissingImages() { return []; }
  async assignPrimaryProductImage(productId: string, asset: MediaAssetRecord) {
    this.assigned.push({ productId, url: asset.url });
    return { productId, url: asset.url };
  }
}

const storage: MediaStoragePort = {
  async saveAsset(dir, name) {
    return { url: `/${dir}/${name}`, storageKey: `${dir}/${name}`, physicalPath: `/data/media/${dir}/${name}` };
  },
  async deleteByKey() {},
};

const noVariants: IMediaVariantGenerator = {
  async generate() { return { width: null, height: null, variants: [] }; },
};

// Real PNG magic bytes: the use case now types an upload by what the bytes are,
// not by the MIME the client declared.
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const png = (content: string) => ({ filename: 'photo.png', mime: 'image/png', buffer: Buffer.concat([PNG_HEADER, Buffer.from(content)]) });

describe('MediaLibraryUseCase', () => {
  it('stores a new file and deduplicates identical bytes to the same asset', async () => {
    const repo = new FakeRepo();
    const useCase = new MediaLibraryUseCase(repo, storage, noVariants);
    const first = await useCase.upload({ files: [png('same-bytes')], actorId: 'u1' });
    const second = await useCase.upload({ files: [png('same-bytes')], actorId: 'u1' });
    expect(first[0]).toMatchObject({ kind: 'STORED', deduplicated: false });
    expect(second[0]).toMatchObject({ kind: 'STORED', deduplicated: true });
    expect(repo.assets.size).toBe(1);
    const stored = [...repo.assets.values()][0];
    expect(stored.checksum).toBe(createHash('sha256').update(png('same-bytes').buffer).digest('hex'));
  });

  it('dedupe puts the file back when the record outlived its bytes', async () => {
    // A container that stored into its own filesystem leaves a row whose URL
    // 404s. The next upload of the same bytes must restore the file, not just
    // hand the dead URL back.
    const repo = new FakeRepo();
    const onDisk = new Set<string>();
    const writes: string[] = [];
    const healing: MediaStoragePort = {
      async saveAsset(dir, name) { writes.push(`${dir}/${name}`); onDisk.add(`${dir}/${name}`); return { url: `/${dir}/${name}`, storageKey: `${dir}/${name}`, physicalPath: `/data/media/${dir}/${name}` }; },
      async deleteByKey() {},
      async exists(key) { return onDisk.has(key); },
    };
    const useCase = new MediaLibraryUseCase(repo, healing, noVariants);
    const [first] = await useCase.upload({ files: [png('lost-bytes')], actorId: 'u1' });
    expect(first).toMatchObject({ kind: 'STORED', deduplicated: false });
    onDisk.clear(); // the container died with the file
    const [second] = await useCase.upload({ files: [png('lost-bytes')], actorId: 'u1' });
    expect(second).toMatchObject({ kind: 'STORED', deduplicated: true });
    expect(repo.assets.size).toBe(1);
    expect(writes.length).toBe(2);
    expect(onDisk.has(first.kind === 'STORED' ? first.asset.storageKey : '')).toBe(true);
    const [third] = await useCase.upload({ files: [png('lost-bytes')], actorId: 'u1' });
    expect(third).toMatchObject({ kind: 'STORED', deduplicated: true });
    expect(writes.length).toBe(2); // present on disk: nothing rewritten
  });

  it('refuses unsupported types and oversized files per-file, without failing the batch', async () => {
    const repo = new FakeRepo();
    const useCase = new MediaLibraryUseCase(repo, storage, noVariants);
    const outcomes = await useCase.upload({
      files: [
        { filename: 'doc.pdf', mime: 'application/pdf', buffer: Buffer.from('x') },
        { filename: 'big.png', mime: 'image/png', buffer: Buffer.concat([PNG_HEADER, Buffer.alloc(16 * 1024 * 1024)]) },
        png('fine'),
      ],
      actorId: null,
    });
    expect(outcomes[0]).toMatchObject({ kind: 'REJECTED', reason: 'UNSUPPORTED_TYPE' });
    expect(outcomes[1]).toMatchObject({ kind: 'REJECTED', reason: 'TOO_LARGE' });
    expect(outcomes[2]).toMatchObject({ kind: 'STORED' });
  });

  it('safeDelete refuses while usages exist and deletes when the graph is clear', async () => {
    const repo = new FakeRepo();
    const useCase = new MediaLibraryUseCase(repo, storage, noVariants);
    const [stored] = await useCase.upload({ files: [png('img')], actorId: null });
    const id = (stored as { asset: MediaAssetRecord }).asset.id;
    await repo.recordUsage(id, 'product', 'p-1', 'primary_image');
    expect(await useCase.safeDelete(id)).toEqual({ kind: 'IN_USE', usages: 1 });
    expect(repo.deleted).toEqual([]);
    repo.usageRows = [];
    expect(await useCase.safeDelete(id)).toEqual({ kind: 'DELETED' });
    expect(repo.deleted).toEqual([id]);
  });

  it('assignToProduct sets the primary image and records the usage edge', async () => {
    const repo = new FakeRepo();
    const useCase = new MediaLibraryUseCase(repo, storage, noVariants);
    const [stored] = await useCase.upload({ files: [png('img')], actorId: null });
    const asset = (stored as { asset: MediaAssetRecord }).asset;
    const outcome = await useCase.assignToProduct(asset.id, 'prod-9');
    expect(outcome).toEqual({ productId: 'prod-9', url: asset.url });
    expect(repo.assigned).toEqual([{ productId: 'prod-9', url: asset.url }]);
    expect(repo.usageRows).toEqual([{ assetId: asset.id, entity: 'product', entityId: 'prod-9', field: 'primary_image' }]);
  });
});
