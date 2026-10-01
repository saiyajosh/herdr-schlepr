#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { HerdrClient } from "../herdr/client.js";
import { executePaneMove, executeTabMove } from "../moves/execute.js";
import { destinationItems, filterItems, sourcePane } from "../moves/model.js";
import type { DestinationItem, MoveMode, PaneInfo, SessionSnapshot } from "../types.js";
import { navigateSelection, type NavigationCommand } from "./navigation.js";
import { color, render } from "./render.js";

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
  const navigation = navigationCommand(key);
  if (navigation) {
    selected = navigateSelection(selected, currentItems().length, navigation);
    targetIndex = 0;
    return draw();
  }
  if (key.name === "backspace") {
    query = [...query].slice(0, -1).join("");
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
  if (mode === "pane" && key.ctrl && key.name === "t") {
    const panes = targetPanes(currentItems()[selected]);
    targetIndex = panes.length ? (targetIndex + 1) % panes.length : 0;
    return draw();
  }
  if (key.name === "return") return performMove();
  if (!key.ctrl && !key.meta && text && /^[^\u0000-\u001f\u007f]$/u.test(text)) {
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
    const result = mode === "pane"
      ? await executePaneMove(client, sourceTerminalId, originalTabId, item.destination, {
          direction,
          ratio: ratios[ratioIndex]!,
          ...(targetPanes(item)[targetIndex]?.terminal_id
            ? { targetTerminalId: targetPanes(item)[targetIndex]!.terminal_id }
            : {}),
          ...(label ? { label } : {}),
        })
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

function navigationCommand(key: readline.Key): NavigationCommand | undefined {
  if (key.name === "up" || (key.ctrl && key.name === "k")) return "previous";
  if (key.name === "down" || (key.ctrl && key.name === "j") || (key.ctrl && key.name === "n")) return "next";
  if (key.name === "pageup") return "page-previous";
  if (key.name === "pagedown") return "page-next";
  if (key.name === "home") return "first";
  if (key.name === "end") return "last";
  return undefined;
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
  render({
    snapshot,
    source,
    mode,
    query,
    items,
    selected,
    direction,
    ratio: ratios[ratioIndex]!,
    ...(targets[targetIndex] ? { target: targets[targetIndex] } : {}),
    busy,
    ...(message ? { message } : {}),
  });
}

function close(code: number): void {
  if (closing && code !== 0) return;
  closing = true;
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\x1b[?25h\x1b[?1049l");
  process.exit(code);
}

function crash(error: unknown): void {
  logFailure(error);
  const text = error instanceof Error ? error.stack || error.message : String(error);
  process.stdout.write(`\x1b[2J\x1b[H${color.red}Schlepr failed${color.reset}\n\n${text}\n\nPress any key to close.`);
  if (process.stdin.isTTY) process.stdin.once("data", () => close(1));
  else process.exit(1);
}

function logFailure(error: unknown): void {
  const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!stateDir) return;
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const text = error instanceof Error ? error.stack || error.message : String(error);
    fs.appendFileSync(path.join(stateDir, "errors.log"), `${new Date().toISOString()} ${text}\n`);
  } catch {}
}
