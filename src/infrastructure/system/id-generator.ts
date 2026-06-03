// TimestampIdGenerator — creates qrspi-YYYYMMDD-HHMMSS run IDs.

import type { IdGenerator } from "../../application/port/index.js";

export function createRunId(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `qrspi-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export class TimestampIdGenerator implements IdGenerator {
  runId(now?: Date): string {
    return createRunId(now);
  }
}
