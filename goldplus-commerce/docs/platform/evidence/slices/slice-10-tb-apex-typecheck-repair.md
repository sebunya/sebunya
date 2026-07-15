# Slice 10-TB APEX typecheck repair

## Baseline

The clean continuation checkout was `/Users/robertsebunya/goldplus-clean-continuation/phase-2-measurement-control-tower-completion-20260715T122313Z`, on `phase-2-measurement-control-tower-completion` at `3690347b18d19641d6454dea16489af1d8fae378`. Local HEAD and the remote branch matched, with a clean index and worktree.

## Failure and root cause

The initial workspace typecheck reproduced six `TS2339` errors in `apps/web/src/lib/api.ts` and `apps/web/src/lib/session.ts`: `Property 'env' does not exist on type 'ImportMeta'`.

`apps/web/src/env.d.ts` referenced only the generated `.astro/types.d.ts` file. It did not reference the stable `astro/client` declarations and supplied no project-specific `ImportMetaEnv` contract. The web TypeScript project already included `src/**/*`, so no tsconfig change was necessary.

## Narrow repair

`apps/web/src/env.d.ts` now references `astro/client`, preserves the generated Astro type reference, and declares only the twelve application-specific keys found by source inventory:

- `CONSENT_PERSISTENCE_COMMANDS_ENABLED`
- `CONSENT_PREFERENCE_CENTRE_SAVE_ENABLED`
- `PUBLIC_API_BASE_URL`
- `PUBLIC_API_URL`
- `PUBLIC_GTM_ID`
- `PUBLIC_METRICS_URL`
- `PUBLIC_POSTHOG_HOST`
- `PUBLIC_POSTHOG_KEY`
- `PUBLIC_WHATSAPP_SUPPORT_LABEL`
- `PUBLIC_WHATSAPP_SUPPORT_NUMBER`
- `WHATSAPP_SUPPORT_LABEL`
- `WHATSAPP_SUPPORT_NUMBER`

Vite's built-in `PROD` key remains supplied by `astro/client`. No broad `any`, global strictness change, runtime code, or environment value was added. Workspace typecheck passed after the repair.
