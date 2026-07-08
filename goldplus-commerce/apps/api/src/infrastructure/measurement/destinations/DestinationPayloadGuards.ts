export class DestinationPayloadGuards {
  static hasRawPii(payload: any): boolean {
    const str = JSON.stringify(payload);
    if (!str) return false;

    // Very naive but safe guard: if it contains an @ and it's not a known safe domain or context, flag it.
    // To avoid false positives on legitimate string contents, we mostly look for the keys.
    const forbiddenKeys = [
      '"rawEmail":',
      '"customerEmail":',
      '"rawPhone":',
      '"customerPhone":',
      '"access_token":',
      '"refresh_token":',
      '"client_secret":',
      '"Authorization":'
    ];

    for (const key of forbiddenKeys) {
      if (str.includes(key)) {
        return true;
      }
    }

    // Rough check for unhashed email patterns in string values
    const emailRegex = /"[^"]*[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^"]*"/;
    if (emailRegex.test(str)) {
      return true;
    }

    return false;
  }
}
