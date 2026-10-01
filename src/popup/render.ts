import { paneLabel, tabLabel, workspaceLabel } from "../moves/model.js";
import type { DestinationItem, MoveMode, PaneInfo, SessionSnapshot } from "../types.js";

const ESC = "\x1b[";
export const color = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  accent: `${ESC}38;5;75m`,
  accentBright: `${ESC}38;5;117m`,
  cyan: `${ESC}38;5;80m`,
  yellow: `${ESC}38;5;221m`,
  red: `${ESC}38;5;203m`,
  green: `${ESC}38;5;114m`,
  muted: `${ESC}38;5;246m`,
  faint: `${ESC}38;5;240m`,
  selected: `${ESC}48;5;24m${ESC}38;5;231m`,
  selectedMuted: `${ESC}48;5;24m${ESC}38;5;153m`,
};

export interface RenderState {
  snapshot: SessionSnapshot;
  source: PaneInfo;
  mode: MoveMode;
  query: string;
  items: DestinationItem[];
  selected: number;
  direction: "right" | "down";
  ratio: number;
  target?: PaneInfo;
  busy: boolean;
  message?: { kind: "error" | "success" | "info"; text: string };
}

export function render(state: RenderState): void {
  const width = Math.max(48, process.stdout.columns || 88);
  const height = Math.max(22, process.stdout.rows || 36);
  const contentWidth = width - 4;
  const sourceTab = state.snapshot.tabs.find((tab) => tab.tab_id === state.source.tab_id);
  const sourceWorkspace = state.snapshot.workspaces.find((workspace) => workspace.workspace_id === state.source.workspace_id);
  const sourceKind = state.mode === "pane" ? "PANE TO MOVE" : "TAB TO MOVE";
  const sourceName = state.mode === "pane"
    ? paneLabel(state.source)
    : sourceTab
      ? tabLabel(sourceTab)
      : state.source.tab_id;
  const workspaceName = sourceWorkspace ? workspaceLabel(sourceWorkspace) : state.source.workspace_id;
  const tabName = sourceTab ? tabLabel(sourceTab) : state.source.tab_id;
  const sourceLocation = workspaceName === tabName ? workspaceName : `${workspaceName}  ›  ${tabName}`;
  const selectionCount = state.items.length === 0 ? "0 / 0" : `${state.selected + 1} / ${state.items.length}`;
  const lines: string[] = [
    "",
    `  ${color.accentBright}${color.bold}⇢  MOVE LIVE TERMINALS${color.reset}`,
    `  ${color.muted}Relocate a pane or tab without interrupting its process.${color.reset}`,
    "",
    `  ${color.accent}${color.bold}${sourceKind}${color.reset}`,
    `  ${color.accent}┃${color.reset}  ${color.bold}${clip(sourceName, contentWidth - 4)}${color.reset}`,
    `  ${color.accent}┃${color.reset}  ${color.muted}${clip(sourceLocation, contentWidth - 4)}${color.reset}${sourceWarning(state.snapshot, state.source, state.mode)}`,
    "",
    `  ${color.muted}MOVE${color.reset}  ${modePill("pane", state.mode)}  ${modePill("tab", state.mode)}  ${color.faint}Tab switches mode${color.reset}`,
    "",
    `  ${color.accent}${color.bold}DESTINATION${color.reset}${" ".repeat(Math.max(1, contentWidth - 11 - selectionCount.length))}${color.muted}${selectionCount}${color.reset}`,
    `  ${color.cyan}⌕${color.reset}  ${state.query ? `${color.bold}${clip(state.query, contentWidth - 4)}${color.reset}` : `${color.faint}Filter destinations or type a name for a new one…${color.reset}`}`,
    `  ${color.faint}${"─".repeat(contentWidth)}${color.reset}`,
  ];

  const reservedRows = lines.length + 7;
  const listHeight = Math.max(3, Math.min(12, height - reservedRows));
  const start = Math.max(0, Math.min(state.selected - Math.floor(listHeight / 2), state.items.length - listHeight));
  const visible = state.items.slice(start, start + listHeight);
  const sectionWidth = Math.min(22, Math.max(9, ...visible.map((item) => visibleLength(item.section))));

  if (visible.length === 0) lines.push(`  ${color.muted}No matches. Clear the filter with Ctrl-U.${color.reset}`);
  for (let index = 0; index < visible.length; index++) {
    const item = visible[index]!;
    const selected = start + index === state.selected;
    lines.push(destinationRow(item, selected, contentWidth, sectionWidth));
  }

  lines.push(`  ${color.faint}${"─".repeat(contentWidth)}${color.reset}`);
  lines.push(detailLine(state, contentWidth));
  if (state.message) {
    const tone = state.message.kind === "error" ? color.red : state.message.kind === "success" ? color.green : color.cyan;
    lines.push(`  ${tone}${clip(state.message.text, contentWidth)}${color.reset}`);
  } else if (state.busy) {
    lines.push(`  ${color.cyan}${color.bold}Moving live terminal${state.mode === "tab" ? "s" : ""}…${color.reset}`);
  } else {
    lines.push("");
  }
  lines.push(`  ${color.muted}↑↓${color.reset} select   ${color.muted}PgUp/PgDn${color.reset} jump   ${color.muted}Home/End${color.reset} edges   ${color.muted}Tab${color.reset} pane/tab`);
  lines.push(
    state.mode === "pane"
      ? `  ${color.muted}Enter${color.reset} move   ${color.muted}^D${color.reset} direction   ${color.muted}^R${color.reset} ratio   ${color.muted}^T${color.reset} target   ${color.muted}^L${color.reset} refresh   ${color.muted}Esc${color.reset} close`
      : `  ${color.muted}Enter${color.reset} move tab   ${color.muted}^L${color.reset} refresh   ${color.muted}Esc${color.reset} close`,
  );

  process.stdout.write(`${ESC}H${ESC}2J${lines.slice(0, height).join("\n")}`);
}

function modePill(mode: MoveMode, active: MoveMode): string {
  const label = ` ${mode.toUpperCase()} `;
  return mode === active ? `${color.selected}${color.bold}${label}${color.reset}` : `${color.faint}${label}${color.reset}`;
}

function destinationRow(item: DestinationItem, selected: boolean, width: number, sectionWidth: number): string {
  const section = padRight(clip(item.section, sectionWidth), sectionWidth);
  const detail = item.disabledReason ?? item.detail;
  const detailWidth = Math.min(28, visibleLength(detail) + 2);
  const labelWidth = Math.max(10, width - sectionWidth - detailWidth - 7);
  const body = `${section}  ›  ${padRight(clip(item.label, labelWidth), labelWidth)}  ${padRight(clip(detail, detailWidth - 2), detailWidth - 2)}`;
  if (selected) return `  ${color.selected}${color.bold}▌ ${padRight(body, width - 2)}${color.reset}`;
  const sectionTone = item.destination.kind === "new-tab" || item.destination.kind === "new-workspace" ? color.cyan : color.muted;
  const detailTone = item.disabledReason ? color.yellow : color.faint;
  return `    ${sectionTone}${section}${color.reset}  ${color.faint}›${color.reset}  ${padRight(clip(item.label, labelWidth), labelWidth)}  ${detailTone}${clip(detail, detailWidth - 2)}${color.reset}`;
}

function detailLine(state: RenderState, width: number): string {
  const selection = state.items[state.selected];
  if (state.mode === "pane" && selection?.destination.kind === "tab") {
    const target = state.target ? paneLabel(state.target) : "focused pane";
    return `  ${color.muted}PLACEMENT${color.reset}  ${color.bold}${state.direction}${color.reset} split  ${color.faint}·${color.reset}  ${Math.round(state.ratio * 100)}%  ${color.faint}·${color.reset}  target ${color.bold}${clip(target, Math.max(8, width - 50))}${color.reset}`;
  }
  return `  ${color.muted}${state.mode === "tab" ? "TAB LAYOUT" : "DESTINATION"}${color.reset}  ${color.faint}${state.mode === "tab" ? "split geometry and live processes are preserved" : "a new tab will be created for this pane"}${color.reset}`;
}

function sourceWarning(snapshot: SessionSnapshot, source: PaneInfo, mode: MoveMode): string {
  const tab = snapshot.tabs.find((candidate) => candidate.tab_id === source.tab_id);
  const workspace = snapshot.workspaces.find((candidate) => candidate.workspace_id === source.workspace_id);
  const closesTab = mode === "tab" || tab?.pane_count === 1;
  const closesWorkspace = closesTab && workspace?.tab_count === 1;
  if (closesWorkspace) return `  ${color.yellow}· source workspace closes${workspace?.worktree ? " (linked worktree)" : ""}${color.reset}`;
  if (closesTab) return `  ${color.yellow}· source tab closes${color.reset}`;
  return "";
}

export function clip(value: string, width: number): string {
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ");
  if (visibleLength(clean) <= width) return clean;
  return `${[...clean].slice(0, Math.max(0, width - 1)).join("")}…`;
}

function padRight(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visibleLength(value)))}`;
}

function visibleLength(value: string): number {
  return [...value.replace(/\x1b\[[0-9;]*m/g, "")].length;
}
