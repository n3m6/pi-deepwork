// TimestampIdGenerator — creates qrspi-YYYYMMDD-HHMMSS run IDs.

import { createRunId } from "../../state.js";
import type { IdGenerator } from "../../application/port/index.js";

export class TimestampIdGenerator implements IdGenerator {
  runId(now?: Date): string {
    return createRunId(now);
  }
}
