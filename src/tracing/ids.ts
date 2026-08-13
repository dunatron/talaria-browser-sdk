/** 32-char W3C trace id (16 bytes hex). */
export function createTraceId(): string {
  return randomHex(16);
}

/** 16-char W3C span id (8 bytes hex). */
export function createSpanId(): string {
  return randomHex(8);
}

export function isTraceId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value);
}

export function isSpanId(value: string): boolean {
  return /^[0-9a-f]{16}$/i.test(value);
}

export function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteCount; i++) bytes[i] = (Math.random() * 256) | 0;
  }
  // W3C forbids all-zero trace/span ids.
  if (bytes.every((b) => b === 0)) bytes[0] = 1;
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
