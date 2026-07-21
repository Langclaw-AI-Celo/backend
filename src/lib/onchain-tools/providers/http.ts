type FetchJsonOptions = {
  headers?: HeadersInit;
  method?: string;
  body?: BodyInit;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const MAX_PROVIDER_RESPONSE_BYTES = 5 * 1024 * 1024;

export async function fetchJson(
  url: string,
  {
    body,
    headers,
    method,
    signal,
    timeoutMs = 12000,
  }: FetchJsonOptions = {}
) {
  signal?.throwIfAborted();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();

  signal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(url, {
      body,
      headers,
      method,
      signal: controller.signal,
    });
    const text = await readProviderResponseText(response);

    if (!response.ok) {
      const compact = text.replace(/\s+/g, " ").trim();
      throw new Error(
        `${response.status} ${response.statusText}${
          compact ? `: ${compact.slice(0, 200)}` : ""
        }`
      );
    }

    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

async function readProviderResponseText(response: Response) {
  const declaredLength = response.headers.get("content-length")?.trim();

  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    throw providerResponseTooLarge();
  }

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

      if (receivedBytes > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw providerResponseTooLarge();
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder().decode(Buffer.concat(chunks, receivedBytes));
}

function providerResponseTooLarge() {
  return new Error(
    `Provider response exceeds the ${MAX_PROVIDER_RESPONSE_BYTES} byte limit.`,
  );
}

export function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function compactText(value: unknown, fallback = "No summary returned.") {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 0) ?? "";
  const compact = text.replace(/\s+/g, " ").trim();

  if (!compact) {
    return fallback;
  }

  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

export function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}
