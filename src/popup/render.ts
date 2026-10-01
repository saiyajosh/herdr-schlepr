import type { DestinationItem, MoveMode, PaneInfo, SessionSnapshot } from "../types.js";
import { paneLabel, tabLabel, workspaceLabel } from "../moves/model.js";

const ESCAPE = String.fromCharCode(27);

const ESC = `${ESCAPE}[`;

const ANSI_STYLE_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "g");

export const color = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  blue: `${ESC}34m`,
  cyan: `${ESC}36m`,
  yellow: `${ESC}33m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  inverse: `${ESC}7m`,
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
  const width = Math.max(40, process.stdout.columns || 80);
  const height = Math.max(16, process.stdout.rows || 24);
  const sourceTab = state.snapshot.tabs.find((tab) => tab.tab_id === state.source.tab_id);
  const sourceWorkspace = state.snapshot.workspaces.find((workspace) => workspace.workspace_id === state.source.workspace_id);
  const title = `${color.bold}${color.blue}SCHLEPR${color.reset}  move live terminals without unpacking them`;

  const mode = state.mode === "pane"
    ? `${color.inverse} PANE ${color.reset}  TAB `
    : ` PANE  ${color.inverse} TAB ${color.reset}`;

  const breadcrumb = `${sourceWorkspace ? workspaceLabel(sourceWorkspace) : state.source.workspace_id} / ${sourceTab ? tabLabel(sourceTab) : state.source.tab_id} / ${paneLabel(state.source)}`;

  const lines: string[] = [
    title,
    `${color.dim}source${color.reset}  ${clip(breadcrumb, width - 9)}`,
    `${mode}  ${color.dim}[tab switches mode]${color.reset}`,
    "",
    `${color.cyan}›${color.reset} ${state.query || `${color.dim}type to filter or name a new destination${color.reset}`}`,
    rule(width),
  ];

  const footerRows = 7;
  const listHeight = Math.max(3, height - lines.length - footerRows);
  const start = Math.max(0, Math.min(state.selected - Math.floor(listHeight / 2), state.items.length - listHeight));
  const visible = state.items.slice(start, start + listHeight);

  if (visible.length === 0) lines.push(`  ${color.dim}No matching destinations${color.reset}`);

  for (let index = 0; index < listHeight; index++) {
    const item = visible[index];

    if (!item) {
      lines.push("");
      continue;
    }

    const absolute = start + index;
    const selected = absolute === state.selected;
    const prefix = selected ? `${color.blue}▌${color.reset}` : " ";
    const disabled = item.disabledReason ? color.dim : "";
    const suffix = item.disabledReason ? `  ${color.yellow}${item.disabledReason}${color.reset}` : `  ${color.dim}${item.detail}${color.reset}`;
    lines.push(`${prefix} ${selected ? color.bold : ""}${disabled}${clip(item.label, Math.max(12, width - plainLength(suffix) - 5))}${color.reset}${suffix}`);
  }

  lines.push(rule(width));
  const selection = state.items[state.selected];

  if (state.mode === "pane" && selection?.destination.kind === "tab") {
    lines.push(
      `${color.dim}placement${color.reset}  split ${color.bold}${state.direction}${color.reset} · ratio ${Math.round(state.ratio * 100)}% · target ${color.bold}${state.target ? paneLabel(state.target) : "focused pane"}${color.reset}`,
    );
  } else {
    const warning = closeWarning(state.snapshot, state.source, state.mode);
    lines.push(warning ? `${color.yellow}⚠ ${warning}${color.reset}` : "");
  }

  if (state.message) {
    const tone = state.message.kind === "error" ? color.red : state.message.kind === "success" ? color.green : color.cyan;
    lines.push(`${tone}${clip(state.message.text, width)}${color.reset}`);
  } else lines.push("");
  lines.push(
    state.mode === "pane"
      ? `${color.dim}↑↓ navigate  enter move  ^D direction  ^R ratio  ^P target  ^L refresh  esc cancel${color.reset}`
      : `${color.dim}↑↓ navigate  enter move tab  ^L refresh  tab pane mode  esc cancel${color.reset}`,
  );

  if (state.busy) lines.push(`${color.cyan}Moving…${color.reset}`);

  process.stdout.write(`${ESC}H${ESC}2J${lines.slice(0, height).join("\n")}`);
}

function closeWarning(snapshot: SessionSnapshot, source: PaneInfo, mode: MoveMode): string | undefined {
  const tab = snapshot.tabs.find((candidate) => candidate.tab_id === source.tab_id);
  const workspace = snapshot.workspaces.find((candidate) => candidate.workspace_id === source.workspace_id);
  const closesTab = mode === "tab" || tab?.pane_count === 1;
  const closesWorkspace = closesTab && workspace?.tab_count === 1;

  if (closesWorkspace) return `source workspace will close${workspace?.worktree ? " (linked worktree)" : ""}`;

  if (closesTab) return "source tab will close";

  return undefined;
}

function rule(width: number): string {
  return `${color.dim}${"─".repeat(Math.max(1, width - 1))}${color.reset}`;
}

export function clip(value: string, width: number): string {
  const clean = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && (codePoint < 32 || codePoint === 127) ? " " : character;
  }).join("");

  if (plainLength(clean) <= width) return clean;

  return `${Array.from(clean).slice(0, Math.max(0, width - 1)).join("")}…`;
}

function plainLength(value: string): number {
  return Array.from(value.replace(ANSI_STYLE_PATTERN, "")).length;
}
