import { createHash } from 'node:crypto';

/**
 * `audit_logs.entity_id` is a UUID column, but not everything worth auditing has
 * a UUID: the taxonomy, the hero settings, the nav, business info and the
 * homepage are singletons the routes named 'global', 'config' or 'policy'.
 * Every one of those inserts failed — after the save had already happened — so
 * for as long as those routes existed the operator saw "unexpected error" on a
 * change that had gone through, and no audit row was ever written for it.
 *
 * A non-UUID reference is mapped to a STABLE UUID (v5-style, SHA-1 of a fixed
 * namespace + entity + reference), so the same singleton always audits under
 * the same id and `findByEntity('taxonomy_config', 'global')` finds its history.
 * A real UUID passes through untouched.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAMESPACE = 'goldplus-audit-entity:';

export function isUuid(value: string): boolean {
  return UUID_SHAPE.test(value);
}

export function auditEntityId(entity: string, reference: string): string {
  const ref = reference.trim();
  if (isUuid(ref)) return ref.toLowerCase();
  const h = createHash('sha1').update(`${NAMESPACE}${entity.trim().toLowerCase()}:${ref}`).digest('hex');
  // RFC 4122 layout: version nibble 5, variant bits 10xx.
  const variant = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
