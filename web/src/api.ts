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
  view: 'open' | 'mine' | 'snoozed';
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
