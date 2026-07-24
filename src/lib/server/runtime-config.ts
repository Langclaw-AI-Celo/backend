export function readServerPort(value: string | undefined, fallback: number) {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed <= 65_535
    ? parsed
    : fallback;
}
