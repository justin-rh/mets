export type StatusInfo = { id: number; name: string; category: string };
export type QueueInfo = { id: number; name: string; slug: string; assignmentPolicy: string; openCount: number };
export type AgentInfo = {
  id: number; name: string; openCount: number; maxOpen: number; isAvailable: boolean;
  teamIds: number[]; leadOf: number[]; skills: { name: string; level: number }[];
};
export type Meta = { statuses: StatusInfo[]; queues: QueueInfo[]; agents: AgentInfo[]; tags: { id: number; name: string }[] };

export type SlaInfo = { state: 'running' | 'paused' | 'completed' | 'breached'; targetAt: string; warnAt: string | null };

export type TicketListItem = {
  id: number; number: string; type: 'incident' | 'request' | 'change';
  subject: string; priority: number; score: number;
  createdAt: string; updatedAt: string;
  snoozedUntil: string | null; snoozeReason: string | null;
  status: StatusInfo; queue: { id: number; name: string };
  requester: { id: number; name: string; isVip: boolean };
  assignee: { id: number; name: string } | null;
  category: string | null; tags: string[]; sla: SlaInfo | null;
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
  firstRespondedAt: string | null; resolvedAt: string | null;
  requester: { id: number; name: string; isVip: boolean; department: string | null; email: string };
  comments: Comment[]; events: TicketEvent[]; sla: any[];
};

export type TicketChanges = {
  assigneeId?: number | null; queueId?: number; statusId?: number;
  priority?: number; snooze?: { until: string; reason: string } | null;
};

export type ListParams = {
  view: 'open' | 'mine' | 'unassigned' | 'my_queues' | 'snoozed';
  queueId?: number; sort: string; search?: string;
};

export function actingUserId(): number {
  return Number(localStorage.getItem('mets-user') ?? '1');
}
export function setActingUserId(id: number) {
  localStorage.setItem('mets-user', String(id));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-user-id': String(actingUserId()),
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

export function fetchTickets(p: ListParams) {
  const q = new URLSearchParams({ view: p.view, sort: p.sort });
  if (p.queueId) q.set('queueId', String(p.queueId));
  if (p.search) q.set('search', p.search);
  return api<TicketListItem[]>(`/api/tickets?${q}`);
}

export const fetchTicket = (id: number) => api<TicketDetail>(`/api/tickets/${id}`);

export const patchTicket = (id: number, changes: TicketChanges) =>
  api(`/api/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });

export const bulkTickets = (ticketIds: number[], action: 'update' | 'auto_assign', changes?: TicketChanges) =>
  api('/api/tickets/bulk', { method: 'POST', body: JSON.stringify({ ticketIds, action, changes }) });

export const postComment = (id: number, bodyText: string, visibility: 'public' | 'internal') =>
  api(`/api/tickets/${id}/comments`, { method: 'POST', body: JSON.stringify({ bodyText, visibility }) });

// --- AI ---

export type TriageResult = {
  category: string; queueSlug: string; priority: number;
  sentiment: string; summary: string;
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

export const createTicket = (data: { subject: string; description: string; type?: string; priority?: number }) =>
  api<{ id: number; number: string }>('/api/tickets', { method: 'POST', body: JSON.stringify(data) });

// --- Dashboard & KB ---

export type DashboardData = {
  tiles: {
    open_count: string; created_30: string; resolved_30: string;
    median_mttr_hours: number | null; median_frt_hours: number | null;
    sla_attainment_pct: string | null;
  };
  daily: { day: string; created: string; resolved: string }[];
  backlogAge: { bucket: string; count: string }[];
  openByQueue: { name: string; count: string }[];
  leaderboard: { name: string; tp: string; resolved: string }[];
};

export const fetchDashboard = () => api<DashboardData>('/api/dashboard');

export type KbHit = { id: number; title: string; snippet: string; score: number };
export type KbIndex = { results: KbHit[] | null; articles: { id: number; title: string; updatedAt: string }[] | null };
export type KbArticle = { id: number; title: string; bodyText: string; updatedAt: string };

export const searchKb = (q: string) => api<KbIndex>(`/api/kb${q ? `?q=${encodeURIComponent(q)}` : ''}`);
export const fetchArticle = (id: number) => api<KbArticle>(`/api/kb/${id}`);

export type Suggestions = {
  articles: KbHit[];
  similarTickets: { id: number; number: string; subject: string; resolved_at: string }[];
};
export const fetchSuggestions = (ticketId: number) => api<Suggestions>(`/api/tickets/${ticketId}/suggestions`);

export const draftReply = (ticketId: number) =>
  api<{ draft: string; groundedIn: string[] }>(`/api/tickets/${ticketId}/draft-reply`, { method: 'POST', body: '{}' });
