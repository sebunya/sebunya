# User Management & Authentication

Customer signup, self-service password change, admin account controls, and
role-based access — all on the existing identity schema.

## Customer signup & password

- `POST /auth/register` — `{ email, password, phone? }`. Enforces the password
  policy (8+ chars, at least one letter and one digit; see
  `apps/api/src/domain/identity/PasswordPolicy.ts`), rejects duplicate emails
  (`409 EMAIL_TAKEN`), issues a 7-day session token, and enqueues a `USER_REGISTERED`
  outbox event that sends a branded **welcome email** via ZeptoMail.
- `POST /account/password` (Bearer session) — `{ currentPassword, newPassword }`.
  Verifies the current password, applies the policy, forbids reusing the current
  password, and writes a `PASSWORD_CHANGED` audit entry.

Login remains `POST /auth/login` (customer) and `POST /auth/admin/login` (admin,
requires assigned roles), unchanged.

## Admin user & role controls (audit-logged)

```
GET    /admin/users                       # list users with roles (auth.manage)
PATCH  /admin/users/:id/status            # { isActive } activate/deactivate (auth.manage)
POST   /admin/users/:id/roles             # { roleId } assign role (roles.manage)
DELETE /admin/users/:id/roles/:roleId     # remove role (roles.manage)
```

**Safety guards** (in the use cases, not just the routes):
- An admin cannot deactivate their **own** account (`SELF_LOCKOUT`).
- An admin cannot change their **own** roles (`SELF_CHANGE`) — prevents
  accidental self-privilege-escalation or lockout.
- Role assign/remove validate both the user and the role exist, and report
  `ALREADY_ASSIGNED` / `NOT_ASSIGNED` idempotently.

## Roles & permissions (RBAC)

Permissions live in `packages/shared/src/permissions/index.ts` and are enforced by
`requirePermissions([...])` on every admin route. This pass added `content.manage`
(CMS), `experiments.manage`, and `dashboard.read`. Admin login is denied for any
account with zero assigned roles.

## Activity & auditing

All sensitive actions (login, admin login denied, password change, social login,
role changes, activation changes, CMS edits) are written to `audit_logs` through
`CreateAuditLogUseCase`. First-party activity events (`activity_events`) additionally
capture behavioural signals per visitor/user (see `docs/first-party-data.md`).

## Privacy (GDPR/CCPA posture)

- Passwords are stored only as scrypt hashes; plaintext is never persisted or logged.
- Login is generic on failure — the API never reveals whether an email is registered.
- First-party tracking honours Do Not Track / Global Privacy Control and stores no
  third-party identifiers. Data-subject export/erasure endpoints are on the roadmap.

## Not yet implemented (roadmap)

Password reset / forgot-password email flow, email verification, two-factor
authentication, and user profile field editing (name/preferences). These are
called out in `docs/ROADMAP.md`.

## Testing

`tests/unit/UserManagement.test.ts` — password policy, registration (welcome-email
enqueue, duplicate + weak-password rejection, unconfigured signer), password change
(wrong/same/valid), and admin guards (self-lockout, self-role-change, role validation).
