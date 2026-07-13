# Research: ITSM / Ticketing Landscape (ServiceNow replacement, ~1000 employees)

*Compiled 2026-07-13. Supports build-vs-buy analysis in `docs/DESIGN.md` §1.*

## 1. Open-source options

| Product | Stack | License | SLA mgmt | Email 2-way | KB | Approvals / Change | Reporting | RBAC | API |
|---|---|---|---|---|---|---|---|---|---|
| **Zammad** | Rails + PostgreSQL + Elasticsearch + Redis | AGPLv3 | Yes — first-response/update/solution SLAs w/ escalation | Yes (core strength; full threading) | Yes, built-in, multi-language | **No** ITIL change mgmt, no CMDB | Good (needs ES) | Granular roles/groups | Modern REST, best-documented of the OSS set |
| **FreeScout** | PHP/Laravel + MySQL | AGPLv3 | Paid module | Yes (shared-inbox model, excellent) | Paid module | No | Basic | Basic | REST (module) |
| **osTicket** | PHP + MySQL | GPLv2 | Basic (per dept/topic) | Yes (piping/IMAP) | Basic FAQ | No | Basic | Dept/role | Limited (create-focused) |
| **Znuny (OTRS fork)** | Perl + MySQL/PG | GPLv3 | Mature, calendar-aware | Yes | FAQ module | **Yes** — full ITSM ChangeManagement (lifecycle, work orders, CAB) + CMDB ([github.com/znuny/ITSMChangeManagement](https://github.com/znuny/ITSMChangeManagement)) | Dated stats module | Fine-grained | REST/SOAP (clunky, complete) |
| **GLPI 10** | PHP + MySQL/MariaDB | GPLv3 | Yes | Mail collectors | Yes | **Yes** — ITIL incident/problem/change, approvals, native CMDB + inventory ([glpi-project.org](https://www.glpi-project.org/en/cmdb-software/)) | Weak | Profiles/entities (complex) | REST |
| **Frappe Helpdesk** | Python/Frappe + Vue + MariaDB | AGPLv3 | Customizable SLAs | Yes | Yes | Framework scripting only; no ITIL change/CMDB | Moderate | Frappe roles | Strong auto-REST; very active (v1.27.0, Jul 2026) |
| **Peppermint** | Next.js + Prisma + PG | AGPLv3 | **No** | IMAP/SMTP | No | No | Minimal | Basic + OIDC | Thin; homelab-grade (v0.5.5) |
| **Request Tracker 6** | Perl + MySQL/PG | GPLv2 | Yes | Email-native since 1996 | Weak | **Yes** — approvals + lifecycles; RT 6.0 modernized UI ([docs.bestpractical.com](https://docs.bestpractical.com/release-notes/rt/6.0.0)) | Dashboards | Fine-grained, hard to learn | REST 2.0 |

Self-host notes:
- **Zammad**: 4–8 GB RAM (Elasticsearch); hosting+admin "hundreds of EUR/month" ([openmsp.ai](https://www.openmsp.ai/blog/zammad-review-for-msps)). Pure helpdesk — no asset/CMDB/change ([comparison](https://freescout-installation.com/blog/freescout-vs-zammad)).
- **FreeScout/osTicket**: 1–2 GB RAM, cheapest. FreeScout = à-la-carte modules (users report ~40 paid modules, one-time $4–15 each — [freescout.net/modules](https://freescout.net/modules/)). osTicket: dated UI, poor security track record — 2025 anonymous file-read → webshell CVE, patched 1.18.3 ([horizon3.ai CVE-2026-22200](https://horizon3.ai/attack-research/vulnerabilities/cve-2026-22200/)).
- **Znuny**: only OSS with real ITIL change + CMDB; Perl, small community, dated UX.
- **GLPI**: broadest free ITSM coverage; reviews cite dated UI, weak reporting, painful setup ([capterra](https://www.capterra.com/p/126254/GLPi/reviews/)).
- **Frappe Helpdesk**: most modern OSS codebase, best extensibility; young; advanced config needs Frappe expertise.
- **RT**: durable, approvals built-in, beginner-hostile admin ([research.com](https://research.com/software/reviews/request-tracker)).

## 2. Commercial mid-market pricing (30–100 agents, annual list)

| Product | Per-agent (annual billing) | ~30 agents/yr | ~100 agents/yr | Notes |
|---|---|---|---|---|
| **Freshservice** | Growth ~$19–29, Pro **$99**, Ent **$119**/mo ([freshworks](https://www.freshworks.com/freshservice/pricing/)) | Pro ~$36k | Pro ~$119k; Ent ~$143k | Freddy AI +$29/agent/mo; asset packs; add-ons can add 30–50% |
| **Jira Service Mgmt** | Std ~**$20**, Prem ~**$51**/mo, volume discounts ([atlassian](https://www.atlassian.com/collections/service/pricing)) | Std ~$7k; Prem ~$18.5k | Std ~$24k; Prem ~$62k | Marketplace apps + config effort hidden cost |
| **HaloITSM** | ~**$49–70**/mo all-inclusive (CMDB, change, reporting) ([usehalo](https://usehalo.com/haloitsm/pricing/)) | ~$18–25k | ~$59–84k | Reddit-favored "priced out of Freshservice/JSM" pick |
| **SysAid** | Help Desk ~$79, ITSM ~$108/mo, quote-only + onboarding fee ([sysaid](https://www.sysaid.com/pricing)) | ITSM ~$39k | ~$130k | Opaque pricing |
| **ManageEngine SDP** | Std $13, Pro $27, **Ent $67**/tech/mo ([desk365 guide](https://www.desk365.io/blog/manageengine-servicedesk-plus-pricing/)) | Ent ~$24k | Ent ~$80k | Cheapest full-ITIL commercial; dated UI |
| **Zendesk** | Suite Team $55, Pro $115/mo; Copilot +$50 ([zendesk](https://www.zendesk.com/pricing/)) | Pro ~$41k | Pro ~$138k | No real change mgmt or CMDB — weakest ITIL fit |
| **ServiceNow (baseline)** | ITSM Pro ~$100–140/fulfiller/mo; mid-market deals **$150k–400k/yr**; implementation 3–5× license; 3–7% annual escalators; 0.5–1.0 admin FTE per 500 users ([softwarepricingguide](https://softwarepricingguide.com/servicenow-pricing-2025-what-enterprise-itsm-and-platform-licenses-actually-cost-no-fluff/), [itsmtools](https://itsmtools.com/best/top-itsm-tools-according-to-reddit-in-2026/)) | — | — | Our ~$300k/yr is squarely typical |

**Savings math vs $300k/yr:** at ~50 agents, HaloITSM/ManageEngine Ent ≈ $30–40k (85–90% license savings); Freshservice Pro ≈ $60k; JSM Prem ≈ $31k. Even the priciest mid-market option at 100 agents (~$140k) is <50% of ServiceNow — and none need a dedicated platform-admin FTE.

## 3. ServiceNow differentiators to consciously match or drop

- **Single data model + workflow engine across departments** (IT/HR/facilities ESM fan-out) — nothing mid-market replicates it; drop or integrate.
- **CMDB as operational truth layer** — match simply (GLPI/Znuny/Halo/ME/Freshservice have CMDBs) or drop (Zammad/Zendesk/FreeScout/Frappe). SN licenses CMDB partly by CI count.
- **Multi-stage conditional approval chains** — all alternatives are flatter; "complex multi-stage approvals across departments = you'll feel the ceiling" ([flamingo.run](https://www.flamingo.run/blog/servicenow-alternatives)).
- **ITIL incident/request/problem/change separation** with distinct SLAs — matched by Freshservice/Halo/ME/JSM Prem/GLPI/Znuny; not by Zendesk/Zammad/FreeScout/osTicket.
- **SLA sophistication** (concurrent SLAs, calendars, OLAs) — response/resolution+calendars are table stakes; OLAs rarer (Halo/ME).
- **PaaS extensibility** — usually the thing to *drop*: it's the source of config sprawl and admin headcount.

## 4. Migration failure modes / lessons learned

- **Don't replicate every SN feature** — map actual usage first; copying old config recreates the complexity you're escaping ([Latenode thread, 600-person co.](https://community.latenode.com/t/anyone-migrated-from-servicenow-to-simpler-tools-need-advice-and-consultant-recommendations/35671)).
- **Undocumented integrations are the #1 landmine** — hidden API calls/business rules surface after cutover. Parallel-run ≥1 month; expect 5 months where you planned 3.
- **Identity/access workflows often ride on SN silently** — move IAM to Entra governance/Okta *before* the ITSM swap, not into the new tool.
- **Don't bulk-import all history** — pollutes the new platform and its AI; archive read-only, migrate open items + recent reference data ([itsm.tools](https://itsm.tools/itsm-tool-migration-strategy/), [InvGate](https://blog.invgate.com/help-desk-migration-mistakes)).
- **Phase the rollout** — start with incident + request fulfillment; big-bang is the most-cited failure ([Ivanti](https://www.ivanti.com/blog/move-new-it-service-management)).
- **Involve frontline analysts in design** — adoption + workflow-gap detection.
- **Custom workflows/integrations must be rebuilt, not imported** — ticket/user import is easy; everything else is greenfield.
- **Reddit consensus**: SN pays off only with dedicated ITSM staff; mid-size orgs get better value from Freshservice/InvGate/HaloITSM; opinionated tools beat platforms for lean IT teams ([itsmtools roundup](https://itsmtools.com/best/top-itsm-tools-according-to-reddit-in-2026/)).
