# Slice 11 — Support inbox operations (extending SupportTicket)

Date: 2026-07-15 · Branch: `phase-2-measurement-control-tower-completion`

- Domain (extended in place, no second ticket model): legal status transitions
  (`open ↔ in-progress → resolved → closed`, reopen allowed; nothing else),
  deterministic first-response SLA targets (urgent 4h / high 24h / medium 72h /
  low 168h), `ticketSlaState` never marks resolved/closed tickets overdue; ticket
  gains `assignedTo`/`updatedAt` (backward-compatible tail params).
- Schema: `support_issues.assigned_to`, `updated_at` (migration `0027`, additive).
- Port/Repo: `ISupportRepository` formalises `findById` and adds `update`
  (status/assignment patch); Drizzle impl hydrates the new fields.
- Use cases: `GetSupportInboxUseCase` (SLA-annotated, overdue first),
  `UpdateSupportTicketUseCase` (transition validation, bounded assignee,
  empty-patch rejection).
- Routes: existing `GET /governance/admin/support` now returns the annotated inbox
  (additive fields); new `PATCH /governance/admin/support/:id` behind
  `orders.manage`, audited `SUPPORT_TICKET_UPDATED` — the audit log is the ticket
  timeline.
- Web: admin support inbox gains SLA badges (Overdue / Nh left), assignee column,
  and per-row status/assign actions with truthful outcome notices.
- Tests: `Slice11SupportInbox.test.ts` (5) — transition matrix incl. reopen,
  SLA math + closed-never-overdue, overdue-first sorting, illegal/unknown/empty
  patch rejection, legal transition + assignment/unassignment.

## WhatsApp / delivery readiness (not duplicated here)

Template rendering, delivery attempt audit, and DRY_RUN-safe routing already live
in the notifications module (`NotificationTemplateRenderer`, `NotificationRouter`,
`RecordNotificationAttemptUseCase`); all delivery flags default false. Customer
sends remain BLOCKED_EXTERNAL on operator approval — no send paths were added.
