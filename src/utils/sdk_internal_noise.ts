/**
 * Detect errors that originated inside the Talaria browser SDK itself
 * (e.g. ingest/replay fetch failures rethrown into unhandledrejection).
 * Those are not actionable app bugs.
 */
const SDK_STACK_FRAME =
  /@newtalaria\/browser|\/npm\/@newtalaria\/browser(?:@[\w.-]+)?\//i;

/** True when every stack frame that looks like a URL belongs to this SDK. */
export function isSdkInternalNoise(opts: {
  message?: string;
  stack?: string;
}): boolean {
  const stack = opts.stack ?? '';
  if (!stack) return false;

  const frameLines = stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at '));
  if (frameLines.length === 0) return false;

  let sdkFrames = 0;
  let otherUrlFrames = 0;
  for (const line of frameLines) {
    // "at fn (http://...)" or "at http://..."
    const urlMatch = line.match(/\((https?:\/\/[^)]+)\)|(https?:\/\/\S+)/i);
    const url = urlMatch?.[1] ?? urlMatch?.[2];
    if (!url) continue;
    if (SDK_STACK_FRAME.test(url)) {
      sdkFrames += 1;
    } else {
      otherUrlFrames += 1;
    }
  }

  // Entirely SDK (or SDK + native frames with no other script URLs).
  return sdkFrames > 0 && otherUrlFrames === 0;
}
