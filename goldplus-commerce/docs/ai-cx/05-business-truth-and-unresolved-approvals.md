# 05 — Business truth and unresolved approvals

## Resolved on this base (no owner action)

- Shop address: one source (`businessInfo.ts`), Zainab Aziza Building, 4th floor, Burton Street,
  opposite Pioneer Mall (PR #43). The FAQ renders from it. The assistant quotes it through `store_info`.
- Delivery fee and ETA: never stated by the assistant; "shown at checkout before you pay".
- Warranty: the assistant says cover depends on the product and the team checks first; links the pages.

## Owner approvals needed

1. **Production activation**: setting `ANTHROPIC_API_KEY` on the host and rolling web (04 §gates).
2. **Workspace spend limit** in the Anthropic console (cannot be done from code; Default Workspace
   cannot carry one, so a dedicated workspace/key for GoldPlus production is advised).
3. **Retention statement** (updated 2026-10-13): since migration 0177 every Goldie conversation is kept for
   365 days (card numbers, PINs and OTPs redacted) for the team's follow-up; closed Care Desk tasks the same.
   The privacy policy (legal CMS) needs a line saying so. Before 0177: the ledger keeps per-turn token counts
   and a one-way visitor pseudonym. Anthropic's API data handling applies to the text sent. The
   privacy page should say an AI assistant is offered and what is sent (the question, prior turns
   of the same chat, and catalogue data). Wording is the owner's.
4. **Four-request entitlement**: implemented at 4 per 24 h as the brief sets; any change is policy.
5. **Luganda/Swahili**: the prompt lets the model reply in the customer's language; this is
   unreviewed and should be presented as best-effort, not supported, until reviewed locally.

## Known contradictions left as-is

- Category hub copy describes the block "between Wilson Road and Burton Street": descriptive,
  consistent with the address; left unchanged.
- The FAQ's short "we replace it or refund you" sentence versus the warranty page's "varies by
  product": the assistant follows the warranty page. The FAQ sentence is the owner's to reword.
