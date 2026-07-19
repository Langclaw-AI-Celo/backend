export function resolveRequestProtocol(
  forwardedProtocol: string | string[] | undefined,
) {
  const rawProtocol = Array.isArray(forwardedProtocol)
    ? forwardedProtocol[0]
    : forwardedProtocol;
  const protocol = rawProtocol?.split(",", 1)[0]?.trim().toLowerCase();

  return protocol === "https" ? "https" : "http";
}
