#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { HerdrClient } from "../herdr/client.js";
import { executePaneMove, executeTabMove } from "../moves/execute.js";
import { destinationItems, filterItems, sourcePane } from "../moves/model.js";
import type { DestinationItem, MoveMode, MoveOptions, PaneInfo, SessionSnapshot } from "../types.js";
import { color, render, type RenderState } from "./render.js";

process.on("uncaughtException", crash);

process.on("unhandledRejection", crash);

const client = new HerdrClient();

const sourcePaneId = process.env.SCHLEPR_SOURCE_PANE;

if (!sourcePaneId) throw new Error("SCHLEPR_SOURCE_PANE is not set; invoke a Schlepr action instead of opening its pane directly");

let snapshot: SessionSnapshot;

try {
  snapshot = await client.snapshot();
} catch (error) {
  logFailure(error);
  throw error;
}

const initialSource: PaneInfo = snapshot.panes.find((pane) => pane.pane_id === sourcePaneId) ?? missingSource();

const sourceTerminalId = initialSource.terminal_id;

const originalTabId = initialSource.tab_id;

let mode: MoveMode = process.env.SCHLEPR_MODE === "tab" ? "tab" : "pane";

let query = "";

let selected = 0;

let targetIndex = 0;

let direction: "right" | "down" = "right";

const ratios = [0.33, 0.5, 0.67] as const;

let ratioIndex = 1;

let busy = false;

let message: { kind: "error" | "success" | "info"; text: string } | undefined;

let closing = false;

readline.emitKeypressEvents(process.stdin);

if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
  throw new Error("Schlepr requires an interactive terminal popup");
}

process.stdin.setRawMode(true);

process.stdin.resume();

process.stdout.write("\x1b[?1049h\x1b[?25l");

process.on("SIGWINCH", draw);

process.stdin.on("keypress", (text, key) => {
  void handleKey(text, key).catch(crash);
});

draw();

async function handleKey(text: string | undefined, key: readline.Key): Promise<void> {
  if (busy || closing) return;
  message = undefined;

  if (key.name === "escape" || (key.ctrl && key.name === "c")) return close(0);

  if (key.name === "tab") {
    mode = mode === "pane" ? "tab" : "pane";
    query = "";
    selected = 0;
    targetIndex = 0;

    return draw();
  }

  if (key.name === "up" || (key.ctrl && key.name === "p" && mode === "tab")) {
    selected = Math.max(0, selected - 1);
    targetIndex = 0;

    return draw();
  }

  if (key.name === "down" || (key.ctrl && key.name === "n")) {
    selected = Math.min(Math.max(0, currentItems().length - 1), selected + 1);
    targetIndex = 0;

    return draw();
  }

  if (key.name === "backspace") {
    query = Array.from(query).slice(0, -1).join("");
    selected = 0;
    targetIndex = 0;

    return draw();
  }

  if (key.ctrl && key.name === "u") {
    query = "";
    selected = 0;

    return draw();
  }

  if (key.ctrl && key.name === "l") {
    snapshot = await client.snapshot();
    selected = Math.min(selected, Math.max(0, currentItems().length - 1));
    message = { kind: "info", text: "Refreshed live Herdr state" };

    return draw();
  }

  if (mode === "pane" && key.ctrl && key.name === "d") {
    direction = direction === "right" ? "down" : "right";

    return draw();
  }

  if (mode === "pane" && key.ctrl && key.name === "r") {
    ratioIndex = (ratioIndex + 1) % ratios.length;

    return draw();
  }

  if (mode === "pane" && key.ctrl && key.name === "p") {
    const panes = targetPanes(currentItems()[selected]);
    targetIndex = panes.length ? (targetIndex + 1) % panes.length : 0;

    return draw();
  }

  if (key.name === "return") return performMove();

  if (!key.ctrl && !key.meta && text && isPrintableInput(text)) {
    query += text;
    selected = 0;
    targetIndex = 0;
    draw();
  }
}

async function performMove(): Promise<void> {
  const item = currentItems()[selected];

  if (!item) {
    message = { kind: "error", text: "No destination selected" };

    return draw();
  }

  if (item.disabledReason) {
    message = { kind: "error", text: item.disabledReason };

    return draw();
  }

  busy = true;
  draw();

  try {
    const label = isNewDestination(item) ? query.trim() || undefined : undefined;

    const options: MoveOptions = { direction, ratio: ratios[ratioIndex]! };
    const target = targetPanes(item)[targetIndex];

    if (target) options.targetTerminalId = target.terminal_id;

    if (label) options.label = label;

    const result = mode === "pane"
      ? await executePaneMove(client, sourceTerminalId, originalTabId, item.destination, options)
      : await executeTabMove(client, sourceTerminalId, originalTabId, item.destination, label);

    message = {
      kind: "success",
      text: `Moved ${result.movedPanes} live pane${result.movedPanes === 1 ? "" : "s"} successfully`,
    };
    busy = false;
    draw();
    closing = true;
    setTimeout(() => close(0), 800);
  } catch (error) {
    busy = false;
    message = { kind: "error", text: error instanceof Error ? error.message : String(error) };
    draw();
  }
}

function isPrintableInput(text: string): boolean {
  if (Array.from(text).length !== 1) return false;

  const codePoint = text.codePointAt(0);

  return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
}

function currentSource(): PaneInfo {
  return sourcePane(snapshot, sourceTerminalId);
}

function currentItems(): DestinationItem[] {
  return filterItems(destinationItems(snapshot, mode, currentSource()), query);
}

function targetPanes(item: DestinationItem | undefined): PaneInfo[] {
  if (item?.destination.kind !== "tab") return [];
  const tabId = item.destination.tabId;

  return snapshot.panes.filter((pane) => pane.tab_id === tabId);
}

function missingSource(): never {
  throw new Error("The focused source pane no longer exists");
}

function isNewDestination(item: DestinationItem): boolean {
  return item.destination.kind === "new-tab" || item.destination.kind === "new-workspace";
}

function draw(): void {
  let source: PaneInfo;

  try {
    source = currentSource();
  } catch (error) {
    message = { kind: "error", text: error instanceof Error ? error.message : String(error) };
    source = initialSource;
  }

  const items = currentItems();
  selected = Math.min(selected, Math.max(0, items.length - 1));
  const targets = targetPanes(items[selected]);
  targetIndex = Math.min(targetIndex, Math.max(0, targets.length - 1));

  const renderState: RenderState = {
    snapshot,
    source,
    mode,
    query,
    items,
    selected,
    direction,
    ratio: ratios[ratioIndex]!,
    busy,
  };

  const target = targets[targetIndex];

  if (target) renderState.target = target;

  if (message) renderState.message = message;
  render(renderState);
}

function close(code: number): void {
  if (closing && code !== 0) return;
  closing = true;
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\x1b[?25h\x1b[?1049l");
  process.exit(code);
}

function crash(cause: unknown): void {
  logFailure(cause);
  const text = cause instanceof Error ? cause.stack || cause.message : String(cause);
  process.stdout.write(`\x1b[2J\x1b[H${color.red}Schlepr failed${color.reset}\n\n${text}\n\nPress any key to close.`);

  if (process.stdin.isTTY) process.stdin.once("data", () => close(1));
  else process.exit(1);
}

function logFailure(cause: unknown): void {
  const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;

  if (!stateDir) return;

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const text = cause instanceof Error ? cause.stack || cause.message : String(cause);
    fs.appendFileSync(path.join(stateDir, "errors.log"), `${new Date().toISOString()} ${text}\n`);
  } catch {}
}
