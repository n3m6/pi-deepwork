// FileSystemRunStateRepository — load/save the Run aggregate from state.json.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Run } from "../../domain/run/index.js";
import type { RunState } from "../../application/port/index.js";
import type { RunStateRepository } from "../../application/port/index.js";

export class FileSystemRunStateRepository implements RunStateRepository {
  constructor(
    private readonly stateFilePath: string,
  ) {}

  async load(_runId: string): Promise<Run | undefined> {
    const state = await readStateFile(this.stateFilePath);
    if (!state) {
      return undefined;
    }
    return Run.rehydrate(state);
  }

  async save(run: Run): Promise<void> {
    await writeStateFile(this.stateFilePath, run.toSnapshot());
  }
}

async function readStateFile(stateFile: string): Promise<RunState | undefined> {
  try {
    const raw = await readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw) as RunState;
    return {
      ...parsed,
      acceptFixAttempts: parsed.acceptFixAttempts ?? 0,
      verifyFixAttempts: parsed.verifyFixAttempts ?? 0,
    };
  } catch {
    return undefined;
  }
}

async function writeStateFile(stateFile: string, state: RunState): Promise<void> {
  const nextState: RunState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}
