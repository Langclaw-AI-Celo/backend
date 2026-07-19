export function resolveRequestProtocol(
  forwardedProtocol: string | string[] | undefined,
) {
  const rawProtocol = Array.isArray(forwardedProtocol)
    ? forwardedProtocol[0]
    : forwardedProtocol;
  const protocol = rawProtocol?.split(",", 1)[0]?.trim().toLowerCase();

  return protocol === "https" ? "https" : "http";
}

export function decodePathSegment(value: string) {
  try {
    return {
      ok: true as const,
      value: decodeURIComponent(value),
    };
  } catch {
    return { ok: false as const };
  }
}
