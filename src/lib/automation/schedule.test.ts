import assert from "node:assert/strict";
import test from "node:test";

import { buildTriggerLabel, computeNextRunAt } from "./schedule";

test("computes the next daily run in the configured timezone", () => {
  assert.equal(
    computeNextRunAt({
      frequency: "daily",
      from: new Date("2026-05-15T03:30:00.000Z"),
      scheduleTime: "09:00",
      timezone: "Asia/Jakarta",
    }),
    "2026-05-16T02:00:00.000Z"
  );
});

test("computes the current day daily run when the time is still ahead", () => {
  assert.equal(
    computeNextRunAt({
      frequency: "daily",
      from: new Date("2026-05-15T00:30:00.000Z"),
      scheduleTime: "09:00",
      timezone: "Asia/Jakarta",
    }),
    "2026-05-15T02:00:00.000Z"
  );
});

test("computes the next weekly run on the requested weekday", () => {
  assert.equal(
    computeNextRunAt({
      frequency: "weekly",
      from: new Date("2026-05-15T03:00:00.000Z"),
      scheduleTime: "08:30",
      scheduleWeekday: 5,
      timezone: "Asia/Jakarta",
    }),
    "2026-05-22T01:30:00.000Z"
  );
});

test("computes the next monthly run and clamps short months", () => {
  assert.equal(
    computeNextRunAt({
      frequency: "monthly",
      from: new Date("2026-02-01T00:00:00.000Z"),
      scheduleMonthDay: 31,
      scheduleTime: "10:00",
      timezone: "Asia/Jakarta",
    }),
    "2026-02-28T03:00:00.000Z"
  );
});

test("preserves local schedule times across a daylight-saving gap", () => {
  const from = new Date("2026-03-28T12:00:00.000Z");

  assert.equal(
    computeNextRunAt({
      frequency: "daily",
      from,
      scheduleTime: "01:30",
      timezone: "Europe/Berlin",
    }),
    "2026-03-29T00:30:00.000Z",
  );
  assert.equal(
    computeNextRunAt({
      frequency: "daily",
      from,
      scheduleTime: "02:30",
      timezone: "Europe/Berlin",
    }),
    "2026-03-29T01:30:00.000Z",
  );
  assert.equal(
    computeNextRunAt({
      frequency: "daily",
      from,
      scheduleTime: "03:30",
      timezone: "Europe/Berlin",
    }),
    "2026-03-29T01:30:00.000Z",
  );
});

test("uses the actual gap for non-hour daylight-saving transitions", () => {
  assert.equal(
    computeNextRunAt({
      frequency: "daily",
      from: new Date("2026-10-02T16:00:00.000Z"),
      scheduleTime: "02:15",
      timezone: "Australia/Lord_Howe",
    }),
    "2026-10-03T15:45:00.000Z",
  );
});

test("moves forward across a midnight gap in a negative-offset timezone", () => {
  assert.equal(
    computeNextRunAt({
      frequency: "daily",
      from: new Date("2026-09-05T12:00:00.000Z"),
      scheduleTime: "00:30",
      timezone: "America/Santiago",
    }),
    "2026-09-06T04:30:00.000Z",
  );
});

test("builds readable trigger labels", () => {
  assert.equal(
    buildTriggerLabel({
      scheduleFrequency: "weekly",
      scheduleTime: "08:30",
      scheduleWeekday: 5,
      triggerType: "schedule",
    }),
    "Every Friday at 08:30"
  );
  assert.equal(
    buildTriggerLabel({
      eventName: "benchmark completes",
      triggerType: "event",
    }),
    "After benchmark completes"
  );
});
