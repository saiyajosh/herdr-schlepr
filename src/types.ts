export type MoveMode = "pane" | "tab";
export type SplitDirection = "right" | "down";

export interface WorkspaceInfo {
  workspace_id: string;
  label?: string;
  number: number;
  focused: boolean;
  active_tab_id?: string;
  tab_count: number;
  pane_count: number;
  agent_status?: string;
  worktree?: unknown;
}

export interface TabInfo {
  tab_id: string;
  workspace_id: string;
  label?: string;
  number: number;
  focused: boolean;
  pane_count: number;
  agent_status?: string;
}

export interface PaneInfo {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  cwd?: string;
  foreground_cwd?: string;
  agent?: string;
  agent_status?: string;
  title?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
}

export interface LayoutSnapshot {
  workspace_id: string;
  tab_id: string;
  zoomed: boolean;
  focused_pane_id: string;
  panes: Array<{ pane_id: string; focused: boolean; rect: Rect }>;
  splits: Array<{ direction: SplitDirection; ratio: number; rect: Rect }>;
  area: Rect;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SessionSnapshot {
  focused_workspace_id: string;
  focused_tab_id: string;
  focused_pane_id: string;
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  layouts: LayoutSnapshot[];
  agents: PaneInfo[];
}

export type LayoutNode =
  | { type: "pane"; pane_id: string; label?: string; cwd?: string; command?: string[] }
  | {
      type: "split";
      direction: SplitDirection;
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    };

export interface ExportedLayout {
  workspace_id: string;
  tab_id: string;
  zoomed: boolean;
  focused_pane_id: string;
  root: LayoutNode;
}

export type Destination =
  | { kind: "tab"; workspaceId: string; tabId: string }
  | { kind: "new-tab"; workspaceId: string }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "new-workspace" };

export interface DestinationItem {
  id: string;
  section: string;
  label: string;
  detail: string;
  search: string;
  destination: Destination;
  disabledReason?: string;
}

export interface MoveOptions {
  direction: SplitDirection;
  ratio: number;
  targetTerminalId?: string;
  label?: string;
}

export interface MoveOutcome {
  pane: PaneInfo;
  previous_pane_id: string;
  previous_workspace_id: string;
  previous_tab_id: string;
  closed_workspace_id?: string;
  closed_tab_id?: string;
}
