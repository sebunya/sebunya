# 04 — Deployment, operations, rollback

## Environment variable names (no values here)

| Name | Container | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | web | Unset = widget not rendered, endpoint 503. Production key only; never in the browser |
| `INTERNAL_API_KEY` | web + api | Already present; also authenticates `/internal/assistant/*` |
| `ASSISTANT_MODEL` | — | Removed. Model, effort and every limit live in `assistant_config` (admin page) |

## Migration

`0175_assistant_budget_ledger.sql`: two new tables (`assistant_model_calls`, `assistant_config`),
additive, no existing row touched. Apply with the usual `scripts/migrate-prod.sh <migrator-image>
assistant-0175 "select count(*) from information_schema.tables where table_name in
('assistant_model_calls','assistant_config')"` expecting 2 (see `docs/deploy` and the memory
notes for the migrator recipe), then `scripts/deploy-prod.sh <sha> api web`.

## Launch gates (disabled-by-default path)

1. Roll api + web with the migration. Without `ANTHROPIC_API_KEY` nothing changes for customers.
2. In `/admin/assistant`, confirm the policy row (defaults are shown; first save creates it) and
   set **Paid AI layer off** if a deterministic-only first week is wanted.
3. Set `ANTHROPIC_API_KEY` in `.env.production`, roll web. Ask the widget three deterministic
   questions (shop, delivery, a product) and one interpretive one; check `X-Assistant-Route`.
4. Watch the admin page's settled/reserved figures and the web/api logs for `[assistant]`.
5. Optional provider-side guard: a workspace spend limit in the Anthropic console (owner task).

## Alarms

Logged by the api at `warn` when a settlement crosses $2.50, $3.50, $4.25 and at `error` when
settled reaches the kill threshold. No external pager exists in this stack; the admin page is the
dashboard.

## Kill switches, fastest first

1. `/admin/assistant` → untick **Paid AI layer on** → save: no further paid calls, deterministic
   answers continue. Takes effect on the next question.
2. Untick **Assistant on**: endpoint answers 503, widget still rendered until the next web roll.
3. Remove `ANTHROPIC_API_KEY`, roll web: widget gone.

## Rollback

`scripts/deploy-prod.sh <previous-sha> api web` (the rollback tags the script keeps). The two
tables may stay; dropping them is in the migration's header comment. Nothing else depends on them.

## Reconciliation

Rows left `RESERVED` for 10 minutes become `UNKNOWN` at the next reservation and keep counting
at the reserved amount. Compare the month's settled total with the Anthropic console usage page
monthly; `UNKNOWN` rows are the ambiguous-billing bucket and should be few (client aborts
mid-stream). There is no automatic provider reconciliation.
