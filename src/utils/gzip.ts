/** Gzip-compress bytes using the browser CompressionStream API. */
export async function gzipBytes(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error(
      '@newtalaria/browser requires CompressionStream (gzip). Use a modern browser.',
    );
  }

  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Encode bytes as a Serverpod ByteData JSON string. */
export function toServerpodByteData(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);
  // Serverpod serializes ByteData as: decode('<base64>', 'base64')
  return `decode('${b64}', 'base64')`;
}
