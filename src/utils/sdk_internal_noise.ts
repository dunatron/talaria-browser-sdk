/**
 * Detect errors that originated inside the Talaria browser SDK itself
 * (e.g. ingest/replay fetch failures rethrown into unhandledrejection,
 * or rrweb touching a cross-origin iframe on Firefox).
 * Those are not actionable app bugs.
 */
const SDK_STACK_FRAME =
  /@newtalaria\/browser|\/npm\/@newtalaria\/browser(?:@[\w.-]+)?\/|talaria\.browser(?:\.iife)?\.js/i;

/**
 * Firefox throws this when script (here: rrweb snapshot) reads DOM
 * properties on a cross-origin iframe. Chrome returns null instead.
 */
const FIREFOX_DOM_PERMISSION =
  /permission denied to access property\s+"?(?:nodeType|nodeName|parentNode|ownerDocument|contentDocument|contentWindow)"?/i;

/** True when every stack frame that looks like a URL belongs to this SDK. */
export function isSdkInternalNoise(opts: {
  message?: string;
  stack?: string;
  filename?: string;
}): boolean {
  const message = opts.message ?? '';
  const urls = collectScriptUrls(opts.stack ?? '', opts.filename);

  let sdkFrames = 0;
  let otherUrlFrames = 0;
  for (const url of urls) {
    if (SDK_STACK_FRAME.test(url)) {
      sdkFrames += 1;
    } else {
      otherUrlFrames += 1;
    }
  }

  const sdkOnly = sdkFrames > 0 && otherUrlFrames === 0;
  if (sdkOnly) return true;

  // onerror may give us the SDK filename with a truncated/empty stack.
  if (
    FIREFOX_DOM_PERMISSION.test(message) &&
    SDK_STACK_FRAME.test(opts.filename ?? '')
  ) {
    return true;
  }

  return false;
}

function collectScriptUrls(stack: string, filename?: string): string[] {
  const urls: string[] = [];
  if (filename && /^https?:\/\//i.test(filename)) {
    urls.push(stripLineCol(filename));
  }

  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const fromParens = line.match(/\((https?:\/\/[^)]+)\)/i);
    const v8Bare = line.match(/^at\s+(https?:\/\/\S+)/i);
    const gecko = line.match(/@(https?:\/\/\S+)$/i);
    const extracted = fromParens?.[1] ?? v8Bare?.[1] ?? gecko?.[1];
    if (!extracted) continue;
    urls.push(stripLineCol(extracted));
  }

  return urls;
}

/** `https://host/file.js:12:34` → `https://host/file.js` */
function stripLineCol(url: string): string {
  return url.replace(/:(\d+):(\d+)$/, '');
}
