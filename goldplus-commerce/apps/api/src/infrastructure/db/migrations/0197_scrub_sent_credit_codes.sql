-- 0197: remove gift card / store credit codes from outbox rows that were already handled.
--
-- The scrub in 0196's code read only jsonb OBJECTS, but the customer notifier stores payloads as jsonb STRINGS
-- (drizzle 0.29 + postgres-js), so a card SMS handled between the 0196 deploy and this fix kept its code in plain
-- text. Rows still pending keep theirs (the SMS has not gone yet) and are scrubbed by the outbox when handled.
-- Same result as DrizzleOutboxRepository.scrubbedPayload(); idempotent (a scrubbed row has no creditCode left).
UPDATE outbox_events
   SET payload = (CASE WHEN jsonb_typeof(payload) = 'string' THEN (payload #>> '{}')::jsonb ELSE payload END - 'creditCode')
                 || jsonb_build_object('message', 'Gift card / store credit code (removed once handled).', 'creditCodeRemoved', true)
 WHERE is_processed = true
   AND (CASE WHEN jsonb_typeof(payload) = 'string' AND left(payload #>> '{}', 1) = '{' THEN (payload #>> '{}')::jsonb
             WHEN jsonb_typeof(payload) = 'object' THEN payload END) ? 'creditCode';
