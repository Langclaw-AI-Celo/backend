export function readCanonicalPositiveInteger(
  value: string | undefined,
  fallback: number
) {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export function readCanonicalNonNegativeBigInt(
  value: string | undefined,
  fallback = 0n
) {
  return value && /^(0|[1-9]\d*)$/.test(value) ? BigInt(value) : fallback;
}
