import type { SlaInfo } from './api';

export function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

export function span(ms: number): string {
  const m = Math.floor(Math.abs(ms) / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export type SlaView = { label: string; tone: 'ok' | 'warn' | 'breach' | 'paused' } | null;

export function slaView(sla: SlaInfo | null): SlaView {
  if (!sla || sla.state === 'completed') return null;
  if (sla.state === 'paused') return { label: 'SLA paused', tone: 'paused' };
  const remaining = new Date(sla.targetAt).getTime() - Date.now();
  if (sla.state === 'breached' || remaining <= 0) {
    return { label: `Breached ${span(remaining)}`, tone: 'breach' };
  }
  const warned = sla.warnAt && Date.now() >= new Date(sla.warnAt).getTime();
  return { label: `${span(remaining)} left`, tone: warned ? 'warn' : 'ok' };
}

export function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export const TYPE_LABEL: Record<string, string> = { incident: 'INC', request: 'REQ', change: 'CHG' };

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
