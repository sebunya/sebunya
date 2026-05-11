export function readCartSessionId(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)goldplus_cart_id=([^;]+)/);
  if (!match) return null;

  const value = decodeURIComponent(match[1]);
  // UUID sanity check: roughly length 36 and alphanumeric/hyphens
  if (value.length < 32 || value.length > 40 || !/^[a-zA-Z0-9-]+$/.test(value)) {
    return null;
  }
  return value;
}
