export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor(
    readonly receivedBytes: number,
    readonly maxBytes: number,
  ) {
    super(`Request body exceeds the ${maxBytes} byte limit.`);
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readLimitedRequestBody(
  source: AsyncIterable<Uint8Array | string>,
  contentLength: string | string[] | undefined,
  maxBytes = MAX_REQUEST_BODY_BYTES,
) {
  const declaredLength = readDeclaredLength(contentLength);

  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError(declaredLength, maxBytes);
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  for await (const value of source) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    receivedBytes += chunk.byteLength;

    if (receivedBytes > maxBytes) {
      throw new RequestBodyTooLargeError(receivedBytes, maxBytes);
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks, receivedBytes);
}

function readDeclaredLength(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;

  if (!rawValue || !/^\d+$/.test(rawValue)) {
    return null;
  }

  return Number(rawValue);
}
