const EXTENSION_URL =
  /(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i;

/** Safari sometimes masks extension frames as this scheme. */
const WEBKIT_MASKED = /webkit-masked-url:\/\/hidden\//i;

/**
 * Errors that originate in (or are dominated by) browser extensions —
 * ad blockers, password managers, media filters, etc. Not actionable for
 * the host app; Sentry-style noise filter.
 */
export function isBrowserExtensionNoise(opts: {
  message?: string;
  stack?: string;
  filename?: string;
}): boolean {
  const filename = opts.filename ?? '';
  if (EXTENSION_URL.test(filename) || WEBKIT_MASKED.test(filename)) {
    return true;
  }

  const stack = opts.stack ?? '';
  if (EXTENSION_URL.test(stack) || WEBKIT_MASKED.test(stack)) {
    return true;
  }

  return false;
}
