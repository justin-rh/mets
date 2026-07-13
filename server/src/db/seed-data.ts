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

export const LOCATIONS = ['Phoenix HQ', 'Phoenix Warehouse', 'remote', 'the Dallas branch office'];

export const APPS = ['MERP', 'Salesforce', 'Power BI', 'Excel', 'Outlook', 'Teams', 'SharePoint', 'Concur', 'ADP'];
export const VENDORS = ['TTI', 'Arrow', 'Digi-Key', 'a key supplier', 'our freight carrier'];
export const DEVICES = ['Dell Latitude laptop', 'desktop', 'second monitor', 'docking station', 'Surface Pro', 'desk phone'];
export const PRINTERS = ['the Sales floor Ricoh', 'the Accounting HP printer', 'the shipping label Zebra ZT411', 'the receiving-dock Zebra'];
export const REPORTS = ['open orders report', 'daily bookings dashboard', 'inventory aging report', 'commissions report', 'backlog by supplier report'];

// Six queues. Owning queue is single by design; tags cover cross-cutting.
export const QUEUES = [
  { slug: 'it-support', name: 'IT Support', description: 'General helpdesk: hardware, software, email, printing, phones', policy: 'round_robin' },
  { slug: 'infra-network', name: 'Infrastructure & Network', description: 'Network, VPN, servers, warehouse wireless and RF equipment', policy: 'load_based' },
  { slug: 'merp', name: 'MERP', description: 'MERP — the in-house ERP: order entry, inventory, pricing, EDI, patches', policy: 'manual' },
  { slug: 'apps-erp', name: 'Business Applications', description: 'Salesforce, quoting tools, and other business applications and integrations', policy: 'manual' },
  { slug: 'security-access', name: 'Security & Access', description: 'Account access, permissions, MFA, security incidents', policy: 'round_robin' },
  { slug: 'data-reporting', name: 'Data & Reporting', description: 'Reports, dashboards, data extracts, Power BI', policy: 'manual' },
  { slug: 'facilities', name: 'Facilities', description: 'Badges, desks, HVAC, office equipment moves', policy: 'manual' },
] as const;

// Descriptions double as AI-classifier prompt content later.
export const CATEGORIES: { name: string; queue: string; description: string }[] = [
  { name: 'Hardware', queue: 'it-support', description: 'Laptops, desktops, monitors, docks, peripherals — breakage, replacement, new equipment requests' },
  { name: 'Software', queue: 'it-support', description: 'Application installs, licenses, updates, errors in desktop software' },
  { name: 'Email & Collaboration', queue: 'it-support', description: 'Outlook, Teams, SharePoint, calendars, distribution lists' },
  { name: 'Printing & Labels', queue: 'it-support', description: 'Office printers and warehouse label printers (Zebra), print queues, toner' },
  { name: 'Phones & Mobile', queue: 'it-support', description: 'Desk phones, softphones, company mobile devices' },
  { name: 'Onboarding & Offboarding', queue: 'it-support', description: 'New hire setup, departures, equipment provisioning, account lifecycle' },
  { name: 'Network & VPN', queue: 'infra-network', description: 'Connectivity, Wi-Fi, VPN access and performance, site-to-site links' },
  { name: 'Warehouse Tech', queue: 'infra-network', description: 'RF scanners, warehouse wireless, label print stations, conveyor-adjacent systems' },
  { name: 'MERP', queue: 'merp', description: 'MERP, the in-house ERP: order entry, inventory, pricing, EDI transactions, user accounts, patches and performance' },
  { name: 'Business Apps', queue: 'apps-erp', description: 'Salesforce, quoting tools, and integrations between business systems (excluding MERP itself)' },
  { name: 'Access & Accounts', queue: 'security-access', description: 'Password resets, account lockouts, permission/share access requests, group membership' },
  { name: 'Security', queue: 'security-access', description: 'Phishing reports, suspicious activity, MFA problems, security policy questions' },
  { name: 'Data & Reporting', queue: 'data-reporting', description: 'Report requests and fixes, dashboards, data extracts, Power BI access' },
  { name: 'Facilities', queue: 'facilities', description: 'Badge access, desk moves, office equipment, HVAC and building issues' },
];

export const TAGS = [
  'vpn', 'onboarding', 'printer', 'merp', 'edi', 'rf-scanner', 'salesforce',
  'phishing', 'new-hire', 'hardware-refresh', 'project-falcon', 'warehouse',
  'exec-visibility', 'recurring',
];

export const SKILLS = [
  'Windows', 'Networking', 'VPN', 'MERP', 'EDI', 'Salesforce', 'Power BI',
  'M365', 'Security', 'Zebra Printers', 'RF Scanners', 'Telephony',
];

export type TicketTemplate = {
  s: string; // subject
  d: string; // description
  t: 'incident' | 'request' | 'change';
  pri?: number[]; // weights for P1..P4; default [5, 20, 55, 20]
};

export const TEMPLATES: Record<string, TicketTemplate[]> = {
  Hardware: [
    { s: 'Laptop won\'t power on', d: 'My {device} won\'t turn on this morning. Power light blinks three times then nothing. I have a customer call at 2pm and everything is on this machine.', t: 'incident', pri: [10, 35, 45, 10] },
    { s: 'Replacement keyboard needed', d: 'Several keys on my keyboard are sticking (E, R, and space). Requesting a replacement. I sit at {loc}.', t: 'request' },
    { s: 'Second monitor request', d: 'Requesting a {device} for my desk. Working split-screen in {app} all day and one screen is killing productivity.', t: 'request', pri: [0, 5, 45, 50] },
    { s: 'Docking station not detecting monitors', d: 'Since this morning my dock only drives one of my two monitors. Tried re-plugging everything. Working from {loc}.', t: 'incident' },
    { s: 'Laptop running extremely slow', d: 'My laptop takes 10+ minutes to boot and {app} freezes constantly. Fan runs loud all day. Can someone take a look?', t: 'incident' },
    { s: 'New laptop for contractor', d: 'We have a contractor starting Monday in {dept} who needs a loaner laptop with standard apps plus {app}.', t: 'request', pri: [0, 25, 60, 15] },
  ],
  Software: [
    { s: '{app} license needed', d: 'I need a license for {app} for my role in {dept}. Manager has approved — can you install it on my machine?', t: 'request' },
    { s: '{app} crashes on startup', d: '{app} closes immediately after launching, started after the last update. Rebooted twice, same behavior.', t: 'incident' },
    { s: 'Adobe Acrobat can\'t combine PDFs', d: 'Getting an error when combining supplier datasheets into one PDF: "operation could not be completed." Worked last week.', t: 'incident' },
    { s: 'Excel add-in missing after update', d: 'Our pricing add-in disappeared from Excel after Windows updates last night. The whole {dept} team uses this daily.', t: 'incident', pri: [5, 40, 45, 10] },
    { s: 'Software update approval for {app}', d: 'Vendor released a critical patch for {app}. Requesting change approval to deploy to all {dept} machines this week.', t: 'change', pri: [5, 45, 45, 5] },
  ],
  'Email & Collaboration': [
    { s: 'Not receiving external emails', d: 'Customers say emails to me bounce with "recipient inbox full" but my mailbox looks fine. Missing quotes from {vendor} because of this.', t: 'incident', pri: [10, 45, 40, 5] },
    { s: 'Shared mailbox access request', d: 'I need access to the sales@ shared mailbox to cover for a teammate on leave. Manager approved.', t: 'request' },
    { s: 'Teams meeting audio cutting out', d: 'In every Teams call today my audio drops for a few seconds each minute. Wired connection at {loc}. Customers noticing.', t: 'incident' },
    { s: 'Distribution list update', d: 'Please add the three new {dept} hires to the {dept} distribution list and remove two people who left last month.', t: 'request', pri: [0, 5, 50, 45] },
    { s: 'Calendar delegation not working', d: 'I was set up as a delegate for my VP\'s calendar but can\'t see or create events. Permissions look right on my end.', t: 'incident' },
    { s: 'SharePoint site read-only for team', d: 'Our {dept} SharePoint site suddenly shows read-only for the whole team. We can\'t update the quote tracker.', t: 'incident', pri: [10, 40, 45, 5] },
  ],
  'Printing & Labels': [
    { s: '{printer} offline', d: '{printer} shows offline for everyone. Restarted it twice. Orders are stacking up at the pack stations.', t: 'incident', pri: [10, 40, 45, 5] },
    { s: 'Label alignment wrong on Zebra', d: 'Shipping labels printing shifted half an inch off the stock on {printer} — carrier scanner rejects them.', t: 'incident', pri: [10, 45, 40, 5] },
    { s: 'Printer mapping for new desk', d: 'Just moved desks at {loc} — please map me to {printer} and remove my old default.', t: 'request', pri: [0, 5, 45, 50] },
    { s: 'Toner replacement', d: '{printer} shows toner critically low and print quality is fading. Probably a day of toner left.', t: 'request', pri: [0, 10, 55, 35] },
  ],
  'Phones & Mobile': [
    { s: 'Desk phone no dial tone', d: 'My desk phone at {loc} has no dial tone since this morning. Softphone works but customers call my desk line directly.', t: 'incident' },
    { s: 'Company phone for new manager', d: 'Requesting a company mobile for our new {dept} manager starting next week, standard sales configuration.', t: 'request' },
    { s: 'Voicemail not transcribing', d: 'Voicemail-to-email stopped including transcriptions about a week ago. Attachments still arrive fine.', t: 'incident', pri: [0, 10, 50, 40] },
  ],
  'Onboarding & Offboarding': [
    { s: 'New hire setup — {dept}', d: 'New hire starting in {dept} on Monday. Needs laptop, {app} access, phone extension, and badge. Desk at {loc}.', t: 'request', pri: [5, 45, 45, 5] },
    { s: 'Offboarding — departure Friday', d: 'Team member in {dept} leaving Friday. Please schedule account disable, mailbox delegation to their manager, and equipment return.', t: 'request', pri: [5, 40, 50, 5] },
    { s: 'Intern batch setup for summer', d: 'Five interns starting next month in {dept}. Need loaner laptops and limited accounts. Full list attached.', t: 'request' },
  ],
  'Network & VPN': [
    { s: 'VPN disconnects every 20 minutes', d: 'Working from {loc}, VPN drops roughly every 20 minutes and takes 2-3 tries to reconnect. Home internet is stable otherwise.', t: 'incident' },
    { s: 'VPN access request', d: 'Requesting VPN access — starting a hybrid schedule next week per my manager in {dept}.', t: 'request' },
    { s: 'Wi-Fi dead zone near receiving', d: 'No usable Wi-Fi signal in the corner of the warehouse near receiving dock 4. Scanners and tablets both drop there.', t: 'incident', pri: [5, 35, 50, 10] },
    { s: 'Whole office intermittent internet', d: 'Internet at {loc} keeps dropping for 30-60 seconds at a time, affecting everyone. Started around 9am.', t: 'incident', pri: [40, 45, 15, 0] },
    { s: 'Firewall change for {vendor} portal', d: 'Requesting firewall allowance for the new {vendor} portal — {dept} can\'t reach the site from the office network.', t: 'change', pri: [0, 25, 60, 15] },
  ],
  'Warehouse Tech': [
    { s: 'RF scanner won\'t connect', d: 'Scanner unit 12 won\'t connect to Wi-Fi after reboot. Other scanners fine. Down a scanner during receiving rush.', t: 'incident', pri: [10, 45, 40, 5] },
    { s: 'RF scanner screen cracked', d: 'Dropped scanner unit 7, screen is cracked but still scans. Requesting replacement/repair before it dies completely.', t: 'request', pri: [0, 25, 55, 20] },
    { s: 'All scanners dropping in aisle 40', d: 'Every RF scanner loses connection in aisles 40-44. Pickers are walking out of the zone to sync. Slowing wave picking.', t: 'incident', pri: [25, 50, 25, 0] },
    { s: 'New pack station setup', d: 'Adding a pack station at {loc} — needs a workstation, {printer} connection, and scale integration.', t: 'request' },
    { s: 'Scanner OS update rollout', d: 'Vendor recommends firmware update for all RF scanners to fix the roaming bug. Requesting change window Sunday night.', t: 'change', pri: [5, 40, 50, 5] },
  ],
  MERP: [
    { s: 'MERP slow during order entry', d: 'Order entry screens in MERP taking 15-20 seconds per save since yesterday. Whole {dept} team affected during peak entry.', t: 'incident', pri: [25, 50, 25, 0] },
    { s: 'EDI 856 failing to {vendor}', d: 'ASNs to {vendor} failing since last night — 14 orders stuck in the EDI error queue. They require ASN before receipt.', t: 'incident', pri: [30, 50, 20, 0] },
    { s: 'New MERP user setup', d: 'Please set up a MERP account for a new {dept} member — mirror the permissions of their teammates.', t: 'request' },
    { s: 'MERP patch deployment', d: 'Requesting approval to apply the latest MERP service pack in the Sunday maintenance window. Tested in the sandbox.', t: 'change', pri: [5, 50, 40, 5] },
    { s: 'Price list import failed', d: 'The {vendor} price list import failed at row 8,000 with a data type error. New pricing goes live Monday.', t: 'incident', pri: [10, 50, 35, 5] },
  ],
  'Business Apps': [
    { s: 'Salesforce opportunity sync stuck', d: 'Opportunities updated in Salesforce aren\'t syncing to MERP. Sync log shows errors since about 7am.', t: 'incident', pri: [10, 50, 35, 5] },
    { s: 'Quote tool rounding wrong', d: 'The quoting tool rounds extended prices differently than MERP, causing pennies-off discrepancies on large-quantity quotes.', t: 'incident', pri: [0, 30, 55, 15] },
    { s: 'Concur expense report stuck in approval', d: 'An expense report has been sitting in Pending Approval for two weeks; the listed approver left the company last month.', t: 'incident', pri: [0, 20, 55, 25] },
    { s: 'Salesforce access for new rep', d: 'New {dept} team member needs a Salesforce license and addition to the regional sharing group.', t: 'request' },
  ],
  'Access & Accounts': [
    { s: 'Account locked out', d: 'Locked out of my account after password change on my phone. Can\'t log into anything. Calling from a teammate\'s desk.', t: 'incident', pri: [10, 45, 40, 5] },
    { s: 'Password reset', d: 'Forgot my password after vacation. Need a reset — I\'m at {loc} and can verify identity however needed.', t: 'incident', pri: [5, 30, 55, 10] },
    { s: 'Shared drive access request', d: 'Need access to the {dept} shared drive for the {report}. Manager approved via email (attached).', t: 'request' },
    { s: 'Permission mirror for role change', d: 'Moving from {dept} to a new role — please mirror the access of my new team, effective next Monday.', t: 'request' },
    { s: 'Service account for integration', d: 'The {app} integration needs a service account with read access to the orders tables. Details in the attached spec.', t: 'change', pri: [0, 30, 55, 15] },
  ],
  Security: [
    { s: 'Phishing email reported', d: 'Received a suspicious email claiming to be from {vendor} asking to update banking details. Several teammates got it too. Not clicked.', t: 'incident', pri: [20, 55, 25, 0] },
    { s: 'Clicked a suspicious link', d: 'I clicked a link in an email that looked like a DocuSign request before realizing it was fake. Changed my password immediately. What else should I do?', t: 'incident', pri: [45, 45, 10, 0] },
    { s: 'MFA prompts not arriving', d: 'Authenticator push notifications stopped arriving on my phone. Can\'t approve sign-ins; using backup codes for now.', t: 'incident', pri: [5, 45, 45, 5] },
    { s: 'New phone — MFA transfer', d: 'Got a new phone and need to move my authenticator enrollment over before my old phone gets wiped.', t: 'request', pri: [0, 25, 60, 15] },
    { s: 'USB port policy exception', d: '{dept} needs a policy exception to use a vendor-provided USB tool for firmware updates on test equipment.', t: 'change', pri: [0, 25, 55, 20] },
  ],
  'Data & Reporting': [
    { s: '{report} showing wrong numbers', d: 'The {report} totals don\'t match MERP for yesterday — off by about 4%. Leadership reviews this every morning.', t: 'incident', pri: [10, 50, 35, 5] },
    { s: 'New dashboard request', d: '{dept} would like a Power BI dashboard for the {report}, refreshed daily, filterable by branch and salesperson.', t: 'request' },
    { s: 'Power BI access request', d: 'Requesting Power BI access to view the {report}. My whole team has it; I was missed in the last batch.', t: 'request', pri: [0, 5, 50, 45] },
    { s: 'Scheduled report stopped sending', d: 'The 6am {report} email hasn\'t arrived for three days. It drives our morning {dept} standup.', t: 'incident', pri: [5, 45, 45, 5] },
    { s: 'One-time data extract', d: 'Need an extract of all orders with {vendor} parts for the last 18 months for a supplier negotiation next week.', t: 'request', pri: [0, 30, 55, 15] },
  ],
  Facilities: [
    { s: 'Badge not working at side entrance', d: 'My badge stopped working at the {loc} side entrance. Works at the main door. Started yesterday.', t: 'incident', pri: [0, 15, 55, 30] },
    { s: 'Desk move request', d: 'Our {dept} team is consolidating — need 4 desks moved to the north side of {loc}, ideally before month-end.', t: 'request', pri: [0, 5, 50, 45] },
    { s: 'Conference room display broken', d: 'The display in the large conference room won\'t detect laptops. Customer visit scheduled Thursday.', t: 'incident', pri: [5, 35, 50, 10] },
    { s: 'Too hot in the office', d: 'The {dept} area at {loc} has been 80+ degrees for two days. Multiple complaints. AC vents blowing warm air.', t: 'incident', pri: [5, 30, 50, 15] },
    { s: 'New hire badge and desk', d: 'New {dept} hire needs a badge with warehouse access and a desk assignment near their team.', t: 'request' },
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
    body: 'Open the GlobalProtect client from the system tray and enter portal.masterelectronics.com, then sign in with your Microsoft account and approve the MFA prompt.\n\nIf the client repeatedly disconnects, first test your home internet stability, then try switching the client from UDP to TCP mode under Settings. If issues persist across networks, open a ticket with the Network & VPN category and include the approximate times of the drops.',
  },
  {
    title: 'Resetting your password with self-service',
    body: 'Go to passwordreset.microsoftonline.com, enter your work email, and verify with your authenticator app or backup phone number. Choose a passphrase of at least 14 characters.\n\nAfter resetting, update the saved password on your mobile devices immediately — a stale saved password is the most common cause of account lockouts. If you are locked out, wait 15 minutes for the lockout to clear before trying the new password.',
  },
  {
    title: 'Mapping an office printer',
    body: 'Open Settings > Printers, click Add Device, and select the printer named for your floor and area (for example SALES-RICOH-2F). Printers are location-restricted, so map the one physically nearest your desk.\n\nFor warehouse Zebra label printers, do not map them directly — label printing is configured through the pack station software. Open a ticket with Printing & Labels if a pack station cannot print.',
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
    title: 'Teams call quality checklist',
    body: 'Use a wired headset where possible, and if on Wi-Fi, sit within sight of an access point. Check Teams > Settings > Devices to confirm the right microphone is selected — laptop mics pick up keyboard noise.\n\nIf calls degrade at the same times daily, note the pattern in your ticket; scheduled backups and large file syncs are common causes the network team can shift.',
  },
  {
    title: 'New hire IT setup: what to request and when',
    body: 'Submit onboarding tickets at least 5 business days before the start date. Include: start date, department, manager, desk location, and any non-standard software. Standard setup includes a laptop, account, email, phone extension, and badge.\n\nMERP, Salesforce, and Power BI access are provisioned separately and need the role or a teammate to mirror. Late requests are handled best-effort and often mean a loaner laptop for week one.',
  },
  {
    title: 'Reporting a phishing or suspicious email',
    body: 'Use the Report Phishing button in Outlook — it submits the full message headers, which forwarding does not. Do not click links, open attachments, or reply, even to unsubscribe.\n\nIf you clicked a link or entered credentials, change your password immediately and open a Security ticket marked urgent. Fast reporting materially limits damage; you will not get in trouble for reporting or for having clicked.',
  },
  {
    title: 'Requesting a new report or dashboard',
    body: 'Include the business question, the audience, the needed refresh frequency, and an example (even a rough spreadsheet) of the desired output. Name the source systems if known — MERP, Salesforce, or both.\n\nOne-time extracts are usually turned around within 2-3 business days. Recurring dashboards go through a short scoping conversation to confirm definitions (what counts as an "open order" differs by team more than you would expect).',
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
