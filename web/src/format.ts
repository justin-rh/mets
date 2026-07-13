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

export type SlaView = {
  label: string;
  tone: 'ok' | 'warn' | 'breach' | 'paused';
  /** Fraction of the SLA window remaining, 0..1 — drives the depletion meter. */
  fraction: number;
} | null;

export function slaView(sla: SlaInfo | null): SlaView {
  if (!sla || sla.state === 'completed') return null;
  if (sla.state === 'paused') return { label: 'paused', tone: 'paused', fraction: 1 };
  const now = Date.now();
  const target = new Date(sla.targetAt).getTime();
  const remaining = target - now;
  // warnAt sits at 75% of the window, so the full window is 4x (target - warn).
  const duration = sla.warnAt ? (target - new Date(sla.warnAt).getTime()) * 4 : null;
  const fraction = duration ? Math.max(0, Math.min(1, remaining / duration)) : 0.5;
  if (sla.state === 'breached' || remaining <= 0) {
    return { label: `−${span(remaining)}`, tone: 'breach', fraction: 0 };
  }
  const warned = sla.warnAt && now >= new Date(sla.warnAt).getTime();
  return { label: span(remaining), tone: warned ? 'warn' : 'ok', fraction };
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
