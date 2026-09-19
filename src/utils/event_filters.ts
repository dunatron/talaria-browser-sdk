import { isAbortError } from './network_error.js';
import { isBrowserExtensionNoise } from './browser_extension_noise.js';
import { isOpaqueCrossOriginScriptError } from './opaque_script_error.js';
import { isSdkInternalNoise } from './sdk_internal_noise.js';

/** Sentry-class defaults — globally unactionable browser / WebView messages. */
export const DEFAULT_IGNORE_ERRORS: Array<string | RegExp> = [
  "Can't find variable: _AutofillCallbackHandler",
  /^Java exception was raised during method invocation$/,
  /^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications\.)$/,
  /^Script error\.?$/,
  /^Javascript error: Script error\.? on line 0$/,
  /^Non-Error promise rejection captured with value: Object Not Found Matching Id:\d+, MethodName:simulateEvent, ParamCount:\d+$/,
  "vv().getRestrictions is not a function",
  /^Can't find variable: gmo$/,
  /^Cannot redefine property: googletag$/,
  'can\'t redefine non-configurable property "solana"',
  'can\'t redefine non-configurable property "ethereum"',
  /undefined is not an object \(evaluating 'a\.[A-Z]'\)/,
];

export type IgnorePattern = string | RegExp;

export function matchesIgnorePattern(
  value: string | undefined,
  patterns: IgnorePattern[],
): boolean {
  if (!value || patterns.length === 0) return false;
  for (const pattern of patterns) {
    if (typeof pattern === 'string') {
      if (value.includes(pattern)) return true;
    } else if (pattern.test(value)) {
      return true;
    }
  }
  return false;
}

export function shouldIgnoreErrorMessage(
  message: string | undefined,
  ignoreErrors: IgnorePattern[],
): boolean {
  return matchesIgnorePattern(message, ignoreErrors);
}

export function shouldIgnoreStackUrls(
  stack: string | undefined,
  filename: string | undefined,
  ignoreUrls: IgnorePattern[],
): boolean {
  if (ignoreUrls.length === 0) return false;
  if (matchesIgnorePattern(filename, ignoreUrls)) return true;
  if (!stack) return false;
  for (const line of stack.split('\n')) {
    if (matchesIgnorePattern(line, ignoreUrls)) return true;
  }
  return false;
}

export function shouldDropCapturedError(opts: {
  message?: string;
  stack?: string;
  filename?: string;
  error?: unknown;
  ignoreErrors: IgnorePattern[];
  ignoreUrls: IgnorePattern[];
  errorEvent?: ErrorEvent;
}): boolean {
  if (opts.errorEvent && isOpaqueCrossOriginScriptError(opts.errorEvent)) {
    return true;
  }
  const err = opts.error;
  if (err && isAbortError(err)) return true;
  if (
    isBrowserExtensionNoise({
      message: opts.message,
      stack: opts.stack,
      filename: opts.filename,
    })
  ) {
    return true;
  }
  if (
    isSdkInternalNoise({
      message: opts.message,
      stack: opts.stack,
      filename: opts.filename,
    })
  ) {
    return true;
  }
  if (!opts.errorEvent && /^script error\.?$/i.test(opts.message ?? '')) {
    return true;
  }
  if (shouldIgnoreErrorMessage(opts.message, opts.ignoreErrors)) return true;
  if (shouldIgnoreStackUrls(opts.stack, opts.filename, opts.ignoreUrls)) {
    return true;
  }
  return false;
}
