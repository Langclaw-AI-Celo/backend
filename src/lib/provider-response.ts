export const maxProviderResponseBytes = 5 * 1024 * 1024;

export async function readProviderResponseJson<T>(response: Response) {
  return JSON.parse(await readProviderResponseText(response)) as T;
}

export async function readProviderResponseText(response: Response) {
  assertProviderResponseLength(response);

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      receivedBytes += value.byteLength;

      try {
        assertProviderResponseBytes(receivedBytes);
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder().decode(Buffer.concat(chunks, receivedBytes));
}

export function assertProviderResponseLength(response: Response) {
  const declaredLength = response.headers.get("content-length")?.trim();

  if (declaredLength && /^\d+$/.test(declaredLength)) {
    assertProviderResponseBytes(Number(declaredLength));
  }
}

export function assertProviderResponseBytes(receivedBytes: number) {
  if (receivedBytes > maxProviderResponseBytes) {
    throw providerResponseTooLarge();
  }
}

function providerResponseTooLarge() {
  return new Error(
    `Provider response exceeds the ${maxProviderResponseBytes} byte limit.`,
  );
}
