import type { Environment } from '../types.js';

const WIRE: ReadonlySet<string> = new Set([
  'production',
  'staging',
  'development',
]);

/**
 * Map common aliases to wire `EnvironmentWire` values.
 * Mirrors PHP `Talaria\Environment::fromMixed` (`test`/`uat` → staging, etc.).
 */
export function normalizeEnvironment(raw: string): Environment {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    throw new Error(
      '@newtalaria/browser: init requires `environment` (production | staging | development)',
    );
  }

  switch (normalized) {
    case 'prod':
    case 'production':
    case 'live':
      return 'production';
    case 'stage':
    case 'staging':
    case 'uat':
    case 'test':
      return 'staging';
    case 'dev':
    case 'development':
    case 'local':
      return 'development';
    default:
      if (WIRE.has(normalized)) {
        return normalized as Environment;
      }
      throw new Error(
        `@newtalaria/browser: invalid environment '${raw}'. Expected production, staging, or development.`,
      );
  }
}
