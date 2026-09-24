import { describe, it, expect, vi } from 'vitest';
import { UploadProductImagesUseCase, type RawFilePayload } from '../../apps/api/src/application/use-cases/products/UploadProductImagesUseCase';

const file = (name: string, type = 'image/jpeg'): RawFilePayload => ({ name, type, size: 1024, buffer: Buffer.from(name) });

function libraryStoring(ids: string[]) {
  let i = 0;
  return { upload: vi.fn(async () => [{ kind: 'STORED' as const, asset: { id: ids[i], url: `/uploads/assets/${ids[i++]}.webp` }, deduplicated: false }]) };
}

describe('UploadProductImagesUseCase — Focus 4: library + gallery, no second storage path', () => {
  it('stores through the media library and places the first file as the cover when asked', async () => {
    const library = libraryStoring(['a1', 'a2']);
    const gallery = {
      assignAsCover: vi.fn(async ({ assetId }: { assetId: string }) => ({ ok: true as const, map: [{ slot: 1 as const, assetId }] })),
      assignNextFree: vi.fn(async ({ assetId }: { assetId: string }) => ({ ok: true as const, map: [{ slot: 1 as const, assetId: 'a1' }, { slot: 2 as const, assetId }] })),
    };
    const uc = new UploadProductImagesUseCase(library, gallery);
    const result = await uc.execute({ productId: 'p1', files: [file('front.jpg'), file('back.jpg')], makeFirstPrimary: true, actorId: 'admin-1' });
    expect(library.upload).toHaveBeenCalledTimes(2);
    expect(gallery.assignAsCover).toHaveBeenCalledWith(expect.objectContaining({ productId: 'p1', assetId: 'a1', actorId: 'admin-1' }));
    expect(gallery.assignNextFree).toHaveBeenCalledWith(expect.objectContaining({ productId: 'p1', assetId: 'a2' }));
    expect(result.map((r) => r.outcome)).toEqual(['COVER', 'ASSIGNED']);
    expect(result[1].slot).toBe(2);
  });

  it('reports a full gallery and a duplicate instead of dropping files silently', async () => {
    const library = libraryStoring(['a5', 'a1']);
    const gallery = {
      assignAsCover: vi.fn(),
      assignNextFree: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, code: 'INVALID_SLOT', message: 'This gallery already holds four images (4/4).' })
        .mockResolvedValueOnce({ ok: false, code: 'DUPLICATE_ASSET', message: 'That image is already in this gallery.' }),
    };
    const uc = new UploadProductImagesUseCase(library, gallery);
    const result = await uc.execute({ productId: 'p1', files: [file('fifth.jpg'), file('again.jpg')], actorId: 'admin-1' });
    expect(result.map((r) => r.outcome)).toEqual(['GALLERY_FULL', 'ALREADY_IN_GALLERY']);
    expect(gallery.assignAsCover).not.toHaveBeenCalled();
  });

  it('surfaces a library rejection per file and keeps going', async () => {
    const library = { upload: vi.fn(async () => [{ kind: 'REJECTED' as const, filename: 'x.png', reason: 'TOO_LARGE' }]) };
    const gallery = { assignAsCover: vi.fn(), assignNextFree: vi.fn() };
    const uc = new UploadProductImagesUseCase(library, gallery);
    const result = await uc.execute({ productId: 'p2', files: [file('x.png', 'image/png')], actorId: 'admin-1' });
    expect(result[0].outcome).toBe('REJECTED');
    expect(gallery.assignNextFree).not.toHaveBeenCalled();
  });

  it('refuses more than four files before touching storage', async () => {
    const library = { upload: vi.fn() };
    const gallery = { assignAsCover: vi.fn(), assignNextFree: vi.fn() };
    const uc = new UploadProductImagesUseCase(library, gallery);
    await expect(uc.execute({ productId: 'p3', files: [1, 2, 3, 4, 5].map((n) => file(`${n}.jpg`)), actorId: 'a' })).rejects.toThrow(/at most four/);
    expect(library.upload).not.toHaveBeenCalled();
  });

  // 2026-09-24: the type/size judgement is the media library's (content sniff,
  // 15 MB) — the old 5 MB / declared-MIME pre-check refused ordinary phone
  // photos with no reason. A bad file now comes back REJECTED with the reason.
  it('lets the media library judge a file by content and reports its reason per file', async () => {
    const library = { upload: vi.fn(async () => [{ kind: 'REJECTED' as const, filename: 'evil.exe', reason: 'UNSUPPORTED_TYPE' }]) };
    const gallery = { assignAsCover: vi.fn(), assignNextFree: vi.fn() };
    const uc = new UploadProductImagesUseCase(library, gallery);
    const big = { ...file('phone.jpg'), size: 7 * 1024 * 1024 };
    const result = await uc.execute({ productId: 'p3', files: [file('evil.exe', 'application/x-msdownload'), big], actorId: 'a' });
    expect(library.upload).toHaveBeenCalledTimes(2);
    expect(result.every((r) => r.outcome === 'REJECTED' && /Rejected:/.test(r.message ?? ''))).toBe(true);
    expect(gallery.assignNextFree).not.toHaveBeenCalled();
  });
});
