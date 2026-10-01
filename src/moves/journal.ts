import fs from "node:fs";
import path from "node:path";
import type { Destination } from "../types.js";

export interface MoveJournal {
  version: 1;
  status: "moving" | "interrupted";
  sourceTabId: string;
  sourceTerminalIds: string[];
  destination: Destination;
  startedAt: string;
  error?: string;
}

function journalPath(): string | undefined {
  const state = process.env.HERDR_PLUGIN_STATE_DIR;

  return state ? path.join(state, "last-move.json") : undefined;
}

export function writeJournal(journal: MoveJournal): void {
  const file = journalPath();

  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function clearJournal(): void {
  const file = journalPath();

  if (file) fs.rmSync(file, { force: true });
}
