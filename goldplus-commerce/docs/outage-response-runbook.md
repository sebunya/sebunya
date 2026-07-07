# Outage Response and Incident Management Runbook

This runbook defines the operational procedures for triage, escalation, and post-mortem review during major service outages.

---

## 1. Incident Severity Classification

| Severity | Description | Criteria |
|---|---|---|
| **Sev-1 (Critical)** | Core payment or checkout system offline | Checkout endpoint returns >=10% failure rates in a 5-minute window |
| **Sev-2 (Major)** | Telemetry or search engine degraded | Outbound sGTM dispatch failures >50%, or search queries failing |
| **Sev-3 (Minor)** | Admin tools slow or isolated feature failure | Back-office or queue replays failing, no user-facing impact |

---

## 2. Immediate Triage Actions (Sev-1 / Sev-2)
When a critical pager alert fires:
1. **Assign Incident Commander (IC)**: The first engineer on-call becomes the IC and coordinates debugging.
2. **Collect Base Diagnostics**:
   - Check `/health/ready` and `/health/deep`.
   - Read cgroup memory pre-warnings (`goldplus_container_oom_pre_warning`).
   - Query DB connection pool status.
3. **Isolate Changes**: Check the deployment log to identify recent releases. If a release occurred within the last 30 minutes, prepare to execute the [Rollback Plan](file:///Users/robertsebunya/Documents/GitHub_Projects/GoldPlusFinal/goldplus-commerce/docs/rollback-plan.md).

---

## 3. Communication Procedures
- **Internal SRE Channel**: Open a dedicated Slack/Teams war room.
- **Status Page Updates**: For Sev-1 incidents, update the public Status Page within 15 minutes of detection.
- **Incident Log**: Maintain a live timeline of actions taken during mitigation.

---

## 4. Post-Incident Review (PIR)
Within 48 hours of resolving any Sev-1 or Sev-2 incident:
1. **Root Cause Analysis (RCA)**: Pinpoint the technical failure (e.g. database deadlock, memory leak).
2. **Action Items**: Create tracked tasks to prevent similar failures.
3. **PIR Document**: Publish a post-incident review report summarizing the timeline, impact, and remediation steps.
