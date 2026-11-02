import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatImportEta, importMeter } from "./import-progress.ts";

describe("library import progress", () => {
  it("estimates remaining time from bytes already saved", () => {
    const meter = importMeter({
      done: 10,
      total: 100,
      bytesDone: 1_000_000,
      bytesTotal: 10_000_000,
      name: "kick",
      startedAt: 0,
      now: 1_000,
    });
    assert.equal(meter.percent, 10);
    assert.equal(meter.ratio, 0.1);
    assert.equal(meter.etaMs, 9_000);
    assert.equal(formatImportEta(meter.etaMs), "A few seconds left");
  });

  it("waits for a pace before guessing", () => {
    const meter = importMeter({
      done: 1,
      total: 2000,
      bytesDone: 20_000,
      bytesTotal: 40_000_000,
      name: "hat",
      startedAt: 0,
      now: 200,
    });
    assert.equal(meter.etaMs, null);
    assert.equal(formatImportEta(meter.etaMs), "Estimating time left");
  });

  it("smooths a jump in the estimate", () => {
    const first = importMeter({
      done: 1,
      total: 10,
      bytesDone: 100,
      bytesTotal: 1_000,
      name: "a",
      startedAt: 0,
      now: 1_000,
    });
    const second = importMeter({
      done: 2,
      total: 10,
      bytesDone: 200,
      bytesTotal: 1_000,
      name: "b",
      startedAt: 0,
      now: 1_200,
      previousEta: first.etaMs,
    });
    assert.equal(first.etaMs, 9_000);
    assert.ok(second.etaMs != null && second.etaMs > 4_800 && second.etaMs < 9_000);
  });

  it("uses file count when the batch has no bytes", () => {
    const meter = importMeter({
      done: 2,
      total: 4,
      bytesDone: 0,
      bytesTotal: 0,
      name: "empty",
      startedAt: 0,
      now: 1_000,
    });
    assert.equal(meter.percent, 50);
    assert.equal(meter.etaMs, 1_000);
  });

  it("phrases longer estimates in minutes and hours", () => {
    assert.equal(formatImportEta(12_000), "About 10 seconds left");
    assert.equal(formatImportEta(58_000), "About 1 minute left");
    assert.equal(formatImportEta(6.2 * 60 * 1000), "About 6 minutes left");
    assert.equal(formatImportEta(60 * 60 * 1000), "About 1 hour left");
    assert.equal(formatImportEta(90 * 60 * 1000), "About 1 hour 30 minutes left");
  });
});
