import type { PendingApproval, SecurityStats } from "./types.js";

const pending = new Map<string, PendingApproval>();

const stats: SecurityStats = {
  totalChecks: 0,
  autoApproved: 0,
  autoBlocked: 0,
  sentForReview: 0,
  humanApproved: 0,
  humanDenied: 0,
  timedOut: 0,
};

let idCounter = 0;

function generateId(): string {
  idCounter++;
  const rand = Math.random().toString(36).slice(2, 8);
  return `sr-${rand}${idCounter}`;
}

export function register(params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  risks: string[];
  summary: string;
}): { id: string; promise: Promise<boolean> } {
  const id = generateId();
  let resolve!: (approved: boolean) => void;
  const promise = new Promise<boolean>((res) => {
    resolve = res;
  });

  const entry: PendingApproval = {
    id,
    toolName: params.toolName,
    params: params.toolParams,
    risks: params.risks,
    summary: params.summary,
    createdAt: Date.now(),
    resolve,
  };

  pending.set(id, entry);
  return { id, promise };
}

export function approve(id: string): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  stats.humanApproved++;
  entry.resolve(true);
  return true;
}

export function deny(id: string): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  stats.humanDenied++;
  entry.resolve(false);
  return true;
}

export function timeout(id: string): void {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  stats.timedOut++;
  entry.resolve(false);
}

export function getPending(): PendingApproval[] {
  return Array.from(pending.values());
}

export function getStats(): SecurityStats {
  return { ...stats };
}

export function recordAutoApproved(): void {
  stats.totalChecks++;
  stats.autoApproved++;
}

export function recordAutoBlocked(): void {
  stats.totalChecks++;
  stats.autoBlocked++;
}

export function recordSentForReview(): void {
  stats.totalChecks++;
  stats.sentForReview++;
}
