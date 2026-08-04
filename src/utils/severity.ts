import type { SeverityLevel } from '../types.js';

/** Wire severity levels from lowest to highest. */
export const SEVERITY_ORDER = [
  'debug',
  'info',
  'warning',
  'error',
  'fatal',
] as const satisfies readonly SeverityLevel[];

const RANK: Record<SeverityLevel, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  fatal: 4,
};

/** True when `level` is at least as severe as `min`. */
export function severityAtLeast(
  level: SeverityLevel,
  min: SeverityLevel,
): boolean {
  return RANK[level] >= RANK[min];
}

/** Higher of two severities (stricter floor). */
export function maxSeverity(
  a: SeverityLevel,
  b: SeverityLevel,
): SeverityLevel {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * Normalize common aliases to a wire {@link SeverityLevel}.
 * Accepts `warn` → `warning`, PSR-3-style `notice` / `critical` / etc.
 */
export function normalizeSeverity(level: string): SeverityLevel | null {
  const normalized = level.trim().toLowerCase();
  switch (normalized) {
    case 'debug':
      return 'debug';
    case 'info':
    case 'notice':
      return 'info';
    case 'warning':
    case 'warn':
      return 'warning';
    case 'error':
    case 'err':
      return 'error';
    case 'fatal':
    case 'critical':
    case 'alert':
    case 'emergency':
      return 'fatal';
    default:
      return null;
  }
}
