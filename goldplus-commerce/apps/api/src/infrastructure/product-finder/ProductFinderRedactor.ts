export class ProductFinderRedactor {
  private readonly FORBIDDEN_KEYS = new Set([
    "email",
    "phone",
    "customeremail",
    "customerphone",
    "password",
    "token",
    "authorization",
    "secret",
    "accesstoken",
  ]);

  public redact(payload: any): any {
    if (!payload) return payload;

    if (Array.isArray(payload)) {
      return payload.map((item) => this.redact(item));
    }

    if (typeof payload === "object") {
      const result: any = {};
      for (const [key, value] of Object.entries(payload)) {
        if (this.FORBIDDEN_KEYS.has(key.toLowerCase())) {
          result[key] = "[REDACTED_PII]";
        } else {
          result[key] = this.redact(value);
        }
      }
      return result;
    }

    return payload;
  }
}
