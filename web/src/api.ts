export type StatusInfo = { id: number; name: string; category: string };
export type QueueInfo = { id: number; name: string; slug: string; assignmentPolicy: string; openCount: number };
export type AgentInfo = {
  id: number; name: string; openCount: number; maxOpen: number; isAvailable: boolean;
  teamIds: number[]; leadOf: number[];
  skills: { id: number; name: string; level: number; source: 'auto' | 'manual' }[];
};
export type Meta = {
  statuses: StatusInfo[]; queues: QueueInfo[]; agents: AgentInfo[];
  tags: { id: number; name: string }[]; categories: { id: number; name: string }[];
};

export type SlaInfo = { state: 'running' | 'paused' | 'completed' | 'breached'; targetAt: string; warnAt: string | null };

export type TicketListItem = {
  id: number; number: string; type: 'incident' | 'request' | 'change';
  subject: string; priority: number; score: number;
  createdAt: string; updatedAt: string;
  snoozedUntil: string | null; snoozeReason: string | null;
  status: StatusInfo; queue: { id: number; name: string };
  requester: { id: number; name: string; isVip: boolean };
  assignee: { id: number; name: string } | null;
  submittedBy: { id: number; name: string } | null;
  category: string | null; tags: string[]; sla: SlaInfo | null;
  flags: { term: string; boost: number }[];
  sentiment: 'frustrated' | 'urgent' | null;
  shouting: boolean;
};

export type Comment = {
  id: number; visibility: 'public' | 'internal'; bodyText: string;
  source: string; createdAt: string; author: { id: number; name: string };
};
export type TicketEvent = {
  id: number; actorType: string; eventType: string; field: string | null;
  oldValue: string | null; newValue: string | null; createdAt: string; actorName: string | null;
};
export type TicketDetail = TicketListItem & {
  description: string; manualBoost: number; source: string;
  legacyNumber: string | null; // original ServiceNow number, when imported
  firstRespondedAt: string | null; resolvedAt: string | null;
  requester: { id: number; name: string; isVip: boolean; department: string | null; email: string };
  comments: Comment[]; events: TicketEvent[]; sla: any[];
  approvals: TicketApproval[];
  csatRating: number | null; csatComment: string | null;
  watching: boolean; watcherCount: number;
  watchers: { id: number; name: string }[];
  attachments: Attachment[];
  incident: {
    parent: { id: number; number: string; subject: string } | null;
    mergedInto: { id: number; number: string; subject: string } | null;
    children: { id: number; number: string; subject: string; status: string }[];
    duplicates: { id: number; number: string; subject: string }[];
  };
};

export type IdentifierCheck = {
  conflict: boolean; shared: string[];
  onlyInSource: string[]; onlyInTarget: string[];
};
export type MergeCandidate = {
  id: number; number: string; subject: string; requester: string;
  similarity: number; check: IdentifierCheck;
};
export const fetchMergeCandidates = (id: number) =>
  api<MergeCandidate[]>(`/api/tickets/${id}/merge-candidates`);
export const mergeTicket = (id: number, targetId: number, force = false) =>
  api<{ merged: boolean; requiresConfirmation?: boolean; target?: string; check: IdentifierCheck }>(
    `/api/tickets/${id}/merge`,
    { method: 'POST', body: JSON.stringify({ targetId, force }) },
  );

export const flagTicket = (id: number, flag: {
  kind: 'wrong_category' | 'needs_approval' | 'misrouted' | 'wrong_user';
  categoryId?: number; userId?: number; note?: string;
}) =>
  api<{ ok: boolean; message: string }>(`/api/tickets/${id}/flag`, {
    method: 'POST', body: JSON.stringify(flag),
  });

export const submitCsat = (id: number, rating: number, comment?: string) =>
  api<{ ok: boolean; rating: number }>(`/api/tickets/${id}/csat`, {
    method: 'POST', body: JSON.stringify({ rating, comment: comment || undefined }),
  });

export type TicketApproval = {
  id: number; state: 'pending' | 'approved' | 'rejected'; note: string | null;
  approverId: number; approverName: string; targetQueue: string | null;
  decidedAt: string | null; decidedByName: string | null;
};

export type TicketChanges = {
  assigneeId?: number | null; queueId?: number; statusId?: number;
  priority?: number; snooze?: { until: string; reason: string } | null;
};

export type ListParams = {
  view: 'open' | 'mine' | 'unassigned' | 'my_queues' | 'snoozed' | 'closed' | 'all';
  queueId?: number; assigneeId?: number; requesterId?: number;
  sort: string; search?: string; limit?: number;
  categoryId?: number; tags?: string;
  olderThanDays?: number; newerThanDays?: number;
  priorityAtMost?: number; unassigned?: '1'; myQueues?: '1';
};

export type NlFilters = Partial<Pick<ListParams,
  'view' | 'queueId' | 'categoryId' | 'tags' | 'olderThanDays' | 'newerThanDays' | 'priorityAtMost' | 'unassigned' | 'search'>>;
export const parseSearch = (query: string) =>
  api<{ interpretation: string; confidence: number; filters: NlFilters }>(
    '/api/search/parse', { method: 'POST', body: JSON.stringify({ query }) });

export function actingUserId(): number {
  return Number(localStorage.getItem('mets-user') ?? '1');
}
export function setActingUserId(id: number) {
  localStorage.setItem('mets-user', String(id));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // dev: the acting-as header. entra: a real Microsoft ID token.
  const { isEntra, getIdToken } = await import('./auth');
  const authHeaders: Record<string, string> = isEntra
    ? { authorization: `Bearer ${(await getIdToken()) ?? ''}` }
    : { 'x-user-id': String(actingUserId()) };
  const res = await fetch(path, {
    ...init,
    headers: {
      // content-type only when there is a body — Fastify 400s on an
      // empty JSON body (e.g. bare DELETEs)
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...authHeaders,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const fetchMeta = () => api<Meta>('/api/meta');

export type ActiveIncident = {
  id: number; number: string; title: string; status: string;
  queue: string; childCount: number; createdAt: string;
};
export const fetchActiveIncidents = () => api<ActiveIncident[]>('/api/incidents/active');

export function fetchTickets(p: ListParams) {
  const q = new URLSearchParams({ view: p.view, sort: p.sort });
  if (p.queueId) q.set('queueId', String(p.queueId));
  if (p.assigneeId) q.set('assigneeId', String(p.assigneeId));
  if (p.requesterId) q.set('requesterId', String(p.requesterId));
  if (p.search) q.set('search', p.search);
  if (p.limit) q.set('limit', String(p.limit));
  if (p.categoryId) q.set('categoryId', String(p.categoryId));
  if (p.tags) q.set('tags', p.tags);
  if (p.olderThanDays) q.set('olderThanDays', String(p.olderThanDays));
  if (p.newerThanDays) q.set('newerThanDays', String(p.newerThanDays));
  if (p.priorityAtMost) q.set('priorityAtMost', String(p.priorityAtMost));
  if (p.unassigned) q.set('unassigned', p.unassigned);
  if (p.myQueues) q.set('myQueues', p.myQueues);
  return api<TicketListItem[]>(`/api/tickets?${q}`);
}

export const fetchTicket = (id: number) => api<TicketDetail>(`/api/tickets/${id}`);

export const patchTicket = (id: number, changes: TicketChanges) =>
  api(`/api/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });

export const bulkTickets = (ticketIds: number[], action: 'update' | 'auto_assign' | 'expertise_assign' | 'mentioned_assign', changes?: TicketChanges) =>
  api('/api/tickets/bulk', { method: 'POST', body: JSON.stringify({ ticketIds, action, changes }) });

export const postComment = (id: number, bodyText: string, visibility: 'public' | 'internal') =>
  api(`/api/tickets/${id}/comments`, { method: 'POST', body: JSON.stringify({ bodyText, visibility }) });

// --- AI ---

export type TriageResult = {
  category: string; queueSlug: string; priority: number;
  sentiment: string; summary: string;
  reasoning?: string; // absent on enrichments from before triage-v5
  confidence: { category: number; queue: number; priority: number };
};

export type Enrichment = {
  id: number; ticketId: number; feature: string; status: string;
  model: string; promptVersion: string;
  result: TriageResult; confidence: TriageResult['confidence'];
  createdAt: string;
};

export type TriageSuggestion = {
  enrichment: Enrichment;
  ticket: { id: number; number: string; subject: string; priority: number; score: number; createdAt: string; queueId: number; categoryId: number | null };
  queueName: string;
  categoryName: string | null;
  requesterName: string;
};

export const runTriage = (limit = 10) =>
  api<{ ticketId: number; ok: boolean; error?: string }[]>('/api/ai/triage', {
    method: 'POST', body: JSON.stringify({ limit }),
  });

export const fetchTriage = () => api<TriageSuggestion[]>('/api/ai/triage');

export const acceptEnrichment = (id: number, fields?: { category?: boolean; queue?: boolean; priority?: boolean }) =>
  api(`/api/ai/enrichments/${id}/accept`, { method: 'POST', body: JSON.stringify(fields ?? {}) });

export const dismissEnrichment = (id: number) =>
  api(`/api/ai/enrichments/${id}/dismiss`, { method: 'POST', body: JSON.stringify({}) });

export const correctEnrichment = (id: number, fix: { categoryId?: number; queueId?: number; priority?: number }) =>
  api(`/api/ai/enrichments/${id}/correct`, { method: 'POST', body: JSON.stringify(fix) });

export type AiDecision = {
  enrichment: Enrichment & { feedback: { original: any; corrected: any } | null };
  ticket: { id: number; number: string; subject: string; priority: number };
  currentQueue: string;
  currentCategory: string | null;
};
export type AiDecisionStats = {
  total: string; auto_applied: string; accepted: string;
  corrected: string; dismissed: string; pending: string;
};

export const fetchDecisions = () =>
  api<{ decisions: AiDecision[]; stats: AiDecisionStats }>('/api/ai/decisions');

export const createTicket = (data: {
  subject: string; description: string; type?: string; priority?: number;
  onBehalfOfId?: number; holdTriage?: boolean;
}) =>
  api<{ id: number; number: string }>('/api/tickets', { method: 'POST', body: JSON.stringify(data) });

export const triageNow = (id: number) =>
  api<{ ok: boolean }>(`/api/tickets/${id}/triage-now`, { method: 'POST', body: '{}' });

export type DirectoryUser = {
  id: number; name: string; role: string;
  department: string | null; location: string | null;
};
export const fetchUsers = () => api<DirectoryUser[]>('/api/users');

// --- Chat ---

export type ChatConversation = {
  partnerId: number; partnerName: string; isAvailable: boolean;
  unread: number; lastBody: string; lastFromMe: boolean; lastId: number; lastAt: string;
};
export type ChatMessage = {
  id: number; fromId: number; toId: number; body: string;
  readAt: string | null; createdAt: string;
};
export const fetchConversations = () => api<ChatConversation[]>('/api/chat/conversations');
export const fetchChatThread = (partnerId: number, markRead: boolean) =>
  api<ChatMessage[]>(`/api/chat/with/${partnerId}${markRead ? '?markRead=1' : ''}`);
export const sendChatMessage = (partnerId: number, body: string) =>
  api<ChatMessage>(`/api/chat/with/${partnerId}`, { method: 'POST', body: JSON.stringify({ body }) });

/** Open the chat drawer from anywhere (agent menu, ticket detail). */
export function openChat(detail: { partnerId?: number; prefill?: string }) {
  window.dispatchEvent(new CustomEvent('mets-chat', { detail }));
}

// --- Dashboard & KB ---

export type DashboardData = {
  tiles: {
    open_count: string; created_30: string; resolved_30: string;
    median_mttr_hours: number | null; median_frt_hours: number | null;
    sla_attainment_pct: string | null;
    csat_avg_30: string | null; csat_count_30: string;
    deflected_30: string; deflection_offered_30: string;
  };
  daily: { day: string; created: string; resolved: string }[];
  backlogAge: { bucket: string; count: string }[];
  openByQueue: { name: string; count: string }[];
  csatDist: { rating: number; count: string }[];
  ai: {
    tiles: {
      total_30: string; auto_30: string; accepted_30: string;
      corrected_30: string; dismissed_30: string;
      agreed_wk: string; judged_wk: string; agreed_prev: string; judged_prev: string;
    };
    byCategory: { category: string; decisions: string; corrected: string }[];
    usage: { feature: string; calls: string; input_tokens: string; output_tokens: string }[];
  };
};

export type LeaderboardRow = {
  id: number; name: string; resolved: string; tp: string;
  sla_pct: string | null; median_frt_hours: number | null;
  csat: string | null; csat_count: string;
};

export const fetchDashboard = () => api<DashboardData>('/api/dashboard');

export type Digest = {
  generatedAt: string;
  periodDays: number;
  result: {
    headline: string;
    findings: { kind: 'problem' | 'trend' | 'kb_gap' | 'ops'; title: string; detail: string; suggestedAction: string }[];
  };
};
export const fetchDigest = () => api<{ digest: Digest | null }>('/api/digest');
export const generateDigest = () => api<{ digest: Digest }>('/api/digest/generate', { method: 'POST', body: '{}' });
export const fetchLeaderboard = (days: number) =>
  api<{ days: number; rows: LeaderboardRow[] }>(`/api/dashboard/leaderboard?days=${days}`);

export type KbHit = { id: number; title: string; snippet: string; score: number };
export type KbDraft = { id: number; title: string; createdAt: string; sourceTicket: string | null };
export type KbIndex = {
  results: KbHit[] | null;
  articles: { id: number; title: string; updatedAt: string }[] | null;
  drafts: KbDraft[];
};
export type KbArticle = {
  id: number; title: string; bodyText: string; updatedAt: string;
  status: string; sourceTicket: string | null;
};

export const searchKb = (q: string) => api<KbIndex>(`/api/kb${q ? `?q=${encodeURIComponent(q)}` : ''}`);
export const fetchArticle = (id: number) => api<KbArticle>(`/api/kb/${id}`);
/** On-demand KB search seeded from the ticket's own text (agent-side). */
export const searchKbForTicket = (ticketId: number) => api<KbHit[]>(`/api/tickets/${ticketId}/kb-search`);
export const publishArticle = (id: number) =>
  api<KbArticle>(`/api/kb/${id}/publish`, { method: 'POST', body: '{}' });
export const discardArticle = (id: number) =>
  api(`/api/kb/${id}/discard`, { method: 'POST', body: '{}' });

export type Suggestions = {
  articles: KbHit[];
  similarTickets: { id: number; number: string; subject: string; resolved_at: string }[];
};
export const fetchSuggestions = (ticketId: number) => api<Suggestions>(`/api/tickets/${ticketId}/suggestions`);

export type ImportPreview = {
  importId: string; headers: string[]; mapping: Record<string, string>;
  rowCount: number; sample: Record<string, string>[]; warnings: string[];
};
export type ImportResult = {
  created: number; skippedDupes: number; requestersProvisioned: number;
  errors: { row: number; reason: string }[];
  openImported: number; triageQueued: number; triageRemaining: number;
};
export async function importPreview(file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append('file', file, file.name);
  const { isEntra, getIdToken } = await import('./auth');
  const authHeaders: Record<string, string> = isEntra
    ? { authorization: `Bearer ${(await getIdToken()) ?? ''}` }
    : { 'x-user-id': String(actingUserId()) };
  const res = await fetch('/api/admin/import/preview', { method: 'POST', body: form, headers: authHeaders });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}
export const importRun = (importId: string, mapping: Record<string, string>, runTriage: boolean) =>
  api<ImportResult>('/api/admin/import/run', {
    method: 'POST', body: JSON.stringify({ importId, mapping, runTriage }),
  });

export type VipEntry = {
  userId: number; name: string; department: string | null;
  global: boolean; queues: { id: number; name: string }[];
};
export const fetchVips = () => api<VipEntry[]>('/api/admin/vips');
export const addVip = (userId: number, teamId: number | null) =>
  api<{ ok: boolean; rescored: number }>('/api/admin/vips', {
    method: 'POST', body: JSON.stringify({ userId, teamId }),
  });
export const removeVip = (userId: number, teamId?: number) =>
  api<{ ok: boolean; rescored: number }>(
    `/api/admin/vips/${userId}${teamId != null ? `?teamId=${teamId}` : ''}`,
    { method: 'DELETE' },
  );

export type ApiKeyRow = {
  id: number; name: string; prefix: string;
  userId: number; userName: string; userRole: string;
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
};
export const fetchApiKeys = () => api<ApiKeyRow[]>('/api/admin/api-keys');
export const createApiKey = (name: string, userId: number) =>
  api<{ secret: string; key: ApiKeyRow }>('/api/admin/api-keys', {
    method: 'POST', body: JSON.stringify({ name, userId }),
  });
export const revokeApiKey = (id: number) =>
  api(`/api/admin/api-keys/${id}`, { method: 'DELETE' });

export type AdminUser = {
  id: number; name: string; role: string; isAvailable: boolean;
  queueVisibility: 'all' | 'own'; teamIds: number[]; leadTeamIds: number[];
};
export const fetchAdminUsers = () => api<AdminUser[]>('/api/admin/users');
export const updateUserQueues = (id: number, body: { teamIds?: number[]; queueVisibility?: 'all' | 'own' }) =>
  api(`/api/admin/users/${id}/queues`, { method: 'PATCH', body: JSON.stringify(body) });
export const updateUserRole = (id: number, role: 'admin' | 'agent' | 'readonly') =>
  api(`/api/admin/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
export const updateUserLead = (id: number, teamId: number, lead: boolean) =>
  api(`/api/admin/users/${id}/lead`, { method: 'PATCH', body: JSON.stringify({ teamId, lead }) });

export type AgentFit = {
  id: number; name: string; fit: number; level: number | null; inQueue: boolean;
  mentioned?: boolean; snippet?: string; // named in the ticket text — leads the list
};
export const fetchBestFits = (ticketId: number) => api<AgentFit[]>(`/api/tickets/${ticketId}/fit`);

export const draftReply = (ticketId: number) =>
  api<{ draft: string; groundedIn: string[] }>(`/api/tickets/${ticketId}/draft-reply`, { method: 'POST', body: '{}' });

export const decideApproval = (id: number, approve: boolean, note?: string) =>
  api<TicketApproval>(`/api/approvals/${id}/decision`, {
    method: 'POST', body: JSON.stringify({ approve, note }),
  });

export type RenderedTemplate = {
  id: number; name: string; body: string; categoryId: number | null; autoRespond: boolean;
};
export const fetchTicketTemplates = (ticketId: number) =>
  api<RenderedTemplate[]>(`/api/tickets/${ticketId}/templates`);

// --- Admin ---

export type AdminConfig = {
  scoreWeights: {
    priority: Record<string, number>;
    agePerBusinessDay: number; ageCap: number; vip: number;
    slaWarning: number; slaBreached: number; manualBoostRange: number;
  } | null;
  scoreKeywords: { term: string; boost: number }[];
  autoClose: { days: number };
  escalation: EscalationConfig;
  aiThresholds: { autoApply: number; suggest: number };
  businessHours: unknown;
  statuses: StatusInfo[];
  skills: { id: number; name: string }[];
  slaPolicies: { id: number; name: string; enabled: boolean; firstResponseMinutes: number | null; resolutionMinutes: number | null }[];
  routingRules: { id: number; name: string; position: number; enabled: boolean; conditions: unknown; actions: unknown }[];
  templates: ResponseTemplate[];
  categories: { id: number; name: string; requiresApproval: boolean }[];
  queueNotifications: { id: number; name: string; notifyEmails: string | null }[];
  recurring: RecurringTicket[];
};

export type RecurringTicket = {
  id: number; name: string; subject: string; type: string;
  frequency: string; enabled: boolean;
  nextRunAt: string; lastRunAt: string | null;
};
export const addRecurring = (r: {
  name: string; subject: string; description: string;
  type: string; frequency: string; firstRunAt: string;
}) => api('/api/admin/recurring', { method: 'POST', body: JSON.stringify(r) });
export const toggleRecurring = (id: number, enabled: boolean) =>
  api(`/api/admin/recurring/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
export const deleteRecurring = (id: number) =>
  api(`/api/admin/recurring/${id}`, { method: 'DELETE' });

export type ResponseTemplate = {
  id: number; name: string; body: string; categoryId: number | null;
  autoRespond: boolean; isActive: boolean;
};

export const fetchAdminConfig = () => api<AdminConfig>('/api/admin/config');
export const saveScoreWeights = (weights: NonNullable<AdminConfig['scoreWeights']>) =>
  api('/api/admin/score-weights', { method: 'PUT', body: JSON.stringify(weights) });
export const saveAiThresholds = (t: AdminConfig['aiThresholds']) =>
  api('/api/admin/ai-thresholds', { method: 'PUT', body: JSON.stringify(t) });
export const saveAutoClose = (days: number) =>
  api('/api/admin/auto-close', { method: 'PUT', body: JSON.stringify({ days }) });

export type EscalationConfig = {
  enabled: boolean;
  minutesByPriority: Record<string, number>;
  expertiseScoreThreshold: number;
};
export const saveEscalation = (cfg: EscalationConfig) =>
  api('/api/admin/escalation', { method: 'PUT', body: JSON.stringify(cfg) });
export const runEscalationSweep = () =>
  api<{ escalated: number; byExpertise: number; roundRobin: number; unfilled: number }>(
    '/api/admin/escalation/run', { method: 'POST', body: '{}' });
export const saveScoreKeywords = (keywords: AdminConfig['scoreKeywords']) =>
  api<{ ok: boolean; rescored: number }>('/api/admin/score-keywords', {
    method: 'PUT', body: JSON.stringify(keywords),
  });
export const addStatus = (s: { name: string; category: string }) =>
  api('/api/admin/statuses', { method: 'POST', body: JSON.stringify(s) });
export const renameStatus = (id: number, name: string) =>
  api(`/api/admin/statuses/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
export const saveSlaPolicy = (id: number, p: { firstResponseMinutes: number | null; resolutionMinutes: number | null }) =>
  api(`/api/admin/sla-policies/${id}`, { method: 'PATCH', body: JSON.stringify(p) });
export const addRoutingRule = (r: { name: string; condition: { field: string; op: string; value: string }; actions: object }) =>
  api('/api/admin/routing-rules', { method: 'POST', body: JSON.stringify(r) });
export const toggleRoutingRule = (id: number, enabled: boolean) =>
  api(`/api/admin/routing-rules/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
export const deleteRoutingRule = (id: number) =>
  api(`/api/admin/routing-rules/${id}`, { method: 'DELETE' });

export const saveQueueNotify = (id: number, notifyEmails: string | null) =>
  api(`/api/admin/queues/${id}/notify`, { method: 'PATCH', body: JSON.stringify({ notifyEmails }) });

export type OutboundMail = {
  id: number; subject: string; body: string; kind: string;
  createdAt: string; ticketNumber: string | null;
  deliveredAt: string | null; deliveryError: string | null; // smtp transport audit
};
export const fetchOutbound = (email: string) =>
  api<OutboundMail[]>(`/api/mail/outbound?email=${encodeURIComponent(email)}`);

export const setCategoryApproval = (id: number, requiresApproval: boolean) =>
  api(`/api/admin/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ requiresApproval }) });

export const addTemplate = (t: { name: string; body: string; categoryId: number | null; autoRespond: boolean }) =>
  api('/api/admin/templates', { method: 'POST', body: JSON.stringify(t) });
export const updateTemplate = (id: number, t: Partial<Omit<ResponseTemplate, 'id'>>) =>
  api(`/api/admin/templates/${id}`, { method: 'PATCH', body: JSON.stringify(t) });
export const deleteTemplate = (id: number) =>
  api(`/api/admin/templates/${id}`, { method: 'DELETE' });

export const addAgentSkill = (userId: number, name: string, level: number) =>
  api(`/api/admin/agents/${userId}/skills`, { method: 'POST', body: JSON.stringify({ name, level }) });
export const removeAgentSkill = (userId: number, skillId: number) =>
  api(`/api/admin/agents/${userId}/skills/${skillId}`, { method: 'DELETE' });
export const syncSkills = () =>
  api<{ qualified: number; revoked: number }>('/api/admin/skills/sync', { method: 'POST', body: '{}' });

export const fetchMe = () =>
  api<{ id: number; name: string; role: string; isAvailable: boolean }>('/api/me');
export const setAvailability = (id: number, isAvailable: boolean) =>
  api<{ id: number; isAvailable: boolean }>(`/api/users/${id}/availability`, {
    method: 'PATCH', body: JSON.stringify({ isAvailable }),
  });

// --- Notifications ---

export type NotificationPrefs = {
  assignedToMe: boolean; slaAlerts: boolean; queueActivity: boolean; emailReplies: boolean;
  watchedTickets: boolean;
};
export type NotificationItem = {
  id: string; type: string; number: string; subject: string; at: string;
};

export type Attachment = {
  id: number; filename: string; contentType: string; size: number;
  createdAt: string; uploadedBy: string | null;
};

/** Multipart upload — no JSON content-type; auth headers still apply. */
export async function uploadAttachments(ticketId: number, files: File[]) {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  const { isEntra, getIdToken } = await import('./auth');
  const authHeaders: Record<string, string> = isEntra
    ? { authorization: `Bearer ${(await getIdToken()) ?? ''}` }
    : { 'x-user-id': String(actingUserId()) };
  const res = await fetch(`/api/tickets/${ticketId}/attachments`, {
    method: 'POST', body: form, headers: authHeaders,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<{ ok: boolean; attachments: Attachment[] }>;
}

/** Fetch attachment bytes with auth headers (img tags can't send them). */
export async function fetchAttachmentBlob(id: number): Promise<Blob> {
  const { isEntra, getIdToken } = await import('./auth');
  const authHeaders: Record<string, string> = isEntra
    ? { authorization: `Bearer ${(await getIdToken()) ?? ''}` }
    : { 'x-user-id': String(actingUserId()) };
  const res = await fetch(`/api/attachments/${id}`, { headers: authHeaders });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.blob();
}

export const deleteAttachment = (id: number) =>
  api(`/api/attachments/${id}`, { method: 'DELETE' });

export const watchTicket = (id: number, watch: boolean, userId?: number) =>
  api<{ ok: boolean; watching?: boolean; added?: string; alreadyWatching?: boolean }>(
    `/api/tickets/${id}/watch`,
    { method: 'POST', body: JSON.stringify({ watch, userId }) },
  );

export const fetchNotifications = () =>
  api<{ prefs: NotificationPrefs; items: NotificationItem[] }>('/api/notifications');
export const saveNotificationPrefs = (prefs: NotificationPrefs) =>
  api('/api/me/notification-prefs', { method: 'PUT', body: JSON.stringify(prefs) });

// --- Mail simulator ---

export type MailboxThread = {
  number: string; subject: string; status: string; category: string | null;
  entries: { kind: 'sent' | 'ack' | 'reply'; from: string; at: string; body: string }[];
};

export const fetchSenders = () =>
  api<{ name: string; email: string; department: string | null }[]>('/api/mail/senders');

export const fetchMailbox = (email: string) =>
  api<{ email: string; threads: MailboxThread[] }>(`/api/mail/mailbox?email=${encodeURIComponent(email)}`);

export const sendInboundEmail = (data: { from: string; subject: string; body: string }) =>
  api<{ action: 'created' | 'appended'; ticketId: number; number: string }>(
    '/api/mail/inbound', { method: 'POST', body: JSON.stringify(data) });
