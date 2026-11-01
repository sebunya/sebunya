import { existsSync } from 'node:fs';

/**
 * Any ops script that stores media must run with the SAME storage the api and
 * the edge share (compose mounts the `media_uploads` volume at /data/media and
 * sets MEDIA_STORAGE_ROOT to it). A bare `docker run` of the ops image has
 * neither, so the use case "stores" the file into the container's own
 * filesystem, records the URL in the database, and the file vanishes with the
 * container: the row looks fine, the storefront shows a broken image. That is
 * exactly what happened to 20 product photos on 2026-09-01. Refuse to start
 * unless the volume is really there.
 *
 *   docker run … -e MEDIA_STORAGE_ROOT=/data/media \
 *     -v goldplus-commerce_media_uploads:/data/media …
 */
export function requireMediaVolume(): string {
  const root = String(process.env.MEDIA_STORAGE_ROOT ?? '').trim();
  if (!root) throw new Error('MEDIA_STORAGE_ROOT is unset: mount the media_uploads volume at /data/media and set MEDIA_STORAGE_ROOT=/data/media, or every upload is lost with this container.');
  if (!existsSync(root)) throw new Error(`MEDIA_STORAGE_ROOT=${root} does not exist inside this container: the media_uploads volume is not mounted.`);
  return root;
}
