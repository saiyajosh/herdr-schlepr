import type {
  DestinationItem,
  LayoutNode,
  MoveMode,
  PaneInfo,
  SessionSnapshot,
  TabInfo,
  WorkspaceInfo,
} from "../types.js";

export function workspaceLabel(workspace: WorkspaceInfo): string {
  return workspace.label?.trim() || `Workspace ${workspace.number}`;
}

export function tabLabel(tab: TabInfo): string {
  return tab.label?.trim() || `Tab ${tab.number}`;
}

export function paneLabel(pane: PaneInfo): string {
  return (
    pane.title?.trim() ||
    pane.terminal_title_stripped?.trim() ||
    pane.terminal_title?.trim() ||
    pane.agent?.trim() ||
    finalPathSegment(pane.foreground_cwd) ||
    pane.pane_id
  );
}

function finalPathSegment(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const normalized = value.endsWith("/") ? value.slice(0, -1) : value;
  const separator = normalized.lastIndexOf("/");

  return normalized.slice(separator + 1) || undefined;
}

export function sourcePane(snapshot: SessionSnapshot, sourceTerminalId: string): PaneInfo {
  const pane = snapshot.panes.find((candidate) => candidate.terminal_id === sourceTerminalId);

  if (!pane) throw new Error("The source terminal no longer exists");

  return pane;
}

export function destinationItems(
  snapshot: SessionSnapshot,
  mode: MoveMode,
  source: PaneInfo,
): DestinationItem[] {
  const workspaces = new Map(snapshot.workspaces.map((workspace) => [workspace.workspace_id, workspace]));
  const layouts = new Map(snapshot.layouts.map((layout) => [layout.tab_id, layout]));
  const result: DestinationItem[] = [];

  if (mode === "pane") {
    for (const tab of snapshot.tabs) {
      if (tab.tab_id === source.tab_id) continue;
      const workspace = workspaces.get(tab.workspace_id);

      if (!workspace) continue;
      const disabledReason = layouts.get(tab.tab_id)?.zoomed ? "target tab is zoomed" : undefined;
      const wsName = workspaceLabel(workspace);
      const name = tabLabel(tab);

      const item: DestinationItem = {
        id: `tab:${tab.tab_id}`,
        label: `${wsName}  /  ${name}`,
        detail: `${tab.pane_count} pane${tab.pane_count === 1 ? "" : "s"}${tab.agent_status ? ` · ${tab.agent_status}` : ""}`,
        search: `${wsName} ${name} ${tab.tab_id}`,
        destination: { kind: "tab", workspaceId: tab.workspace_id, tabId: tab.tab_id },
      };

      if (disabledReason) item.disabledReason = disabledReason;
      result.push(item);
    }

    for (const workspace of snapshot.workspaces) {
      const name = workspaceLabel(workspace);
      result.push({
        id: `new-tab:${workspace.workspace_id}`,
        label: `${name}  /  ＋ new tab`,
        detail: "create a tab and keep the terminal live",
        search: `${name} new tab ${workspace.workspace_id}`,
        destination: { kind: "new-tab", workspaceId: workspace.workspace_id },
      });
    }
  } else {
    for (const workspace of snapshot.workspaces) {
      if (workspace.workspace_id === source.workspace_id) continue;
      const name = workspaceLabel(workspace);
      result.push({
        id: `workspace:${workspace.workspace_id}`,
        label: name,
        detail: `${workspace.tab_count} tab${workspace.tab_count === 1 ? "" : "s"} · ${workspace.pane_count} pane${workspace.pane_count === 1 ? "" : "s"}`,
        search: `${name} ${workspace.workspace_id}`,
        destination: { kind: "workspace", workspaceId: workspace.workspace_id },
      });
    }
  }

  result.push({
    id: "new-workspace",
    label: "＋ new workspace",
    detail: "type a name, then move",
    search: "new workspace create",
    destination: { kind: "new-workspace" },
  });

  return result;
}

export function filterItems(items: DestinationItem[], query: string): DestinationItem[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);

  if (terms.length === 0) return items;

  const ranked: Array<{ item: DestinationItem; index: number; rank: number }> = [];

  for (const [index, item] of items.entries()) {
    const haystack = item.search.toLocaleLowerCase();
    const isCreator = item.destination.kind === "new-tab" || item.destination.kind === "new-workspace";
    const matches = isCreator || terms.every((term) => haystack.includes(term));

    if (!matches) continue;

    const rank = isCreator ? 2 : haystack.startsWith(terms.join(" ")) ? 0 : 1;
    ranked.push({ item, index, rank });
  }

  const ordered: typeof ranked = [];

  for (const entry of ranked) {
    const position = ordered.findIndex((candidate) =>
      candidate.rank > entry.rank || (candidate.rank === entry.rank && candidate.index > entry.index));

    if (position === -1) ordered.push(entry);
    else ordered.splice(position, 0, entry);
  }

  return ordered.map((entry) => entry.item);
}

export function leaves(node: LayoutNode, output: string[] = []): string[] {
  if (node.type === "pane") output.push(node.pane_id);
  else {
    leaves(node.first, output);
    leaves(node.second, output);
  }

  return output;
}

export function anchor(node: LayoutNode): string {
  return node.type === "pane" ? node.pane_id : anchor(node.first);
}

export function paneCount(node: LayoutNode): number {
  return node.type === "pane" ? 1 : paneCount(node.first) + paneCount(node.second);
}
