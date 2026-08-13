import type { NetworkMeta } from '../replay/hooks.js';
import type { Breadcrumb } from '../types.js';

export const MAX_BREADCRUMBS = 50;

export type { Breadcrumb };

/** Ring buffer of the last {@link MAX_BREADCRUMBS} client breadcrumbs. */
export class BreadcrumbBuffer {
  private items: Breadcrumb[] = [];

  add(crumb: Breadcrumb): void {
    this.items.push(crumb);
    if (this.items.length > MAX_BREADCRUMBS) {
      this.items.splice(0, this.items.length - MAX_BREADCRUMBS);
    }
  }

  /** Last `limit` crumbs (default: the whole buffer, capped at 50). */
  snapshot(limit: number = MAX_BREADCRUMBS): Breadcrumb[] {
    if (limit <= 0) return [];
    return this.items.slice(-Math.min(limit, MAX_BREADCRUMBS)).map(cloneBreadcrumb);
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }
}

export function networkBreadcrumb(meta: NetworkMeta): Breadcrumb {
  const data: Record<string, string> = {
    method: meta.method || 'GET',
    url: meta.url || '',
  };
  if (typeof meta.status === 'number' && meta.status > 0) {
    data.status_code = String(meta.status);
  }
  if (typeof meta.durationMs === 'number') {
    data.durationMs = String(meta.durationMs);
  }
  if (meta.transport) data.transport = meta.transport;
  if (meta.failureKind) data.failure_kind = meta.failureKind;
  if (meta.party) data.party = meta.party;

  const failed = meta.ok === false;
  return {
    timestamp: new Date().toISOString(),
    type: 'http',
    category: meta.transport === 'xhr' ? 'xhr' : 'fetch',
    message: `${meta.method || 'GET'} ${meta.url || ''}`.trim(),
    level: failed ? 'error' : 'info',
    data,
  };
}

export function consoleBreadcrumb(level: string, message: string): Breadcrumb {
  const mapped =
    level === 'error'
      ? 'error'
      : level === 'warn' || level === 'warning'
        ? 'warning'
        : level === 'debug'
          ? 'debug'
          : 'info';
  return {
    timestamp: new Date().toISOString(),
    type: 'default',
    category: 'console',
    message: message.slice(0, 4000),
    level: mapped,
  };
}

export function navigationBreadcrumb(url: string): Breadcrumb {
  return {
    timestamp: new Date().toISOString(),
    type: 'navigation',
    category: 'pageload',
    message: url,
    level: 'info',
    data: { url },
  };
}

function cloneBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  return {
    timestamp: crumb.timestamp,
    type: crumb.type,
    category: crumb.category,
    message: crumb.message,
    level: crumb.level,
    data: crumb.data ? { ...crumb.data } : undefined,
  };
}
