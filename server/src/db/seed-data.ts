// Data pools and templates for the seed generator. Master Electronics is an
// electronic components distributor (Phoenix HQ + warehouse + branches), so
// the ticket flavor leans ERP/EDI/warehouse-tech/sales-ops.

export const FIRST_NAMES = [
  'James', 'Maria', 'Robert', 'Linda', 'Michael', 'Sofia', 'David', 'Karen',
  'Carlos', 'Susan', 'Kevin', 'Angela', 'Brian', 'Diana', 'Mark', 'Rachel',
  'Steven', 'Laura', 'Jason', 'Emily', 'Eric', 'Monica', 'Adam', 'Teresa',
  'Derek', 'Nicole', 'Tony', 'Brenda', 'Chad', 'Priya', 'Miguel', 'Hannah',
  'Victor', 'Grace', 'Sean', 'Olivia', 'Raj', 'Wendy', 'Pete', 'Christine',
];

export const LAST_NAMES = [
  'Nguyen', 'Garcia', 'Smith', 'Johnson', 'Patel', 'Williams', 'Chen', 'Lopez',
  'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Anderson', 'Torres', 'Thomas',
  'Moore', 'Jackson', 'Ramirez', 'Lee', 'Walker', 'Hall', 'Young', 'King',
  'Wright', 'Scott', 'Flores', 'Baker', 'Reyes', 'Cruz', 'Ortiz', 'Bennett',
  'Foster', 'Sanders', 'Price', 'Russell', 'Diaz', 'Hayes', 'Meyers', 'Vance',
];

export const DEPARTMENTS = [
  'Sales', 'Inside Sales', 'Warehouse', 'Accounting', 'Purchasing',
  'Marketing', 'Customer Service', 'Product Management', 'HR', 'Quality',
];

export const LOCATIONS = ['Phoenix HQ', 'the Phoenix warehouse', 'the Germantown warehouse', 'the Chicago branch', 'the Wisconsin warehouse', 'remote'];

// Company sites for user home locations (weights ≈ relative headcount;
// Phoenix is HQ). 'Remote' users have no site.
export const USER_LOCATIONS: { name: string; weight: number }[] = [
  { name: 'Phoenix, AZ', weight: 34 },
  { name: 'Santa Clara, CA', weight: 3 },
  { name: 'Santa Monica, CA', weight: 2 },
  { name: 'Eden Prairie, MN', weight: 3 },
  { name: 'Ronkonkoma, NY', weight: 3 },
  { name: 'Miami, FL', weight: 3 },
  { name: 'Tampa, FL', weight: 2 },
  { name: 'Redmond, WA', weight: 2 },
  { name: 'Germantown, WI', weight: 6 },
  { name: 'Toronto', weight: 3 },
  { name: 'Vancouver', weight: 2 },
  { name: 'Montreal', weight: 2 },
  { name: 'Mexico', weight: 3 },
  { name: 'Malaysia', weight: 2 },
  { name: 'Hong Kong', weight: 2 },
  { name: 'Philippines', weight: 3 },
  { name: 'Chicago', weight: 4 },
  { name: 'Jordan', weight: 2 },
  { name: 'Rockford, IL', weight: 2 },
  { name: 'Peoria, IL', weight: 2 },
  { name: 'Remote', weight: 10 },
];

/** 'Santa Clara, CA' → 'santa-clara-ca'; used for ticket location tags. */
export const locationSlug = (loc: string) =>
  loc.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const APPS = ['MERP', 'CRM', 'Power BI', 'Excel', 'Outlook', 'Zoom', 'Slack', 'TungstenPDF', 'Keeper', 'Concur', 'ADP'];
export const VENDORS = ['TTI', 'Arrow', 'Digi-Key', 'a key supplier', 'our freight carrier'];
export const DEVICES = ['Dell Latitude laptop', 'Lenovo ThinkPad', 'Dell desktop', 'second monitor', 'Dell docking station', 'Lenovo docking station', 'desk phone'];
export const PRINTERS = ['the Sales floor HP LaserJet', 'the Accounting Brother printer', 'the shipping label Zebra ZT411', 'the receiving-dock Zebra'];
export const REPORTS = ['open orders report', 'daily bookings dashboard', 'inventory aging report', 'commissions report', 'backlog by supplier report'];

// Consolidated from ~52 ServiceNow queues. Owning queue is single by design;
// site/region/function granularity lives in tags, not extra queues.
export const QUEUES = [
  { slug: 'it-support', name: 'IT Support', description: 'General helpdesk: hardware, software, email, printing, phones (SNOW: IT Service Desk, IT Department, IT Operations, IT Alerts)', policy: 'round_robin' },
  { slug: 'infra-network', name: 'Infrastructure & Network', description: 'Network, VPN, servers, sysadmin, DevOps, warehouse wireless and RF equipment (SNOW: IT Network, IT System Admin, IT Devops)', policy: 'load_based' },
  { slug: 'merp', name: 'MERP', description: 'MERP — the in-house ERP: order entry, inventory, pricing, EDI, patches (SNOW: MERP, EDI)', policy: 'manual' },
  { slug: 'apps-erp', name: 'Business Applications', description: 'CRM, quoting tools, SaaS administration, integrations (SNOW: IT Saas)', policy: 'manual' },
  { slug: 'security-access', name: 'Security & Access', description: 'Account access, permissions, MFA, security incidents (SNOW: IT Cyber Security)', policy: 'round_robin' },
  { slug: 'data-reporting', name: 'Data & Reporting', description: 'Reports, dashboards, data extracts, Power BI (SNOW: Data Team, Product Manager Data Analytics)', policy: 'manual' },
  { slug: 'product-pricing', name: 'Product & Pricing', description: 'Part data, pricing updates, product content and catalog (SNOW: Pricing, Product Data, Product Owners, Digital Product Owner, PMA)', policy: 'manual' },
  { slug: 'ai-enablement', name: 'AI & Enablement', description: 'AI tools, automation requests, enablement projects (SNOW: AI Acceleration, AI Enablement, Business Enablement Group)', policy: 'manual' },
  { slug: 'warehouse-ops', name: 'Warehouse Operations', description: 'Receiving, shipping, inventory, LTL, value-add at all sites — site is a tag (SNOW: Phoenix/Germantown/TO/WI warehouse queues, Value Add, Chicago ECCO)', policy: 'round_robin' },
  { slug: 'supply-chain', name: 'Supply Chain & Logistics', description: 'Carriers, freight, supplier logistics, export compliance (SNOW: Logistics, SCM, Export Compliance)', policy: 'manual' },
  { slug: 'dc-solutions', name: 'DC Solutions', description: 'DC Connect and DC Solutions orders and support (SNOW: DC Connect, DC Solutions, DC Solutions/Orders)', policy: 'manual' },
  { slug: 'sales-support', name: 'Sales Support', description: 'Quote help, order status, regional sales team requests — region is a tag (SNOW: Miami Sales Support, NY Sales, OB Support)', policy: 'round_robin' },
  { slug: 'amat', name: 'AMAT Program', description: 'Applied Materials key-account program (SNOW: Applied Materials, Sales AMAT Team, WI AMAT Team)', policy: 'manual' },
  { slug: 'finance', name: 'Finance & Accounting', description: 'Invoices, AP/AR, GL, expense questions (SNOW: Accounting)', policy: 'manual' },
  { slug: 'people-ops', name: 'People Operations', description: 'Payroll, UKG, recruiting, training (SNOW: Payroll Team, UKG Team, Recruiting, Training and Standardization)', policy: 'manual' },
  { slug: 'quality', name: 'Quality', description: 'Quality holds, inspections, certifications, RMA quality review (SNOW: Quality)', policy: 'manual' },
  { slug: 'facilities', name: 'Facilities', description: 'Badges, desks, HVAC, office moves, safety (SNOW: Facilities Group, Office Manager, Saftey and Security)', policy: 'manual' },
] as const;

// Descriptions double as AI-classifier prompt content later.
export const CATEGORIES: { name: string; queue: string; description: string }[] = [
  { name: 'Hardware', queue: 'it-support', description: 'Laptops, desktops, monitors, docks, peripherals — breakage, replacement, new equipment requests' },
  { name: 'Software', queue: 'it-support', description: 'Application installs, licenses, updates, errors in desktop software (Office, TungstenPDF, Keeper, NinjaOne agent, etc.)' },
  { name: 'Email & Collaboration', queue: 'it-support', description: 'Outlook/Microsoft 365 email, Zoom meetings and conference rooms, Slack, SharePoint, calendars, distribution lists' },
  { name: 'Printing & Labels', queue: 'it-support', description: 'Office printers and warehouse label printers (Zebra), print queues, toner' },
  { name: 'Phones & Mobile', queue: 'it-support', description: 'Desk phones, softphones, company mobile devices' },
  { name: 'Onboarding & Offboarding', queue: 'it-support', description: 'New hire setup, departures, equipment provisioning, account lifecycle' },
  { name: 'Network & VPN', queue: 'infra-network', description: 'Connectivity, Wi-Fi, VPN access and performance, site-to-site links' },
  { name: 'Warehouse Tech', queue: 'infra-network', description: 'RF scanners, warehouse wireless, label print stations, conveyor-adjacent systems' },
  { name: 'MERP', queue: 'merp', description: 'MERP, the in-house ERP: order entry, inventory, pricing, EDI transactions, user accounts, patches and performance' },
  { name: 'Business Apps', queue: 'apps-erp', description: 'CRM, quoting tools, and integrations between business systems (excluding MERP itself)' },
  { name: 'Access & Accounts', queue: 'security-access', description: 'Password resets, account lockouts, permission/share access requests, group membership' },
  { name: 'Security', queue: 'security-access', description: 'Phishing reports, suspicious activity, MFA problems, CrowdStrike alerts and quarantines, Keeper vault issues, security policy questions' },
  { name: 'Data & Reporting', queue: 'data-reporting', description: 'Report requests and fixes, dashboards, data extracts, Power BI access' },
  { name: 'Product & Pricing', queue: 'product-pricing', description: 'Part data corrections, pricing updates, product content, catalog and cross-reference issues' },
  { name: 'AI & Enablement', queue: 'ai-enablement', description: 'AI tool access and questions (ChatGPT, Claude), automation requests, process enablement projects' },
  { name: 'Warehouse Operations', queue: 'warehouse-ops', description: 'Operational warehouse work at any site: receiving discrepancies, shipping problems, inventory counts, LTL, value-add jobs (not warehouse IT equipment)' },
  { name: 'Supply Chain & Logistics', queue: 'supply-chain', description: 'Carrier and freight issues, supplier logistics, import/export compliance and documentation' },
  { name: 'DC Solutions', queue: 'dc-solutions', description: 'DC Connect and DC Solutions programs: orders, quotes, and support' },
  { name: 'Sales Support', queue: 'sales-support', description: 'Sales team requests: quote help, order status, customer document requests, samples' },
  { name: 'AMAT Program', queue: 'amat', description: 'Applied Materials key account: dedicated orders, forecasts, and program requests' },
  { name: 'Finance & Accounting', queue: 'finance', description: 'Invoices, AP/AR questions, GL coding, expense reports, credit memos' },
  { name: 'People Operations', queue: 'people-ops', description: 'Payroll and UKG issues, recruiting requests, onboarding paperwork, training' },
  { name: 'Quality', queue: 'quality', description: 'Quality holds, incoming inspection, certifications (RoHS/REACH), RMA quality disposition' },
  { name: 'Facilities', queue: 'facilities', description: 'Badge access, desk moves, office equipment, HVAC and building issues, workplace safety' },
];

export const TAGS = [
  'vpn', 'onboarding', 'printer', 'merp', 'edi', 'rf-scanner', 'crm',
  'phishing', 'new-hire', 'hardware-refresh', 'project-falcon', 'warehouse',
  'exec-visibility', 'recurring', 'alerts',
  // warehouse functions (location tags come from USER_LOCATIONS slugs)
  'receiving', 'shipping', 'inventory', 'ltl', 'value-add',
  // programs
  'amat', 'ukg', 'export',
];

// Manual skill vocabulary — the tools we actually run. Auto skills are
// derived from resolution history (category names) on top of these.
export const SKILLS = [
  'Windows', 'Networking', 'VPN', 'MERP', 'EDI', 'CRM', 'Power BI',
  'Microsoft 365', 'Zoom', 'Slack', 'Keeper', 'NinjaOne', 'CrowdStrike',
  'Dell Hardware', 'Lenovo Hardware', 'HP/Brother Printers', 'Zebra Printers',
  'RF Scanners', 'UPS/FedEx Shipping', 'AI Tools', 'Telephony', 'Security',
];

// Tag affinities: ops categories get site/region/function tags instead of
// random ones — this is how the per-site SNOW queues survive as filters.
export const CATEGORY_TAGS: Record<string, string[]> = {
  'Warehouse Operations': ['receiving', 'shipping', 'inventory', 'ltl', 'value-add'],
  'AMAT Program': ['amat'],
  'Supply Chain & Logistics': ['export'],
  'People Operations': ['ukg'],
  'Warehouse Tech': ['rf-scanner', 'warehouse'],
};

export type TicketTemplate = {
  s: string; // subject
  d: string; // description
  t: 'incident' | 'request' | 'change';
  pri?: number[]; // weights for P1..P4; default [5, 20, 55, 20]
  /**
   * Topical comment thread so seeded conversations match the subject:
   * agent first reply, optional internal note, requester reply, closing fix.
   * Missing pieces fall back to the generic pools below. Placeholder-free on
   * purpose — {app}/{printer} would fill differently than the subject did.
   */
  c?: { reply?: string; note?: string; ask?: string; fix?: string };
};

export const TEMPLATES: Record<string, TicketTemplate[]> = {
  Hardware: [
    { s: 'Laptop won\'t power on', d: 'My {device} won\'t turn on this morning. Power light blinks three times then nothing. I have a customer call at 2pm and everything is on this machine.', t: 'incident', pri: [10, 35, 45, 10],
      c: { reply: 'Three blinks usually means a power-circuit fault. I\'m bringing a loaner to your desk now so you make your 2pm — your files are all in OneDrive so they\'ll sync down.', note: 'Diagnostics confirm PSU rail failure — filing the warranty claim, replacement board ETA 3 days.', ask: 'Loaner works, and everything synced. Made the call — thank you!', fix: 'Warranty repair came back and your machine is reimaged and ready. Swapped it for the loaner at your desk — everything verified working.' } },
    { s: 'Replacement keyboard needed', d: 'Several keys on my keyboard are sticking (E, R, and space). Requesting a replacement. I sit at {loc}.', t: 'request',
      c: { reply: 'We have spares in the cage — I\'ll drop a new keyboard at your desk this afternoon.', ask: 'Swapped it in, all keys working great. Thanks!', fix: 'Replacement keyboard delivered and confirmed working. Old one is going to e-waste.' } },
    { s: 'Second monitor request', d: 'Requesting a {device} for my desk. Working split-screen in {app} all day and one screen is killing productivity.', t: 'request', pri: [0, 5, 45, 50],
      c: { reply: 'Manager approval is on the ticket, so you\'re good — we have monitors in stock and I\'ll bring one over with a cable tomorrow morning.', ask: 'Set it up — night and day difference. Appreciate it.', fix: 'Monitor delivered and connected through the dock. Enjoy the extra screen real estate.' } },
    { s: 'Docking station not detecting monitors', d: 'Since this morning my dock only drives one of my two monitors. Tried re-plugging everything. Working from {loc}.', t: 'incident',
      c: { reply: 'A firmware update on the docks rolled out last night and a handful hit this. Pushing the fixed firmware to yours now — give it ten minutes then power-cycle the dock.', note: 'Same dock firmware regression as the other reports this morning — vendor advisory DS-1142 applies.', ask: 'Power-cycled after the update and both monitors are back. Thanks for the quick fix.', fix: 'Dock firmware updated and both displays confirmed working. The bad firmware version is blocked from auto-installing again.' } },
    { s: 'Laptop running extremely slow', d: 'My laptop takes 10+ minutes to boot and {app} freezes constantly. Fan runs loud all day. Can someone take a look?', t: 'incident',
      c: { reply: 'Remoted in for a look — the disk is pegged at 100% and it\'s throwing SMART warnings. The drive is dying. I\'d like to swap you to an SSD replacement this week; your files are synced so nothing is at risk.', note: 'SMART shows reallocated-sector count climbing — drive replacement, not a tune-up.', ask: 'Whatever you did during the remote session already helped, but yes, let\'s do the swap.', fix: 'Drive replaced with an SSD and Windows reinstalled fresh. Boot is under a minute now — reply if anything didn\'t sync back.' } },
    { s: 'New laptop for contractor', d: 'We have a contractor starting Monday in {dept} who needs a loaner laptop with standard apps plus {app}.', t: 'request', pri: [0, 25, 60, 15],
      c: { reply: 'Loaner is being imaged today with the standard build plus the extra app. It\'ll be ready for pickup Friday so Monday is smooth.', ask: 'Perfect — I\'ll grab it Friday afternoon.', fix: 'Laptop handed off, contractor account verified working, return date logged for the end of the engagement.' } },
  ],
  Software: [
    { s: '{app} license needed', d: 'I need a license for {app} for my role in {dept}. Manager has approved — can you install it on my machine?', t: 'request',
      c: { reply: 'Approval noted — assigning you a seat from the license pool and pushing the install to your machine now. You\'ll see it appear within the hour.', ask: 'It showed up and I\'m signed in. Thanks!', fix: 'License assigned and install verified. It\'s tied to your account, so it follows you to any company machine.' } },
    { s: '{app} crashes on startup', d: '{app} closes immediately after launching, started after the last update. Rebooted twice, same behavior.', t: 'incident',
      c: { reply: 'That update has a corrupted-settings bug — remoting in to clear the app\'s local profile, which brings it back without losing your data.', note: 'Vendor KB confirms the updater corrupts the local profile cache; clearing %appdata% profile resolves.', ask: 'It launches again after your session. Appreciate the fast turnaround.', fix: 'Cleared the corrupted local profile and re-applied the update cleanly. Launching normally now — reply if it recurs.' } },
    { s: 'Adobe Acrobat can\'t combine PDFs', d: 'Getting an error when combining supplier datasheets into one PDF: "operation could not be completed." Worked last week.', t: 'incident',
      c: { reply: 'That error is Acrobat\'s cache choking on one of the source files. Remoting in to clear it and repair the install — five minutes.', ask: 'Combined the whole datasheet set just now with no error. Thank you!', fix: 'Repaired the Acrobat install and cleared its cache; combine works again. One of the vendor PDFs was also malformed — re-exported it for you.' } },
    { s: 'Excel add-in missing after update', d: 'Our pricing add-in disappeared from Excel after Windows updates last night. The whole {dept} team uses this daily.', t: 'incident', pri: [5, 40, 45, 10],
      c: { reply: 'Last night\'s update reset Excel\'s add-in registrations. Pushing a fix that re-registers it across the whole team — restart Excel in about 15 minutes.', note: 'Update disabled non-Microsoft COM add-ins by default; deployed a policy to re-enable ours.', ask: 'It\'s back for me and the two people next to me. Thanks for handling the whole team at once.', fix: 'Add-in re-registered for the whole department and pinned so future updates can\'t disable it. Verified with two of your teammates.' } },
    { s: 'Software update approval for {app}', d: 'Vendor released a critical patch for {app}. Requesting change approval to deploy to all {dept} machines this week.', t: 'change', pri: [5, 45, 45, 5],
      c: { reply: 'Change request logged. Testing the patch on two pilot machines today; if clean, we\'ll schedule the department-wide push for Thursday overnight.', note: 'Pilot machines patched — no regressions in the core workflows after an hour of smoke testing.', fix: 'Patch deployed to all department machines in the Thursday window. Every install verified; no issues reported since.' } },
    { s: 'Keeper vault not syncing', d: 'My Keeper vault shows different records on desktop vs the browser extension, and a shared folder from {dept} is missing entirely.', t: 'incident', pri: [5, 35, 50, 10],
      c: { reply: 'The extension is holding a stale login token — that\'s why it disagrees with desktop. Signing you out of both and back in restores the sync; the shared folder permission also needed a refresh, which I\'ve done.', ask: 'Both match now and the shared folder is back. Much appreciated.', fix: 'Vault sync restored on both clients and shared-folder membership re-applied. If the extension ever drifts again, sign fully out and back in first.' } },
    { s: 'TungstenPDF license expired', d: 'TungstenPDF is showing a license-expired banner and blocking saves. I mark up supplier drawings daily.', t: 'incident', pri: [0, 30, 55, 15],
      c: { reply: 'Our TungstenPDF renewal processed but the new key hadn\'t propagated to your machine. Pushing the updated license now — the banner should clear on next launch.', note: 'Renewal PO cleared last week; a handful of machines cached the old key. Sweeping for others proactively.', ask: 'Banner is gone and saves work again. Thanks!', fix: 'New license key applied and saving confirmed working. Swept the rest of the machines with the stale key while I was at it.' } },
    { s: 'NinjaOne agent offline on my laptop', d: 'IT mentioned my {device} shows offline in NinjaOne so I can\'t get remote support. It has internet otherwise.', t: 'incident', pri: [0, 15, 60, 25],
      c: { reply: 'The agent service is stopped on your machine. I\'ll reinstall it — you won\'t notice anything, and it puts you back on the map for remote support.', ask: 'Sounds good, go ahead whenever.', fix: 'NinjaOne agent reinstalled and reporting healthy. Remote support works for your machine again.' } },
  ],
  'Email & Collaboration': [
    { s: 'Not receiving external emails', d: 'Customers say emails to me bounce with "recipient inbox full" but my mailbox looks fine. Missing quotes from {vendor} because of this.', t: 'incident', pri: [10, 45, 40, 5],
      c: { reply: 'Your mailbox itself is fine — the "inbox full" bounce is coming from an old forwarding rule pointing at a retired archive mailbox that IS full. Removing the rule now.', note: 'Legacy forward to the old archive mailbox — that box hit quota, so external mail bounced while internal delivered.', ask: 'A customer just resent their quote and it landed. Thank you — that was costing us business.', fix: 'Stale forwarding rule removed and the senders from the bounce logs notified to resend. External mail is flowing normally again.' } },
    { s: 'Shared mailbox access request', d: 'I need access to the sales@ shared mailbox to cover for a teammate on leave. Manager approved.', t: 'request',
      c: { reply: 'Approval\'s on file — adding you to the shared mailbox now. It appears in Outlook automatically within about half an hour.', ask: 'It just showed up in my folder list. All set, thanks!', fix: 'Access granted with a reminder set to review it when your teammate is back from leave.' } },
    { s: 'Zoom meeting audio cutting out', d: 'In every Zoom call today my audio drops for a few seconds each minute. Wired connection at {loc}. Customers noticing.', t: 'incident',
      c: { reply: 'Your Zoom client is a few versions behind and that build has a known audio-dropout bug on wired connections. Updating it remotely now.', ask: 'Two calls since the update with zero drops. Thanks!', fix: 'Zoom updated to the current build and audio confirmed stable across several calls. Auto-update is re-enabled so it won\'t fall behind again.' } },
    { s: 'Slack notifications not coming through', d: 'I stopped getting Slack notifications on desktop since yesterday — missing time-sensitive messages from the warehouse channel.', t: 'incident', pri: [0, 25, 60, 15],
      c: { reply: 'Windows Focus Assist turned itself on with the last update and it\'s eating Slack\'s notifications. Turning it off and whitelisting Slack so it can\'t happen again.', ask: 'Notifications are popping again — just caught a warehouse ping in real time. Thanks!', fix: 'Focus Assist disabled and Slack whitelisted in notification settings. You\'ll get everything from the warehouse channel in real time again.' } },
    { s: 'Conference room Zoom controller frozen', d: 'The Zoom Rooms controller in the {loc} conference room is frozen on the wallpaper screen. Meeting with a supplier in an hour.', t: 'incident', pri: [5, 40, 45, 10],
      c: { reply: 'Rebooting the room system remotely now — the controller reconnects about three minutes after. You\'ll be fine for the supplier meeting; I\'ll swing by to confirm.', note: 'Room controller lost pairing after the overnight Zoom Rooms update — same as the other room last month.', ask: 'Room came back and the meeting went off without a hitch. Appreciate the quick save.', fix: 'Room system rebooted, controller re-paired, and a test call verified. Scheduled the room updates to a maintenance window so this stops happening before meetings.' } },
    { s: 'Distribution list update', d: 'Please add the three new {dept} hires to the {dept} distribution list and remove two people who left last month.', t: 'request', pri: [0, 5, 50, 45],
      c: { reply: 'Making the membership changes now — three additions, two removals. Takes effect immediately for new mail.', ask: 'Confirmed — the new folks got today\'s announcement. Thanks!', fix: 'Distribution list updated: new hires added, departed members removed. Membership now matches the current roster.' } },
    { s: 'Calendar delegation not working', d: 'I was set up as a delegate for my VP\'s calendar but can\'t see or create events. Permissions look right on my end.', t: 'incident',
      c: { reply: 'The delegation was granted on the old mailbox permissions model — re-applying it the correct way now. Outlook needs a restart after.', ask: 'Restarted Outlook and I can see and book on the calendar now. Thank you!', fix: 'Delegate permissions re-applied correctly and verified — you can view and create events on the VP\'s calendar.' } },
    { s: 'SharePoint site read-only for team', d: 'Our {dept} SharePoint site suddenly shows read-only for the whole team. We can\'t update the quote tracker.', t: 'incident', pri: [10, 40, 45, 5],
      c: { reply: 'The site hit its storage quota overnight, which flips it read-only. Bumping the quota now and cleaning the versioning bloat that ate the space.', note: 'A 4GB video uploaded to the site with 500 retained versions blew the quota — trimming version history and raising the cap.', ask: 'Quote tracker is editable again. Good timing, we had updates queued.', fix: 'Quota raised, version history trimmed, and edit access confirmed for the whole team. Set an alert at 90% so we act before it flips read-only again.' } },
  ],
  'Printing & Labels': [
    { s: '{printer} offline', d: '{printer} shows offline for everyone. Restarted it twice. Orders are stacking up at the pack stations.', t: 'incident', pri: [10, 40, 45, 5],
      c: { reply: 'The print server lost its spooler for that device — restarting the queue server-side now, which is why local restarts didn\'t help. Jobs will release in order.', note: 'Spooler crash on the print server; the queued jobs preserved and released after restart.', ask: 'It just came back and the backlog is printing. Pack stations are moving again.', fix: 'Print queue restored and the backlog cleared in order. Added the spooler to service monitoring so we catch this before the floor notices.' } },
    { s: 'Label alignment wrong on Zebra', d: 'Shipping labels printing shifted half an inch off the stock on {printer} — carrier scanner rejects them.', t: 'incident', pri: [10, 45, 40, 5],
      c: { reply: 'That offset means the printer lost its label calibration — usually after a media change. Walking someone at the printer through the recalibrate now; takes two minutes.', ask: 'Recalibrated with your steps and the test label sits perfectly. Carrier scans are passing again.', fix: 'Label sensor recalibrated and alignment verified against the carrier scanner. Posted the two-minute recalibration steps on the printer for the next media change.' } },
    { s: 'Printer mapping for new desk', d: 'Just moved desks at {loc} — please map me to {printer} and remove my old default.', t: 'request', pri: [0, 5, 45, 50],
      c: { reply: 'Mapping you to the printer by your new desk and removing the old default now — no restart needed.', ask: 'Test page came out at the right printer. Thanks!', fix: 'Printer mapping updated: new default set, old mapping removed, test page confirmed.' } },
    { s: 'Toner replacement', d: '{printer} shows toner critically low and print quality is fading. Probably a day of toner left.', t: 'request', pri: [0, 10, 55, 35],
      c: { reply: 'We keep that cartridge in stock — swapping it this afternoon before it runs dry.', ask: 'Print quality is back to crisp. Thanks for getting it before it died.', fix: 'Toner replaced and a spare ordered for the cabinet so the next swap is same-day too.' } },
  ],
  'Phones & Mobile': [
    { s: 'Desk phone no dial tone', d: 'My desk phone at {loc} has no dial tone since this morning. Softphone works but customers call my desk line directly.', t: 'incident',
      c: { reply: 'Your desk phone dropped its registration with the phone system — rebooting it remotely to re-register. Softphone keeps working meanwhile.', ask: 'Dial tone is back and a customer already got through. Thanks!', fix: 'Phone re-registered and test calls confirmed both directions. If it drops again we\'ll replace the handset — this one is on the aging list.' } },
    { s: 'Company phone for new manager', d: 'Requesting a company mobile for our new {dept} manager starting next week, standard sales configuration.', t: 'request',
      c: { reply: 'Phone is in stock — provisioning it today with the standard sales profile (mail, MDM, CRM). It\'ll be ready for day one.', ask: 'Perfect, I\'ll collect it Monday morning before they arrive.', fix: 'Device enrolled, number assigned, and handed over on the start date. Manager confirmed mail and apps working.' } },
    { s: 'Voicemail not transcribing', d: 'Voicemail-to-email stopped including transcriptions about a week ago. Attachments still arrive fine.', t: 'incident', pri: [0, 10, 50, 40],
      c: { reply: 'The transcription service license lapsed at renewal — the audio delivery doesn\'t depend on it, which is why attachments kept arriving. Re-activating it now.', note: 'Transcription add-on was dropped from the renewal quote by mistake; vendor re-enabled at no charge for the gap.', ask: 'Today\'s voicemails came with text again. Thanks!', fix: 'Transcription service re-activated and verified on new voicemails. Renewal checklist updated so the add-on can\'t be dropped silently again.' } },
  ],
  'Onboarding & Offboarding': [
    { s: 'New hire setup — {dept}', d: 'New hire starting in {dept} on Monday. Needs laptop, {app} access, phone extension, and badge. Desk at {loc}.', t: 'request', pri: [5, 45, 45, 5],
      c: { reply: 'Onboarding checklist opened: laptop imaging today, account and app access tomorrow, badge and extension Friday. Everything will be on the desk before Monday.', note: 'Standard new-hire bundle; app access needs the license pool check — one seat free, assigned.', ask: 'Great — their manager will do the desk walkthrough Monday at 9.', fix: 'All items complete: laptop, account, app access, extension, and badge tested at the door. New hire signed in successfully on day one.' } },
    { s: 'Offboarding — departure Friday', d: 'Team member in {dept} leaving Friday. Please schedule account disable, mailbox delegation to their manager, and equipment return.', t: 'request', pri: [5, 40, 50, 5],
      c: { reply: 'Offboarding scheduled: account disables automatically Friday at 5pm, mailbox delegates to the manager for 90 days, and the equipment return is booked with reception.', ask: 'Confirmed on the timing — their last day wraps at 4.', fix: 'Offboarding completed on schedule: account disabled, mailbox delegated, laptop and badge returned and checked in. Access review shows nothing left active.' } },
    { s: 'Intern batch setup for summer', d: 'Five interns starting next month in {dept}. Need loaner laptops and limited accounts. Full list attached.', t: 'request',
      c: { reply: 'Reserved five loaners from the summer pool and creating the limited intern accounts from your list — expiring automatically on their end date.', ask: 'End date confirmed as the last Friday of August for all five.', fix: 'Five loaners imaged and five intern accounts created with auto-expiry. Handout scheduled with the hiring manager for orientation day.' } },
  ],
  'Network & VPN': [
    { s: 'VPN disconnects every 20 minutes', d: 'Working from {loc}, VPN drops roughly every 20 minutes and takes 2-3 tries to reconnect. Home internet is stable otherwise.', t: 'incident',
      c: { reply: 'A clean 20-minute cycle points at the client\'s keepalive losing to your router\'s session timeout. Switching your ZScaler client to the TCP fallback profile, which rides through it.', note: 'Same pattern as other home-office reports on that ISP — TCP fallback profile resolves it.', ask: 'Been connected for three hours straight since the change. Excellent.', fix: 'Client switched to the TCP profile and the connection has held all day. Documented the setting for the next hybrid-schedule setup.' } },
    { s: 'VPN access request', d: 'Requesting VPN access — starting a hybrid schedule next week per my manager in {dept}.', t: 'request',
      c: { reply: 'Adding you to the remote-access group and sending the ZScaler setup guide. Do the enrollment while you\'re still in the office this week — it\'s two minutes.', ask: 'Enrolled from my desk today and the test connection worked.', fix: 'VPN access granted and first remote sign-in verified. You\'re set for the hybrid schedule.' } },
    { s: 'Wi-Fi dead zone near receiving', d: 'No usable Wi-Fi signal in the corner of the warehouse near receiving dock 4. Scanners and tablets both drop there.', t: 'incident', pri: [5, 35, 50, 10],
      c: { reply: 'Heat-mapped that corner this morning — coverage falls off a cliff behind the new racking. An additional access point is the fix; mounting it this week.', note: 'New racking install shadowed the dock-4 corner; survey shows -78dBm. AP on order, powered from the existing dock switch.', ask: 'Makes sense — the drops started around when the racking went in.', fix: 'New access point mounted and the dock-4 corner now surveys at full strength. Scanners hold connection through the whole zone.' } },
    { s: 'Whole office intermittent internet', d: 'Internet at {loc} keeps dropping for 30-60 seconds at a time, affecting everyone. Started around 9am.', t: 'incident', pri: [40, 45, 15, 0],
      c: { reply: 'We see it too — the primary circuit is flapping and failover keeps swinging traffic. The carrier has a ticket open and we\'ve pinned traffic to the backup circuit to stabilize things now.', note: 'Carrier confirms errors on their edge equipment; case escalated. Backup circuit holding at reduced but stable capacity.', ask: 'Much better since about 11 — slower but no more drops.', fix: 'Carrier replaced the faulty edge equipment and the primary circuit has been clean for 24 hours. Traffic is back on primary with failover verified.' } },
    { s: 'Firewall change for {vendor} portal', d: 'Requesting firewall allowance for the new {vendor} portal — {dept} can\'t reach the site from the office network.', t: 'change', pri: [0, 25, 60, 15],
      c: { reply: 'Change logged. The portal\'s domains are categorized as uncategorized-new, which the policy blocks by default — adding a scoped allowance after a quick security review.', note: 'Domains reviewed — legitimate vendor infrastructure. Allowance scoped to the requesting department.', fix: 'Firewall allowance deployed for the portal, scoped to your department. Confirmed reachable from an office machine.' } },
  ],
  'Warehouse Tech': [
    { s: 'RF scanner won\'t connect', d: 'Scanner unit 12 won\'t connect to Wi-Fi after reboot. Other scanners fine. Down a scanner during receiving rush.', t: 'incident', pri: [10, 45, 40, 5],
      c: { reply: 'Unit 12 lost its stored Wi-Fi certificate in the reboot. Grab spare unit 15 from the charging rack for the rush — I\'ll re-provision 12 and have it back today.', ask: 'On spare 15 and receiving is moving. Thanks.', fix: 'Unit 12 re-provisioned with a fresh certificate and back on the rack. Spare returned. Cert renewal for the whole fleet is scheduled to avoid repeat drops.' } },
    { s: 'RF scanner screen cracked', d: 'Dropped scanner unit 7, screen is cracked but still scans. Requesting replacement/repair before it dies completely.', t: 'request', pri: [0, 25, 55, 20],
      c: { reply: 'Swapping you spare unit 9 today and sending unit 7 out for a screen repair under the service contract — about a week turnaround.', ask: 'Unit 9 collected. Sorry about the drop!', fix: 'Unit 7 repaired and returned to the spare pool; unit 9 stays with you. No charge under the service contract.' } },
    { s: 'All scanners dropping in aisle 40', d: 'Every RF scanner loses connection in aisles 40-44. Pickers are walking out of the zone to sync. Slowing wave picking.', t: 'incident', pri: [25, 50, 25, 0],
      c: { reply: 'The access point covering 40-44 is up but not passing traffic — power-cycling it remotely now. Scanners should reconnect within a couple of minutes.', note: 'AP wedged — third occurrence on this unit. Flagging it for replacement rather than another reboot.', ask: 'Scanners reconnected in the zone. Picking is back to normal speed.', fix: 'AP power-cycled to restore service, then replaced with a new unit the following morning. Zone coverage verified end to end — no drops since.' } },
    { s: 'New pack station setup', d: 'Adding a pack station at {loc} — needs a workstation, {printer} connection, and scale integration.', t: 'request',
      c: { reply: 'Scheduling the build: workstation imaging today, then the printer mapping and scale calibration on-site tomorrow morning before first shift.', ask: 'Tomorrow before first shift works — the station framing is already up.', fix: 'Pack station live: workstation, label printing, and scale all verified with a test shipment. Handed off to the shift lead.' } },
    { s: 'Scanner OS update rollout', d: 'Vendor recommends firmware update for all RF scanners to fix the roaming bug. Requesting change window Sunday night.', t: 'change', pri: [5, 40, 50, 5],
      c: { reply: 'Change approved for Sunday 10pm. Updating in two batches so half the fleet is always available, with two units updated early as canaries.', note: 'Canary units updated and roaming verified across aisle boundaries — proceeding with the full rollout.', fix: 'All scanners updated in the Sunday window. Roaming bug confirmed fixed — no zone-boundary drops in the week since.' } },
  ],
  MERP: [
    { s: 'MERP slow during order entry', d: 'Order entry screens in MERP taking 15-20 seconds per save since yesterday. Whole {dept} team affected during peak entry.', t: 'incident', pri: [25, 50, 25, 0],
      c: { reply: 'Confirmed — save times spiked after yesterday\'s data load. A missing index on the new pricing table is dragging every save. Applying the fix in the next maintenance window tonight.', note: 'Query plan shows full table scans against the newly loaded pricing table; index restore scripted and tested in sandbox.', ask: 'Any interim workaround? Peak entry is painful right now.', fix: 'Index rebuilt overnight — saves are back under two seconds. Added the check to the data-load runbook so the next load can\'t drop it.' } },
    { s: 'EDI 856 failing to {vendor}', d: 'ASNs to {vendor} failing since last night — 14 orders stuck in the EDI error queue. They require ASN before receipt.', t: 'incident', pri: [30, 50, 20, 0],
      c: { reply: 'Their EDI gateway rotated certificates last night without notice — our connection is rejecting the new cert. Trusting the new certificate now and replaying the stuck ASNs in order.', note: 'Trading partner cert rotation, no advance notice. All 14 documents preserved in the error queue for replay.', ask: 'Their receiving dock confirmed the first ASNs just landed. Crisis averted.', fix: 'New certificate trusted, all 14 ASNs replayed and acknowledged. Asked the vendor for advance notice on future rotations and added cert-expiry monitoring on our side.' } },
    { s: 'New MERP user setup', d: 'Please set up a MERP account for a new {dept} member — mirror the permissions of their teammates.', t: 'request',
      c: { reply: 'Creating the account now, mirrored from a teammate\'s role profile. Login details go to their manager for day one.', ask: 'Manager received the credentials. Thanks!', fix: 'MERP account created with the team\'s standard role. First login and a test order lookup verified with the new user.' } },
    { s: 'MERP patch deployment', d: 'Requesting approval to apply the latest MERP service pack in the Sunday maintenance window. Tested in the sandbox.', t: 'change', pri: [5, 50, 40, 5],
      c: { reply: 'Approved for the Sunday window given the clean sandbox run. Backups verified before we start; rollback plan is the standard snapshot restore.', note: 'Sandbox regression suite passed; snapshot taken at window start.', fix: 'Service pack applied in the Sunday window — order entry, shipping, and EDI smoke tests all passed before Monday open. No user-visible issues.' } },
    { s: 'Price list import failed', d: 'The {vendor} price list import failed at row 8,000 with a data type error. New pricing goes live Monday.', t: 'incident', pri: [10, 50, 35, 5],
      c: { reply: 'Found it — the vendor changed their quantity-break column from numeric to a range format mid-file. Writing a transform to normalize it and re-running the import today.', note: 'Vendor file format drift at row 8,001; transform handles both formats so future files import either way.', ask: 'Good catch — they didn\'t mention any format change in the transmittal.', fix: 'Import re-run cleanly with the transform — full price list loaded and spot-checked against the vendor file. Ready ahead of the Monday effective date.' } },
  ],
  'Business Apps': [
    { s: 'CRM opportunity sync stuck', d: 'Opportunities updated in CRM aren\'t syncing to MERP. Sync log shows errors since about 7am.', t: 'incident', pri: [10, 50, 35, 5],
      c: { reply: 'The integration user\'s CRM session expired at 7am and the sync has been erroring since. Re-authenticating it now — queued changes will flow through in order.', note: 'Integration user password rotated by the security policy; token invalidated. Adding the account to the rotation exception list with cert auth instead.', ask: 'Opportunities from this morning just appeared in MERP. Thanks!', fix: 'Integration re-authenticated and the backlog fully synced. Moved the connection to certificate auth so password rotation can\'t break it again.' } },
    { s: 'Quote tool rounding wrong', d: 'The quoting tool rounds extended prices differently than MERP, causing pennies-off discrepancies on large-quantity quotes.', t: 'incident', pri: [0, 30, 55, 15],
      c: { reply: 'Confirmed — the quote tool rounds per line and MERP rounds the extended total. Aligning the quote tool to MERP\'s method so the numbers always match.', note: 'Rounding-mode mismatch: line-level round-half-up vs extended-total rounding in MERP. One-line config change, needs regression on big BOM quotes.', ask: 'That explains the penny chase on every large quote. Thanks for digging in.', fix: 'Quote tool rounding aligned with MERP and verified across a set of large-quantity test quotes — totals now match to the cent.' } },
    { s: 'Concur expense report stuck in approval', d: 'An expense report has been sitting in Pending Approval for two weeks; the listed approver left the company last month.', t: 'incident', pri: [0, 20, 55, 25],
      c: { reply: 'The workflow was still pointed at the departed approver. Rerouting the report to your current manager and fixing the approval chain so nothing else queues to the old name.', ask: 'It just moved — manager has it now. Thanks!', fix: 'Report approved after rerouting, and the approval hierarchy updated. Swept Concur for other reports stuck on departed approvers — two more fixed.' } },
    { s: 'CRM access for new rep', d: 'New {dept} team member needs a CRM license and addition to the regional sharing group.', t: 'request',
      c: { reply: 'Assigning a license from the pool and adding them to the regional sharing group now — takes effect on their next sign-in.', ask: 'They\'re in and can see the regional pipeline. Thanks!', fix: 'License assigned, sharing group membership verified, and their first login confirmed with the right visibility.' } },
  ],
  'Access & Accounts': [
    { s: 'Account locked out', d: 'Locked out of my account after password change on my phone. Can\'t log into anything. Calling from a teammate\'s desk.', t: 'incident', pri: [10, 45, 40, 5],
      c: { reply: 'Your phone kept retrying the old password and tripped the lockout. Clearing the lock now — update the saved password on the phone first or it\'ll lock you right back out.', ask: 'Updated the phone and signed in everywhere. All good.', fix: 'Lockout cleared and the stale saved password on mobile updated — the usual culprit. You\'re signed in across devices.' } },
    { s: 'Password reset', d: 'Forgot my password after vacation. Need a reset — I\'m at {loc} and can verify identity however needed.', t: 'incident', pri: [5, 30, 55, 10],
      c: { reply: 'Verified you via your manager and badge — issuing a temporary password now. You\'ll be forced to set a new one at first sign-in; store it in Keeper.', ask: 'In and reset. Vacation brain is real — thanks.', fix: 'Password reset with identity verified, new credential set at first sign-in and saved to Keeper. Also enrolled you in self-service reset for next time.' } },
    { s: 'Shared drive access request', d: 'Need access to the {dept} shared drive for the {report}. Manager approved via email (attached).', t: 'request',
      c: { reply: 'Approval attached checks out — adding you to the drive\'s access group now. Reconnect or reboot to pick up the permission.', ask: 'Rebooted and the drive is there. Thanks!', fix: 'Access granted through the department group and confirmed you can open the report folder.' } },
    { s: 'Permission mirror for role change', d: 'Moving from {dept} to a new role — please mirror the access of my new team, effective next Monday.', t: 'request',
      c: { reply: 'Scheduling the switch for Monday morning: new team\'s access groups added, old department-specific access removed same day so there\'s no gap or overlap.', note: 'Role-change checklist applied — old access removal is the part people forget; both halves scheduled together.', ask: 'Monday works. Excited for the new role!', fix: 'Access mirrored from the new team and legacy permissions removed, both effective Monday as scheduled. Verified with a sign-in check that afternoon.' } },
    { s: 'Service account for integration', d: 'The {app} integration needs a service account with read access to the orders tables. Details in the attached spec.', t: 'change', pri: [0, 30, 55, 15],
      c: { reply: 'Change logged. Creating the service account with read-only scope exactly per the spec — no interactive login, credentials in Keeper, access reviewed quarterly.', note: 'Scoped to read-only on the orders tables only; flagged for the quarterly service-account review.', fix: 'Service account created and the integration connected successfully against the orders tables. Credentials vaulted and review cycle set.' } },
  ],
  Security: [
    { s: 'Phishing email reported', d: 'Received a suspicious email claiming to be from {vendor} asking to update banking details. Several teammates got it too. Not clicked.', t: 'incident', pri: [20, 55, 25, 0],
      c: { reply: 'Good catch and thanks for not clicking. We\'ve pulled that message from every mailbox that received it and blocked the sender domain in Proofpoint.', note: 'Campaign hit 14 mailboxes — all purged, sender domain and infrastructure blocked. Banking-detail lure, spoofed vendor display name.', ask: 'Two teammates said theirs vanished from the inbox — impressive.', fix: 'Message purged org-wide, sender blocked, and the vendor\'s real AP contact confirmed no legitimate banking change is in flight. Reported to the vendor so they can warn other customers.' } },
    { s: 'Clicked a suspicious link', d: 'I clicked a link in an email that looked like a DocuSign request before realizing it was fake. Changed my password immediately. What else should I do?', t: 'incident', pri: [45, 45, 10, 0],
      c: { reply: 'Changing the password was exactly right. We\'ve revoked all your active sessions, forced re-auth everywhere, and are scanning your machine now. Watch for unexpected MFA prompts and report anything odd.', note: 'CrowdStrike scan clean; the link led to a credential-harvest page — no payload. Sessions revoked within minutes of entry, no anomalous sign-ins observed.', ask: 'Scan finished and nothing flagged. Lesson learned on checking the sender.', fix: 'Machine scan clean, sessions revoked, no suspicious sign-in activity in the logs since. The phishing domain is blocked org-wide. Closing — you handled it exactly right.' } },
    { s: 'MFA prompts not arriving', d: 'Authenticator push notifications stopped arriving on my phone. Can\'t approve sign-ins; using backup codes for now.', t: 'incident', pri: [5, 45, 45, 5],
      c: { reply: 'Your phone\'s battery optimizer started killing the authenticator in the background — common after phone OS updates. Walking you through exempting the app; pushes resume immediately.', ask: 'Exempted it and the test push arrived instantly. Thanks!', fix: 'Authenticator exempted from battery optimization and push approvals verified working. Keep the backup codes stored safely regardless.' } },
    { s: 'New phone — MFA transfer', d: 'Got a new phone and need to move my authenticator enrollment over before my old phone gets wiped.', t: 'request', pri: [0, 25, 60, 15],
      c: { reply: 'Let\'s do it while you still have both phones — that makes it a two-minute transfer instead of an identity-verification reset. Sending the re-enrollment link now.', ask: 'Transferred and tested a sign-in from the new phone. Old one is ready to wipe.', fix: 'MFA enrollment moved to the new device and verified. Old device\'s enrollment revoked — safe to wipe.' } },
    { s: 'USB port policy exception', d: '{dept} needs a policy exception to use a vendor-provided USB tool for firmware updates on test equipment.', t: 'change', pri: [0, 25, 55, 20],
      c: { reply: 'Reviewing the request — we\'ll scan and hash the vendor tool, then scope an exception to the specific device IDs on the machines that need it rather than opening ports broadly.', note: 'Tool scanned clean; exception scoped to hardware IDs on two named machines, 12-month expiry with review.', fix: 'Exception deployed: the vendor USB tool works on the two designated machines only, everything else stays locked. Expiry and review date set.' } },
    { s: 'CrowdStrike quarantined a file I need', d: 'CrowdStrike quarantined the {vendor} pricing tool installer as suspicious. It came from their official portal — can it be reviewed and released?', t: 'incident', pri: [5, 40, 45, 10],
      c: { reply: 'Reviewing the quarantined installer now — hash-checking it against the vendor\'s published release and detonating it in the sandbox before any release decision.', note: 'Hash matches the vendor\'s published SHA-256; sandbox run clean. Detection was a heuristic on the unsigned installer stub.', ask: 'Vendor support also confirmed the download is authentic on their side.', fix: 'Installer verified authentic and released from quarantine with an allowlist entry for this version\'s hash. Asked the vendor to sign their installers — that\'s what tripped detection.' } },
    { s: 'Locked out of Keeper', d: 'Keeper is rejecting my master password after the update and I\'m locked out of all my work credentials.', t: 'incident', pri: [10, 50, 35, 5],
      c: { reply: 'Starting the admin-assisted recovery — you\'ll verify identity with your manager present, then set a new master password. Your vault contents are intact; this only resets the door key.', note: 'Identity verified per the master-password reset procedure; account recovery initiated. Vault data unaffected.', ask: 'Back into the vault and everything is there. Huge relief.', fix: 'Master password reset through verified recovery and vault access confirmed. Recovery phrase re-issued — store it somewhere that isn\'t the vault it unlocks.' } },
  ],
  'Data & Reporting': [
    { s: '{report} showing wrong numbers', d: 'The {report} totals don\'t match MERP for yesterday — off by about 4%. Leadership reviews this every morning.', t: 'incident', pri: [10, 50, 35, 5],
      c: { reply: 'Traced it — the overnight refresh ran before yesterday\'s late order batch posted, so the report snapshotted early. Re-running the refresh now and moving its schedule after the batch completes.', note: 'Refresh fired at 4:30am; the order batch didn\'t finish until 4:50 after month-end volume. Dependency, not a data error.', ask: 'Re-run matches MERP to the dollar now. Leadership review went fine.', fix: 'Refresh re-sequenced to run after the order batch confirms complete. Totals verified against MERP for three consecutive days.' } },
    { s: 'New dashboard request', d: '{dept} would like a Power BI dashboard for the {report}, refreshed daily, filterable by branch and salesperson.', t: 'request',
      c: { reply: 'Scoping this with you — the data already exists in the warehouse, so it\'s mostly modeling and layout. First draft to review by end of week.', ask: 'Draft looks great — can we add a trailing-13-week trend line?', fix: 'Dashboard published with daily refresh, branch and salesperson filters, and the trend view added from your feedback. Access granted to the whole department.' } },
    { s: 'Power BI access request', d: 'Requesting Power BI access to view the {report}. My whole team has it; I was missed in the last batch.', t: 'request', pri: [0, 5, 50, 45],
      c: { reply: 'Easy fix — adding you to the team\'s Power BI group now. The report appears in your workspace within the hour.', ask: 'It\'s there and loading. Thanks!', fix: 'Access granted via the team group and confirmed you can open the report. You\'ll inherit anything new shared to the team automatically.' } },
    { s: 'Scheduled report stopped sending', d: 'The 6am {report} email hasn\'t arrived for three days. It drives our morning {dept} standup.', t: 'incident', pri: [5, 45, 45, 5],
      c: { reply: 'The subscription broke when its owner\'s account was disabled at offboarding — the schedule silently died with it. Re-creating it under a service account so a departure can\'t kill it again.', note: 'Owned-by-person subscription orphaned at offboarding; moved to the reporting service account like the others.', ask: 'This morning\'s report arrived at 6:01. Standup is whole again.', fix: 'Subscription rebuilt under the service account and delivery verified three mornings running. Audited the other person-owned schedules and migrated two more.' } },
    { s: 'One-time data extract', d: 'Need an extract of all orders with {vendor} parts for the last 18 months for a supplier negotiation next week.', t: 'request', pri: [0, 30, 55, 15],
      c: { reply: 'Writing the query now — 18 months of orders filtered to that supplier\'s parts, with quantities, pricing, and ship dates. Delivered as an Excel file to you by tomorrow.', ask: 'Received it — exactly the cut we needed for the negotiation. Thanks!', fix: 'Extract delivered and spot-verified against MERP order history. Kept the query saved in case the negotiation needs an updated pull.' } },
  ],
  'Product & Pricing': [
    { s: 'Part cross-reference wrong for {vendor} series', d: 'The cross on a connector series points at a discontinued alternative. Two customers caught it this week — need the cross table corrected.', t: 'incident', pri: [0, 30, 55, 15],
      c: { reply: 'Confirmed against the vendor\'s current cross guide — the listed alternative went EOL last quarter. Updating the cross table to the successor part now.', note: 'Vendor cross guide rev-dated last quarter; our table was one revision behind. Checking the rest of the series for the same drift.', ask: 'One of the customers who caught it confirmed the new cross works for their design.', fix: 'Cross table corrected to the successor part across the whole series, verified against the vendor\'s current guide. Scheduled a quarterly cross-reference review to catch EOL drift sooner.' } },
    { s: 'Price list effective date correction', d: 'The {vendor} pricing loaded with the wrong effective date, so quotes are pulling last quarter\'s cost. Needs correcting before month-end quoting.', t: 'incident', pri: [10, 45, 40, 5],
      c: { reply: 'Correcting the effective date on the loaded price list now — new quotes pick up current cost immediately after. Pulling the list of quotes created during the wrong-date window for review.', note: 'Effective date keyed as next quarter instead of current — 30 quotes went out against stale cost; sales notified with the list.', ask: 'Got the affected-quote list — only three need re-issuing, the rest hadn\'t gone to customers yet.', fix: 'Effective date corrected and verified in new quotes. The three affected customer quotes were re-issued at correct pricing before month-end.' } },
    { s: 'New product family setup', d: 'We\'re onboarding a new {vendor} product family — need part records, categories, and datasheet links created in the catalog.', t: 'request',
      c: { reply: 'Starting the catalog build from the vendor\'s product data feed: part records and categorization first, then datasheet links validated in a second pass.', ask: 'Vendor also sent updated packaging quantities this morning — forwarding those.', fix: 'Product family live in the catalog: part records, categories, packaging data, and datasheet links all created and spot-checked. Sales can quote the new line.' } },
    { s: 'Datasheet links broken on product pages', d: 'Datasheet links for several part families 404 after the vendor reorganized their site. Customers are asking sales for PDFs.', t: 'incident', pri: [0, 25, 60, 15],
      c: { reply: 'The vendor moved their entire document library to new URLs. Running a link checker across their families now and bulk-updating to the new paths.', note: 'Vendor site restructure — 340 links affected across 12 families. Bulk remap scripted from their new sitemap.', ask: 'Spot-checked a few product pages and the datasheets open again.', fix: 'All 340 datasheet links remapped and verified with an automated check. The link checker now runs weekly so vendor reorganizations get caught before customers notice.' } },
  ],
  'AI & Enablement': [
    { s: 'Claude access for {dept}', d: 'Our {dept} team wants access to Claude for drafting and analysis. Manager approved — how do we get licenses and the usage guidelines?', t: 'request',
      c: { reply: 'Provisioning seats for the team under the company workspace and sending the usage guidelines — short version: no customer PII or supplier pricing in prompts, and review output before it leaves the building.', ask: 'Everyone\'s activated and the guidelines are shared in our channel.', fix: 'Team licensed and onboarded with the usage guidelines acknowledged. Added the team to the AI-users group for future announcements and training.' } },
    { s: 'ChatGPT usage policy question', d: 'Can we paste customer part lists into ChatGPT for cleanup, or is that against the data policy? Need a ruling before the team keeps doing it.', t: 'request', pri: [5, 35, 50, 10],
      c: { reply: 'Good instinct to ask first. Customer part lists are customer data — not for public AI tools. The approved path is the company Claude workspace, which is under our data agreement. Formal ruling to follow in writing.', note: 'Escalated to the data-governance group for the written ruling; interim guidance issued same day.', ask: 'Team has switched to the company workspace for this. Thanks for the fast answer.', fix: 'Written ruling issued: customer data only in the company-managed AI workspace, never public tools. Added to the AI usage guidelines and announced in the department channel.' } },
    { s: 'Automate the {report} distribution', d: 'We manually export and email the {report} every Monday. Can this be automated end to end?', t: 'request', pri: [0, 15, 55, 30],
      c: { reply: 'Very automatable — scheduling the report to render and email itself Monday 6am to your distribution list. You\'ll never touch the export again.', ask: 'First automated Monday delivery arrived perfectly formatted. That\'s an hour of my week back.', fix: 'Automation live: report renders and distributes itself every Monday morning with a failure alert to us if it ever doesn\'t. Manual process retired.' } },
    { s: 'AI summary quality issue', d: 'The AI-generated call summaries are missing action items about half the time for our team. Can the prompt or process be tuned?', t: 'incident', pri: [0, 20, 60, 20],
      c: { reply: 'Reviewed a sample of your team\'s calls — action items stated early in calls are getting dropped. Tuning the summary prompt to extract commitments from the whole transcript, not just the wrap-up.', note: 'Prompt overweights the last few minutes; test set shows the tuned version catches early-call commitments reliably.', ask: 'This week\'s summaries caught every follow-up we compared against notes. Big improvement.', fix: 'Summary prompt tuned and validated against a two-week sample — action-item capture went from roughly half to nearly all. Rolled out for all teams.' } },
  ],
  'Warehouse Operations': [
    { s: 'Receiving discrepancy on {vendor} PO', d: 'PO received short by two cartons against the packing list at {loc}. Need disposition before we can put away the rest.', t: 'incident', pri: [5, 40, 50, 5],
      c: { reply: 'Filing the discrepancy with the supplier now and releasing the matched cartons for putaway — no reason to hold the good stock while the short-ship gets resolved.', note: 'Supplier acknowledged the short-ship; the two cartons missed their consolidation. Shipping on their next truck.', ask: 'Matched cartons are put away. Watching for the two stragglers.', fix: 'Missing cartons arrived on the supplier\'s follow-up shipment and received against the original PO. Discrepancy closed with the count corrected.' } },
    { s: 'LTL pickup missed', d: 'The LTL carrier missed today\'s pickup window and we have three pallets staged. Customer expects delivery this week.', t: 'incident', pri: [10, 50, 35, 5],
      c: { reply: 'Carrier dispatch confirms the driver ran out of hours — they\'re guaranteeing first pickup tomorrow. Also quoting an alternate carrier in parallel in case that slips.', ask: 'Customer is OK as long as it delivers by Friday.', fix: 'Pallets picked up on the carrier\'s first run next morning and delivered inside the customer\'s window. Filed the missed pickup against the carrier\'s performance record.' } },
    { s: 'Cycle count variance in aisle 12', d: 'Cycle count shows a 200-piece variance on a high-running part. Need inventory review before tomorrow\'s wave.', t: 'incident', pri: [5, 45, 45, 5],
      c: { reply: 'Recounting the primary and checking secondary locations — high-runners often have stock sitting in overflow that the count missed.', note: 'Found 200 pieces in an unlogged overflow location from last week\'s putaway. Location discipline issue, not shrinkage.', ask: 'That matches — putaway was slammed last week.', fix: 'Variance resolved: stock found in an unlogged overflow location and the system corrected. Putaway team briefed on logging overflow moves; tomorrow\'s wave allocates clean.' } },
    { s: 'Value-add job routing question', d: 'The cut-tape order for {vendor} parts has conflicting instructions between the traveler and the sales order. Which one wins?', t: 'incident', pri: [0, 30, 55, 15],
      c: { reply: 'Hold the job — checking with the account rep on which instruction reflects what the customer actually ordered before anything gets cut.', note: 'Sales order was amended after the traveler printed; the traveler is stale. Re-printing from current.', ask: 'Holding the job at the value-add bench until we hear.', fix: 'Sales order was correct — the traveler predated an amendment. Fresh traveler issued, job completed to the right spec, and travelers now regenerate automatically on order amendment.' } },
    { s: 'Extra staging space for month-end', d: 'Requesting temporary staging space and a second shift overlap for month-end shipping volume next week.', t: 'request', pri: [0, 25, 60, 15],
      c: { reply: 'Reserving the dock-3 overflow area for staging next week and coordinating the shift overlap with the floor supervisors — confirming both by Wednesday.', ask: 'Both confirmed on the floor plan. Month-end should flow.', fix: 'Staging space and shift overlap held through month-end — record volume shipped without a bottleneck. Space released back after close.' } },
    { s: 'UPS WorldShip won\'t print labels', d: 'UPS WorldShip at the {loc} shipping station errors on every label since this morning. FedEx station still works, but UPS shipments are stacking up.', t: 'incident', pri: [15, 50, 30, 5],
      c: { reply: 'WorldShip\'s overnight update broke its printer binding — re-pointing it at the label printer now. Route urgent UPS shipments through station 2 for the next few minutes.', note: 'WorldShip auto-update reset the printer configuration — known behavior; documented the post-update reconfigure steps.', ask: 'Station is printing again and the backlog is clearing.', fix: 'Printer binding restored and the UPS backlog shipped same day. Post-update checklist posted at the station so the next WorldShip update is a two-minute fix.' } },
  ],
  'Supply Chain & Logistics': [
    { s: 'Export docs for {vendor} shipment', d: 'International shipment needs an ECCN review and export documentation before it can leave. Freight is booked for Friday.', t: 'request', pri: [5, 45, 45, 5],
      c: { reply: 'Starting the ECCN review against the part list now — most of these classify straightforwardly. Docs will be ready ahead of the Friday freight booking.', note: 'All parts classify EAR99 except one line needing a closer datasheet review — resolved, also EAR99.', ask: 'Freight forwarder is asking for the docs by Thursday noon — doable?', fix: 'ECCN review complete and full export documentation delivered to the forwarder Thursday morning. Shipment departed on schedule Friday.' } },
    { s: 'Carrier billing dispute', d: 'The freight bill for last week\'s inbound is double the quote. Need the carrier invoice disputed and the accrual corrected.', t: 'incident', pri: [0, 25, 55, 20],
      c: { reply: 'The carrier applied a reweigh at double the quoted weight — our dock scale ticket says otherwise. Filing the dispute with our scale documentation and correcting the accrual to the quoted amount.', note: 'Dock scale ticket and BOL both support the quoted weight; carrier reweigh looks like a misread. Dispute filed with evidence.', ask: 'Accrual correction noted for the close. Thanks.', fix: 'Carrier accepted the dispute and re-invoiced at the quoted rate. Accrual corrected; the credit hits next month\'s statement.' } },
    { s: 'Supplier shipment stuck in customs', d: 'A {vendor} shipment has been held in customs for four days. Two customer orders are waiting on this material.', t: 'incident', pri: [15, 50, 30, 5],
      c: { reply: 'Broker says the hold is a documentation query — the commercial invoice value didn\'t match the PO. Sending the corrected invoice and PO copy to the broker today.', note: 'Supplier\'s invoice showed unit price instead of extended value — classic mismatch trigger. Corrected docs submitted via broker.', ask: 'Customers notified of a revised ETA — both OK for now.', fix: 'Corrected documentation cleared the hold within a day. Material received and both customer orders shipped. Supplier asked to double-check invoice values on international shipments.' } },
    { s: 'FedEx rate quotes failing in shipping software', d: 'FedEx rate lookups are timing out in the shipping software, so everything is defaulting to UPS even when FedEx is cheaper.', t: 'incident', pri: [5, 40, 45, 10],
      c: { reply: 'FedEx retired the legacy rating API endpoint our shipping software was still calling. Applying the vendor\'s patch that moves it to the current API.', note: 'Vendor bulletin confirms the endpoint retirement; patch tested on one station before rolling to all.', ask: 'Rates are coming back on station 1 — noticeably faster too.', fix: 'Patch deployed to every shipping station — FedEx rates quote reliably again and carrier selection is comparing honestly. Reviewed a week of shipments for overpay; impact was minimal.' } },
  ],
  'DC Solutions': [
    { s: 'DC Connect order stuck in review', d: 'A DC Connect order has been sitting in review for two days and the customer is calling. Can someone release or reject it?', t: 'incident', pri: [10, 50, 35, 5],
      c: { reply: 'The order tripped the credit-hold rule on a stale credit limit — the account\'s limit was raised last month but the sync didn\'t catch it. Refreshing the credit data and releasing now.', note: 'Credit limit sync lag between the ERP and DC Connect — refreshed manually, root cause logged with the integration owner.', ask: 'Customer sees the order confirmed. Thanks for the quick turnaround.', fix: 'Order released same day after the credit refresh. The nightly credit sync was fixed so raised limits propagate before the review rule fires.' } },
    { s: 'DC Solutions quote turnaround', d: 'Need a DC Solutions quote turned around today for a customer meeting — standard config plus two custom line items.', t: 'request', pri: [5, 45, 45, 5],
      c: { reply: 'On it — standard config prices immediately; chasing engineering for the two custom line items now. Full quote to you by 3pm.', ask: 'Meeting is at 4, so 3pm is perfect.', fix: 'Quote delivered at 2:40 with both custom lines priced. Customer took it into the meeting — rep says it went well.' } },
    { s: 'Program pricing mismatch', d: 'The DC Solutions program pricing in the quote tool doesn\'t match the agreed contract pricing for this account.', t: 'incident', pri: [5, 40, 45, 10],
      c: { reply: 'The account\'s contract amendment from last quarter never made it into the quote tool\'s pricing table. Loading the amended pricing now and checking what quoted at the wrong numbers.', note: 'Contract amendment was signed but the pricing-table update step got skipped. Two open quotes affected, both caught before customer delivery.', ask: 'Glad we caught it before the customer did.', fix: 'Amended contract pricing loaded and verified against the agreement line by line. The two affected quotes were re-priced before going out. Amendment process now includes the pricing-table update as a required step.' } },
  ],
  'Sales Support': [
    { s: 'Order status for key customer', d: 'Customer is asking for a firm ship date on their open order — MERP shows allocated but no ship confirmation. Call scheduled this afternoon.', t: 'request', pri: [5, 45, 45, 5],
      c: { reply: 'Checked with the warehouse — the order is allocated and picks in tonight\'s wave, shipping tomorrow. You can commit tomorrow\'s ship date with tracking to follow by end of day.', ask: 'Committed it on the call — customer is satisfied. Thanks for the fast confirmation.', fix: 'Order shipped on the committed date and tracking sent to the customer. Closing this out.' } },
    { s: 'Quote assistance — large BOM', d: 'Have a 340-line BOM quote request from a new prospect. Need help splitting between franchise lines and brokerage.', t: 'request', pri: [0, 30, 55, 15],
      c: { reply: 'Running the BOM through the line-card match now — first pass shows roughly 280 lines franchise-quotable and 60 for brokerage sourcing. Splitting the workbook and starting both tracks.', note: 'Brokerage lines routed to sourcing with a 48-hour target; franchise pricing auto-filled from current price lists.', ask: 'Prospect bumped their timeline — any way to get franchise pricing out first and brokerage to follow?', fix: 'Quote delivered in two parts per the prospect\'s timeline: franchise lines same-day, brokerage sourcing completed inside 48 hours. Full 340-line quote in their hands.' } },
    { s: 'Sample request for {vendor} parts', d: 'Customer evaluating a design needs 10 samples of a {vendor} connector series. Who handles sample orders now?', t: 'request', pri: [0, 10, 55, 35],
      c: { reply: 'Sample orders go through product management now — I\'ve entered this one for you: 10 pieces to the customer\'s engineering address, no charge, referencing the evaluation.', ask: 'Customer confirmed receipt of the samples — design-in evaluation underway.', fix: 'Samples shipped and received by the customer\'s engineering team. Logged the opportunity against the account for design-in tracking.' } },
    { s: 'C of C needed for shipped order', d: 'Customer requires a certificate of conformance for an order that shipped yesterday. They can\'t receive the parts without it.', t: 'incident', pri: [5, 45, 45, 5],
      c: { reply: 'Generating the C of C from the shipped lot records now — it\'ll be emailed to the customer\'s quality contact within the hour so receiving isn\'t blocked.', ask: 'Customer received the cert and the parts are through their receiving. Thanks!', fix: 'C of C issued and accepted by the customer\'s quality team. Flagged the account so future orders include the cert automatically at shipment.' } },
  ],
  'AMAT Program': [
    { s: 'AMAT forecast upload failed', d: 'This week\'s AMAT forecast file failed validation on upload — header row changed format again. Their buyer needs confirmation today.', t: 'incident', pri: [15, 55, 25, 5],
      c: { reply: 'They added two columns to the header again. Adjusting the import mapping now — the forecast will load within the hour and confirmation goes back to their buyer today.', note: 'Third header change this year; making the importer tolerant of column reordering so this stops being an incident.', ask: 'Buyer confirmed receipt of our acknowledgment. Good save.', fix: 'Forecast loaded and confirmed to AMAT inside their window. The importer now maps columns by name instead of position, so their next format tweak won\'t break it.' } },
    { s: 'AMAT expedite request', d: 'AMAT is expediting two line items on an open PO. Need commit dates back within their SLA window.', t: 'request', pri: [15, 55, 25, 5],
      c: { reply: 'Checking stock and inbound on both lines now — one ships from stock tomorrow, the other has inbound arriving Thursday. Drafting commit dates for both inside their SLA.', ask: 'Their buyer accepted both commit dates. Thanks for the hustle.', fix: 'Both expedited lines committed within the SLA window and shipped on the committed dates. On-time credit for the scorecard.' } },
    { s: 'AMAT scorecard data question', d: 'Prepping for the quarterly business review — the on-time-delivery number on their scorecard doesn\'t match our shipping data.', t: 'request', pri: [0, 35, 50, 15],
      c: { reply: 'Reconciling their scorecard against our shipment records line by line — early look suggests they\'re measuring against request date where we commit to acknowledged date.', note: 'Confirmed: their OTD uses original request date; ours uses acknowledged commit date. Both datasets agree on actual ship dates.', ask: 'That framing will actually play well in the QBR — we hit what we commit.', fix: 'Reconciliation complete with the measurement difference documented for the QBR: shipment dates match on both sides, the delta is request-date vs commit-date methodology. Deck slide provided.' } },
  ],
  'Finance & Accounting': [
    { s: 'Invoice mismatch with PO', d: 'A {vendor} invoice is 4% over the PO value with no change order on file. AP has it on hold — needs resolution before close.', t: 'incident', pri: [0, 30, 55, 15],
      c: { reply: 'The vendor applied a surcharge that was never on the PO. Requesting a corrected invoice — the hold stays until the paper matches.', note: 'Vendor cites a materials surcharge effective last month; no change order was issued on our side. Corrected invoice requested, buyer looped in on the surcharge question.', ask: 'Close is Friday — will the corrected invoice make it?', fix: 'Vendor issued a corrected invoice at the PO value and it processed before close. The surcharge discussion moved to the buyer for future POs — nothing pays without a change order.' } },
    { s: 'Credit memo request', d: 'Customer returned parts under RMA last month and is still waiting on the credit memo. They\'re holding payment on other invoices.', t: 'request', pri: [5, 40, 45, 10],
      c: { reply: 'The RMA receipt was logged but the credit memo step never triggered — issuing it manually today and sending it straight to their AP contact.', note: 'RMA-to-credit handoff missed because the return received into the wrong disposition code. Process gap flagged to the RMA team.', ask: 'Their AP confirmed the credit memo and released the held payments.', fix: 'Credit memo issued and applied; customer released all held payments. The disposition-code gap that swallowed the handoff is fixed in the RMA process.' } },
    { s: 'GL coding question for new expense type', d: 'We have a new recurring software expense and I\'m not sure which GL account it should hit. Can someone advise before I submit?', t: 'request', pri: [0, 5, 50, 45],
      c: { reply: 'Good question to ask before submitting — recurring SaaS subscriptions code to the software-subscriptions account, not one-time software purchases. Sending you the account number and a note for the memo field.', ask: 'Submitted with that coding. Thanks for the quick ruling.', fix: 'Expense coded to the correct subscriptions account and the coding guide updated with an entry for recurring SaaS so the next person doesn\'t have to ask.' } },
  ],
  'People Operations': [
    { s: 'Missing hours in UKG', d: 'Two of my team members\' punches from Saturday aren\'t showing in UKG and payroll runs tomorrow.', t: 'incident', pri: [15, 55, 25, 5],
      c: { reply: 'The Saturday punches are sitting in the time clock\'s offline buffer — it lost network that morning and never re-synced. Forcing the sync now; the punches will post with original timestamps.', note: 'Clock at the warehouse entrance dropped Wi-Fi Saturday 6am-9am; buffered punches recovered intact.', ask: 'Both timecards show Saturday now. Made it before the payroll cutoff — thank you!', fix: 'Punches recovered with original timestamps and payroll ran correctly. The clock now alerts us when it goes offline instead of silently buffering.' } },
    { s: 'Job requisition for {dept}', d: 'Need to open a requisition for a backfill in {dept}. Role description attached — hoping to post this week.', t: 'request',
      c: { reply: 'Requisition entered from your role description and routed for approval — typically two days, then it posts automatically to the careers page and job boards.', ask: 'Approvals came through — saw it live on the careers page this morning.', fix: 'Requisition approved and posted internally and externally. Applicant routing set to you and the hiring panel.' } },
    { s: 'Training record correction', d: 'I completed the forklift recertification last month but the training system still shows me expired, which blocks warehouse access.', t: 'incident', pri: [5, 40, 45, 10],
      c: { reply: 'Your recert completion is in the trainer\'s paper log but never got entered in the system. Entering it now with the actual completion date — warehouse access restores as soon as it saves.', note: 'Trainer\'s batch entry from that session missed three people; correcting all three, not just this report.', ask: 'Badge works at the warehouse door again. Thanks!', fix: 'Training record corrected with the true completion date and warehouse access restored. The other two people from the same session were fixed proactively.' } },
  ],
  Quality: [
    { s: 'Quality hold on received lot', d: 'Incoming inspection flagged date-code mixing in a {vendor} lot. Need disposition — two orders are allocated against this stock.', t: 'incident', pri: [10, 50, 35, 5],
      c: { reply: 'Reviewing the lot now — segregating by date code and checking both allocated orders\' requirements. If either customer allows the older date code, we can disposition quickly.', note: 'Lot splits 60/40 across two date codes, both within acceptable range for one order; the second customer requires single date code — covering from another lot.', ask: 'Both customers\' requirements confirmed with the reps.', fix: 'Lot dispositioned: segregated by date code, one order shipped from the compliant portion, the second covered from clean stock. Supplier notified about the mixed-lot packaging.' } },
    { s: 'RoHS cert request from customer', d: 'Customer needs RoHS/REACH certs for all parts on last month\'s orders before their audit next week.', t: 'request', pri: [0, 35, 50, 15],
      c: { reply: 'Pulling the part list from last month\'s orders and generating the RoHS/REACH cert package — most certs are on file, chasing the vendor for the two that aren\'t.', note: 'Two parts needed fresh vendor declarations; both received within a day.', ask: 'Audit is Tuesday — package by Friday would be ideal.', fix: 'Complete cert package delivered Friday, ahead of the customer\'s audit. The two missing vendor declarations are now on file for future requests.' } },
    { s: 'RMA quality disposition overdue', d: 'An RMA has been sitting in quality review for ten days. Customer wants a failure-analysis update.', t: 'incident', pri: [5, 40, 45, 10],
      c: { reply: 'The RMA was waiting on test equipment that freed up yesterday — analysis is running now. Interim update to the customer today, full disposition by Thursday.', note: 'Backlog on the test bench pushed this past target; analysis shows customer-side overvoltage, not a part defect. Documenting with scope captures.', ask: 'Customer appreciated the interim update — they can wait for Thursday.', fix: 'Failure analysis complete: overvoltage damage from the application side, documented with test data. Report sent to the customer; disposition closed as no-defect-found with goodwill credit offered by sales.' } },
  ],
  Facilities: [
    { s: 'Badge not working at side entrance', d: 'My badge stopped working at the {loc} side entrance. Works at the main door. Started yesterday.', t: 'incident', pri: [0, 15, 55, 30],
      c: { reply: 'The side-entrance reader dropped off the access controller yesterday — your badge is fine. Rebooting the reader panel now.', note: 'Reader offline since yesterday\'s brief power blip; panel rebooted and re-enrolled with the controller.', ask: 'Badged through the side entrance this morning without a hitch.', fix: 'Reader panel restored and verified with multiple badges. Added the door controllers to power-monitoring so a blip pages us instead of stranding people.' } },
    { s: 'Desk move request', d: 'Our {dept} team is consolidating — need 4 desks moved to the north side of {loc}, ideally before month-end.', t: 'request', pri: [0, 5, 50, 45],
      c: { reply: 'Scheduling the move for Friday after 3pm so nobody works in a construction zone: desks, monitors, and network patching all in one pass.', ask: 'Friday works — team will pack their desks Thursday night.', fix: 'All four desks moved and re-patched Friday evening. Team sat down Monday with everything working — network, phones, and monitors verified before we left.' } },
    { s: 'Conference room display broken', d: 'The display in the large conference room won\'t detect laptops. Customer visit scheduled Thursday.', t: 'incident', pri: [5, 35, 50, 10],
      c: { reply: 'Tested the room — the HDMI input board on the display has failed; the wireless-cast input still works. Loaner display goes in tomorrow so Thursday\'s customer visit is covered either way.', ask: 'Thursday\'s meeting went smoothly on the loaner. Thanks for the quick swap.', fix: 'Display repaired under warranty (input board replaced) and re-installed. Loaner returned. Both HDMI and wireless casting verified.' } },
    { s: 'Too hot in the office', d: 'The {dept} area at {loc} has been 80+ degrees for two days. Multiple complaints. AC vents blowing warm air.', t: 'incident', pri: [5, 30, 50, 15],
      c: { reply: 'HVAC vendor is on-site this afternoon — early read is a failed damper actuator serving your zone, which explains warm air only on that side. Portable coolers coming up meanwhile.', note: 'Vendor confirmed the zone damper actuator failed closed on the cooling side; part on the truck, replaced same visit.', ask: 'Coolers are helping. It\'s survivable now.', fix: 'Damper actuator replaced and the zone is holding 72°F again. Coolers collected. The unit is on the vendor\'s quarterly preventive-maintenance list now.' } },
    { s: 'New hire badge and desk', d: 'New {dept} hire needs a badge with warehouse access and a desk assignment near their team.', t: 'request',
      c: { reply: 'Badge is being printed with the warehouse access profile, and there\'s an open desk two seats from their team lead — assigning it and prepping it with a dock and chair.', ask: 'Desk location is perfect. They start Monday.', fix: 'Badge issued and tested at both office and warehouse doors; desk assigned and set up. New hire was fully operational on day one.' } },
  ],
};

export const AGENT_COMMENTS = [
  'Taking a look at this now — will update shortly.',
  'I was able to reproduce the issue. Working on a fix.',
  'Can you try again now and let me know if it\'s any better?',
  'Escalating this to the vendor — will keep this ticket updated.',
  'Remoted into the machine and applied the fix. Please verify on your end.',
  'This should be resolved now. Closing the ticket — reply if it comes back.',
  'Ordered the replacement part; ETA is 2-3 business days.',
  'Applied the requested access. Please log out and back in to pick up the change.',
];

export const INTERNAL_NOTES = [
  'Event logs show repeated disconnects from the AP in that zone. Suspect the AP is failing.',
  'Same issue as three earlier tickets this month — adding to the recurring-problem list.',
  'Requester is a VIP — prioritizing accordingly.',
  'Waiting on vendor case #48213 before we can proceed.',
  'License pool was exhausted; freed two seats from departed users.',
  'Checked with the network team — no changes on their side this week.',
];

export const REQUESTER_REPLIES = [
  'Thanks — that fixed it!',
  'Still seeing the same problem after trying that, unfortunately.',
  'Any update on this? It\'s becoming more urgent on our side.',
  'That works. Appreciate the quick turnaround.',
  'Adding a bit more detail: it only seems to happen in the mornings.',
];

export const KB_ARTICLES: { title: string; body: string }[] = [
  {
    title: 'How to connect to the VPN',
    body: 'Open the ZScaler client from the system tray and sign in with your Microsoft account, approving the MFA prompt.\n\nIf the client repeatedly disconnects, first test your home internet stability, then try switching the client to the TCP fallback profile under Settings. If issues persist across networks, open a ticket with the Network & VPN category and include the approximate times of the drops.',
  },
  {
    title: 'Resetting your password with self-service',
    body: 'Go to passwordreset.microsoftonline.com, enter your work email, and verify with your authenticator app or backup phone number. Choose a passphrase of at least 14 characters and store it in Keeper — never in a browser\'s built-in password manager.\n\nAfter resetting, update the saved password on your mobile devices immediately — a stale saved password is the most common cause of account lockouts. If you are locked out, wait 15 minutes for the lockout to clear before trying the new password. Keeper master password resets require a Security ticket with manager verification.',
  },
  {
    title: 'Mapping an office printer',
    body: 'Open Settings > Printers, click Add Device, and select the printer named for your floor and area (for example SALES-RICOH-2F). Printers are location-restricted, so map the one physically nearest your desk.\n\nFor warehouse Zebra label printers, do not map them directly — label printing is configured through the pack station software. Open a ticket with Printing & Labels if a pack station cannot print.',
  },
  {
    title: 'Fixing TMP folder / M: drive access (\\\\windx\\tmp)',
    body: 'When the TMP share (the M: drive, \\\\windx\\tmp) will not connect, the usual cause is the SMB security-signature requirement on the workstation. The fix is a registry change and requires administrator rights — IT staff only.\n\nOpen Registry Editor (regedit) and navigate to HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\LanmanWorkstation\\Parameters — you can copy and paste the path into the address bar, keeping "Computer\\" at the front. Look for a value named RequireSecuritySignature. If it is not there, create it: right-click the background of the right-hand pane, choose New > DWORD (32-bit) Value, and name it RequireSecuritySignature. Set its value to 0.\n\nReboot the machine (or restart the Workstation service) and reconnect to \\\\windx\\tmp. If the M: drive still does not appear, re-map it: File Explorer > This PC > Map network drive > choose M: and enter \\\\windx\\tmp.',
  },
  {
    title: 'Enrolling a new phone in MFA',
    body: 'Before wiping or trading in your old phone, sign in to mysignins.microsoft.com/security-info from a computer, choose Add sign-in method, and enroll the new phone\'s authenticator app. Keep both enrolled until the new phone confirms a successful push.\n\nIf you already lost access to the old phone, open a Security ticket for an MFA reset — identity verification with your manager is required.',
  },
  {
    title: 'RF scanner basic troubleshooting',
    body: 'If a scanner will not connect: restart it, verify airplane mode is off, and check whether nearby scanners work — if they do not, it is a wireless issue in that zone and should be reported immediately with the aisle number.\n\nFor scanning errors on specific bins, log the bin number and try an adjacent bin first. Cracked or physically damaged units should be swapped with a spare from the supervisor cabinet and reported for repair.',
  },
  {
    title: 'Requesting access to shared drives and mailboxes',
    body: 'Access requests require your manager\'s approval. Submit a ticket with the Access & Accounts category naming the exact resource (drive path or mailbox address) and attach or forward the approval.\n\nAccess mirroring ("give me what my teammate has") is supported for role changes — name the teammate and effective date. Access is reviewed quarterly, so unused permissions may be removed automatically.',
  },
  {
    title: 'Outlook: common email delivery issues',
    body: 'If external senders report bounces, check your mailbox size under File > Tools > Mailbox Cleanup — a full mailbox rejects mail. Archive or empty Deleted Items to free space quickly.\n\nIf a specific sender\'s mail never arrives, check Junk Email and ask them to verify the exact address. For anything mentioning quarantine, forward the notification to a ticket so the security team can release legitimate messages.',
  },
  {
    title: 'MERP: resolving stuck EDI transactions',
    body: 'EDI failures appear in the EDI error queue with a reason code. For data errors (missing part cross-reference, bad unit of measure), correct the source record and requeue the transaction. For connection errors, verify the trading-partner status page before retrying.\n\nASN (856) failures are time-sensitive because partners require them before receipt — treat these as high priority and include the partner name and PO numbers in the ticket.',
  },
  {
    title: 'Zoom call quality checklist',
    body: 'Use a wired headset where possible, and if on Wi-Fi, sit within sight of an access point. Check Zoom > Settings > Audio to confirm the right microphone is selected — laptop mics pick up keyboard noise.\n\nFor conference rooms, restart the Zoom Rooms controller from its settings menu if it freezes. If calls degrade at the same times daily, note the pattern in your ticket; scheduled backups and large file syncs are common causes the network team can shift.',
  },
  {
    title: 'New hire IT setup: what to request and when',
    body: 'Submit onboarding tickets at least 5 business days before the start date. Include: start date, department, manager, desk location, and any non-standard software. Standard setup includes a laptop, account, email, phone extension, and badge.\n\nMERP, CRM, and Power BI access are provisioned separately and need the role or a teammate to mirror. Late requests are handled best-effort and often mean a loaner laptop for week one.',
  },
  {
    title: 'Reporting a phishing or suspicious email',
    body: 'Use the Report Phishing button in Outlook — it submits the full message headers, which forwarding does not. Do not click links, open attachments, or reply, even to unsubscribe.\n\nIf you clicked a link or entered credentials, change your password immediately and open a Security ticket marked urgent. Fast reporting materially limits damage; you will not get in trouble for reporting or for having clicked.',
  },
  {
    title: 'Requesting a new report or dashboard',
    body: 'Include the business question, the audience, the needed refresh frequency, and an example (even a rough spreadsheet) of the desired output. Name the source systems if known — MERP, CRM, or both.\n\nOne-time extracts are usually turned around within 2-3 business days. Recurring dashboards go through a short scoping conversation to confirm definitions (what counts as an "open order" differs by team more than you would expect).',
  },
  {
    title: 'Badge access: requests and issues',
    body: 'Badge problems at a single door usually mean the door controller, not your badge — report the specific door and time. Problems at every door mean a badge or profile issue; visit the front desk for a temporary badge.\n\nWarehouse access requires a safety briefing before it can be added to a badge profile. Requests need manager approval and take one business day after the briefing.',
  },
  {
    title: 'Getting software installed or licensed',
    body: 'Check the Company Portal first — pre-approved software installs immediately without a ticket. For anything else, submit a Software request with the product name, business justification, and manager approval.\n\nPaid licenses are inventoried; reassignment from departed users is faster than new purchases. Unapproved installers are blocked by policy, so do not download vendor installers directly.',
  },
];
