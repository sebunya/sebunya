# Dependency audit exceptions

`pnpm audit --audit-level=high` runs in CI. Every advisory below is listed in
`package.json` → `pnpm.auditConfig.ignoreGhsas`, with the evidence that it does
not apply here. Re-check each one when its package is upgraded; remove the entry
the moment a fixed version is adopted. Reviewed 2026-10-07.

| Advisory | Package | Why it does not apply | Exit |
|---|---|---|---|
| GHSA-26w7-cxv4-gfx2 (critical) | astro < 7.2.8 | RCE through libheif when Astro **decodes** an untrusted AVIF. The site uses `passthroughImageService()` (astro.config.mjs): `/_image` returns the original bytes unchanged (verified: identical sha256), nothing is decoded. sharp is also forced to the patched 0.35.5 (pnpm override). | Astro 7: blocked by a parse failure of `pages/products/[slug].astro` in its new Rust compiler 0.5.1 (317 of 318 pages compile). Retry on the next compiler release. |
| GHSA-qh8j-hqjv-7m4x (high) | @astrojs/node <= 11.1.2 | A malformed Host port makes that one request fail. Tested on 10.1.4: `example.com:65536`, `example.com:8080:8080`, `[::1` each answer 500 and the process stays up; Cloudflare and Caddy reject such hosts before they reach the site. | Comes with Astro 7. |
| GHSA-gpj5-g38j-94v9 (high) | drizzle-orm < 0.45.2 | SQL injection only when attacker input reaches identifier APIs (`sql.identifier`, aliases). Every `sql.raw`/identifier in apps/api uses constants (security review 2026-10-07). | drizzle 0.29 → 0.45 is a large API migration of its own. |
| GHSA-ch52-4w7c-c8xp (high) | http-cache-semantics (via astro), no fix | Used by Astro's remote-image cache; no remote image patterns are configured and images pass through. | Upstream fix. |
| GHSA-vfj7-8cjw-p6xm (high) | braces (via tailwindcss → chokidar), no fix | Build-time file watching only; never runs in production or on user input. | Upstream fix. |

## Static analysis (semgrep) exceptions

| Rule | Where | Why | 
|---|---|---|
| raw-html-format (excluded in CI) | NotificationTemplateRenderer.ts email HTML | Every interpolated value goes through `escapeHtml` (headline, body, greeting name, CTA url/label, subject); the rule targets Express request data written raw into HTML. A `nosemgrep` comment cannot be used: the flagged lines are inside the email markup. |
| `.semgrepignore` | scripts/, apps/api/src/scripts/, performance-audit/, compatibility-audit/ | Operator and build tooling run by hand; never on the request path. |
| inline `nosemgrep` | 9 sites | Each comment names the rule and the reason (escaped regex input, fixed file names, a public HMAC derivation label, an internal container URL). |

Fixed rather than suppressed (2026-10-07): AES-GCM tag length pinned on all
three decrypts (credential vault, Google OAuth seal, TOTP); prototype keys
refused in nav setPath and the email template lookup; product image storage
confined to its base folder with cleaned file names; `console.error` format
strings no longer carry URL values; every GitHub Action pinned to a commit;
`no-new-privileges` on the development and sGTM compose services; pnpm
supply-chain guards (minimumReleaseAge, trustPolicy, blockExoticSubdeps).
