export class PaidSocialPayloadRedactor {
  redactPii(payload: any): any {
    const redacted = JSON.parse(JSON.stringify(payload));
    
    // Hard remove raw PII fields if they accidentally made it in
    delete redacted.email;
    delete redacted.phone;
    delete redacted.firstName;
    delete redacted.lastName;
    
    if (redacted.user) {
      delete redacted.user.email;
      delete redacted.user.phone;
      delete redacted.user.firstName;
      delete redacted.user.lastName;
    }
    
    return redacted;
  }
}
