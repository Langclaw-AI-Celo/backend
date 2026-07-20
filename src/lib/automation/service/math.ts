import {
  formatNeuronAs0G,
  getZonedParts,
  parse0GToNeuron,
  readDecimalString,
} from "./core";

export { formatNeuronAs0G, parse0GToNeuron, readDecimalString };

export function readMaxAttempts(maxRetries: number) {
  if (!Number.isFinite(maxRetries) || maxRetries <= 0) {
    return 1;
  }

  return Math.min(Math.trunc(maxRetries), 5);
}

export function startOfLocalDay(date: Date, timezone: string) {
  const parts = getZonedParts(date, timezone);

  return localPartsToUtc({
    day: parts.day,
    hour: 0,
    minute: 0,
    month: parts.month,
    year: parts.year,
  }, timezone);
}

export function startOfLocalMonth(date: Date, timezone: string) {
  const parts = getZonedParts(date, timezone);

  return localPartsToUtc({
    day: 1,
    hour: 0,
    minute: 0,
    month: parts.month,
    year: parts.year,
  }, timezone);
}

export function localPartsToUtc(
  parts: {
    day: number;
    hour: number;
    minute: number;
    month: number;
    year: number;
  },
  timezone: string
) {
  const utcGuess = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  );
  const zoned = getZonedParts(utcGuess, timezone);
  const offset =
    Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second
    ) - utcGuess.getTime();

  return new Date(utcGuess.getTime() - offset);
}

