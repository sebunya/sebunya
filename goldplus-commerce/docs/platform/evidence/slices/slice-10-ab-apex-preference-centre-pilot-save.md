# Slice 10-AB APEX Preference Centre pilot save

The API Preference Centre save path now requires the Ring 1 verified/allowlisted guard. It rejects Ring 2 public users, anonymous identities, checkout-only/support-only/legacy identities, missing correlation or idempotency keys, missing copy version, non-canonical fields and any provider/queue/campaign side effect. The web surface remains truthful and disabled when its existing gate is off.

No Ring 1 save was attempted because no safe allowlisted pilot identity exists. No broad public Preference Centre save was enabled.
