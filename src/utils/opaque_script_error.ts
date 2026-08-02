/**
 * Cross-origin scripts report only "Script error." to window.onerror —
 * no useful message, file, or Error object. Drop these as noise.
 *
 * @see https://sentry.io/answers/script-error/
 */
export function isOpaqueCrossOriginScriptError(event: {
  message?: string;
  error?: unknown;
  filename?: string;
}): boolean {
  const msg = (event.message ?? '').trim();
  if (!/^script error\.?$/i.test(msg)) return false;
  // Real Error from same-origin (or CORS-enabled) scripts — keep.
  if (event.error instanceof Error) return false;
  return true;
}
