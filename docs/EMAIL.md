# Email — activation guide

METS's email features (auto-acks, queue-entry notifications, reply
threading via `T-…` subject tokens, reply-to-reopen) are fully built and
run against a mock transport by default: every send is recorded in the
`mail_outbound` table and browsable in the Email tab, and inbound mail is
simulated there too. This doc is how to put real wires on them.

## Outbound — live today, env-only activation

Set these in the root `.env` and restart the server:

```
MAIL_PROVIDER=smtp
SMTP_HOST=smtp.office365.com   # or the internal relay hostname
SMTP_PORT=587
SMTP_SECURE=false              # true only for implicit-TLS (port 465)
SMTP_USER=mets@masterelectronics.com   # leave empty for an unauthenticated relay
SMTP_PASS=<app password>
SMTP_FROM=mets@masterelectronics.com
```

Two supported setups:

1. **Internal relay / smart host** — most Exchange environments have one
   for printers and scanners. Leave `SMTP_USER` empty; ask the Exchange
   admin to allow the METS server's IP as a sender.
2. **M365 authenticated submission** — `smtp.office365.com:587` with a
   licensed account's credentials (app password under MFA; the account
   needs "Authenticated SMTP" enabled in Exchange admin). To send from a
   shared mailbox like `mets.test@`, grant that account **Send As** on it
   and set `SMTP_FROM` to the shared address — shared mailboxes have no
   credentials of their own.

> **Tested and ruled out (2026-07-15): M365 "direct send"** via the tenant
> MX endpoint (`masterelectronics-com.mail.protection.outlook.com:25`,
> no auth). Our tenant routes inbound mail through Proofpoint, and EOP
> rejects direct-send injection with `550 5.7.51 TenantInboundAttribution`
> when a partner connector owns the inbound path.
>
> **Also unavailable in our tenant: app passwords**, which rules out
> setup 2 (SMTP AUTH under MFA) without an admin exception. Remaining
> paths for us: an internal relay/smart host (setup 1 — ask Exchange
> admin what the printers relay through), or Graph `Mail.Send` on the
> same app registration the inbound plan needs.

Behavior with SMTP on: every send still lands in `mail_outbound` first
(the audit log), then delivers off the request path. Success stamps
`delivered_at`; failure stamps `delivery_error` — both visible as
✓ delivered / ✕ send failed badges in the Email tab. Dedupe keys work
identically in both modes, so switching providers never double-sends.
`GET /api/health` reports the active adapter.

What goes out: ticket acknowledgments, queue-entry notifications
(configured per queue in Admin → Routing), and ticket update mails —
everything the Email tab already showed in mock mode.

## Inbound — prepared, needs one app registration

Real inbound (a `helpdesk@masterelectronics.com` shared mailbox creating
and threading tickets) requires Microsoft Graph access, the same Entra
blocker as SSO:

1. Entra app registration (can share the SSO app) with **application**
   permission `Mail.ReadWrite`, admin-consented, ideally scoped to the
   helpdesk mailbox with an application access policy.
2. A poller (60s) reading unread messages: subject token `T-1000042` →
   append as comment + reopen if resolved (this logic already exists and
   is transport-agnostic in `services/mail/mockMail.ts`); no token → new
   ticket through the full intake pipeline, sender matched or provisioned
   by email address.
3. Until then, the Email tab simulator exercises the identical code path —
   that's what it's for.

## Not covered (deliberately)

- HTML email templates — sends are plain text; readable everywhere.
- Bounce handling — `delivery_error` captures SMTP-time failures only;
  async bounces land in the sending mailbox.
- DKIM/SPF — inherited from the relay/M365 tenant configuration.
