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
    pane.foreground_cwd?.split("/").filter(Boolean).at(-1) ||
    pane.pane_id
  );
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
      result.push({
        id: `tab:${tab.tab_id}`,
        section: wsName,
        label: name,
        detail: `${tab.pane_count} pane${tab.pane_count === 1 ? "" : "s"}${tab.agent_status ? ` · ${tab.agent_status}` : ""}`,
        search: `${wsName} ${name} ${tab.tab_id}`,
        destination: { kind: "tab", workspaceId: tab.workspace_id, tabId: tab.tab_id },
        ...(disabledReason ? { disabledReason } : {}),
      });
    }
    for (const workspace of snapshot.workspaces) {
      const name = workspaceLabel(workspace);
      result.push({
        id: `new-tab:${workspace.workspace_id}`,
        section: name,
        label: "＋ New tab",
        detail: "create here",
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
        section: "Workspace",
        label: name,
        detail: `${workspace.tab_count} tab${workspace.tab_count === 1 ? "" : "s"} · ${workspace.pane_count} pane${workspace.pane_count === 1 ? "" : "s"}`,
        search: `${name} ${workspace.workspace_id}`,
        destination: { kind: "workspace", workspaceId: workspace.workspace_id },
      });
    }
  }

  result.push({
    id: "new-workspace",
    section: "Create",
    label: "＋ New workspace",
    detail: "query becomes its name",
    search: "new workspace create",
    destination: { kind: "new-workspace" },
  });
  return result;
}

export function filterItems(items: DestinationItem[], query: string): DestinationItem[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  return items
    .map((item, index) => {
      const haystack = item.search.toLocaleLowerCase();
      const isCreator = item.destination.kind === "new-tab" || item.destination.kind === "new-workspace";
      const matches = isCreator || terms.every((term) => haystack.includes(term));
      const rank = isCreator ? 2 : haystack.startsWith(terms.join(" ")) ? 0 : 1;
      return { item, index, matches, rank };
    })
    .filter((entry) => entry.matches)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
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
