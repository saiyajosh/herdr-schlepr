import type { HerdrClient } from "../herdr/client.js";
import type {
  Destination,
  ExportedLayout,
  LayoutNode,
  MoveOptions,
  MoveOutcome,
  PaneInfo,
  SessionSnapshot,
  TabInfo,
} from "../types.js";
import { anchor, leaves, sourcePane, tabLabel } from "./model.js";
import { clearJournal, writeJournal } from "./journal.js";

export interface MoveClient {
  snapshot(): Promise<SessionSnapshot>;
  exportLayout(tabId: string): Promise<ExportedLayout>;
  movePane(paneId: string, destination: Record<string, unknown>, focus: boolean): Promise<MoveOutcome>;
  focus(workspaceId: string, tabId: string): Promise<void>;
}

export interface ExecutionResult {
  workspaceId: string;
  tabId: string;
  paneId: string;
  movedPanes: number;
}

export async function executePaneMove(
  client: MoveClient,
  sourceTerminalId: string,
  originalTabId: string,
  destination: Destination,
  options: MoveOptions,
): Promise<ExecutionResult> {
  const fresh = await client.snapshot();
  const source = sourcePane(fresh, sourceTerminalId);
  if (source.tab_id !== originalTabId) throw new Error("The source pane moved while Schlepr was open; nothing was changed");

  let requestDestination: Record<string, unknown>;
  if (destination.kind === "tab") {
    const layout = fresh.layouts.find((candidate) => candidate.tab_id === destination.tabId);
    if (!layout) throw new Error("The destination tab no longer exists");
    if (layout.zoomed) throw new Error("The destination tab is zoomed; unzoom it before moving a pane there");
    const candidates = fresh.panes.filter((pane) => pane.tab_id === destination.tabId);
    const target = options.targetTerminalId
      ? candidates.find((pane) => pane.terminal_id === options.targetTerminalId)
      : candidates.find((pane) => pane.focused) ?? candidates[0];
    if (!target) throw new Error("The destination tab has no target pane");
    requestDestination = {
      type: "tab",
      tab_id: destination.tabId,
      target_pane_id: target.pane_id,
      split: options.direction,
      ratio: options.ratio,
    };
  } else if (destination.kind === "new-tab") {
    requestDestination = {
      type: "new_tab",
      workspace_id: destination.workspaceId,
      ...(options.label ? { label: options.label } : {}),
    };
  } else if (destination.kind === "new-workspace") {
    requestDestination = {
      type: "new_workspace",
      ...(options.label ? { label: options.label, tab_label: options.label } : {}),
    };
  } else {
    throw new Error("A pane must move to a tab, new tab, or new workspace");
  }

  const moved = await client.movePane(source.pane_id, requestDestination, true);
  const verified = await verifyTerminals(client, [sourceTerminalId], moved.pane.tab_id);
  return {
    workspaceId: moved.pane.workspace_id,
    tabId: moved.pane.tab_id,
    paneId: verified[0]!.pane_id,
    movedPanes: 1,
  };
}

export async function executeTabMove(
  client: MoveClient,
  sourceTerminalId: string,
  originalTabId: string,
  destination: Destination,
  labelOverride?: string,
): Promise<ExecutionResult> {
  if (destination.kind !== "workspace" && destination.kind !== "new-workspace") {
    throw new Error("A complete tab must move to a workspace");
  }

  const fresh = await client.snapshot();
  const source = sourcePane(fresh, sourceTerminalId);
  if (source.tab_id !== originalTabId) throw new Error("The source tab changed while Schlepr was open; nothing was changed");
  const sourceLayout = fresh.layouts.find((layout) => layout.tab_id === originalTabId);
  if (!sourceLayout) throw new Error("The source tab no longer exists");
  if (sourceLayout.zoomed) throw new Error("The source tab is zoomed; unzoom it before moving it");

  const exported = await client.exportLayout(originalTabId);
  if (exported.zoomed) throw new Error("The source tab is zoomed; unzoom it before moving it");
  const oldPaneIds = leaves(exported.root);
  const sourcePanes = fresh.panes.filter((pane) => pane.tab_id === originalTabId);
  const paneByOldId = new Map(sourcePanes.map((pane) => [pane.pane_id, pane]));
  if (oldPaneIds.length !== sourcePanes.length || oldPaneIds.some((id) => !paneByOldId.has(id))) {
    throw new Error("The source layout changed during preflight; nothing was changed");
  }

  const sourceTab = fresh.tabs.find((tab) => tab.tab_id === originalTabId);
  const label = labelOverride || (sourceTab ? tabLabel(sourceTab) : "moved");
  const focusedTerminal = paneByOldId.get(exported.focused_pane_id)?.terminal_id ?? sourceTerminalId;
  const terminalByOldId = new Map(oldPaneIds.map((id) => [id, paneByOldId.get(id)!.terminal_id]));
  const newPaneByTerminal = new Map<string, PaneInfo>();
  const terminalIds = [...terminalByOldId.values()];

  writeJournal({
    version: 1,
    status: "moving",
    sourceTabId: originalTabId,
    sourceTerminalIds: terminalIds,
    destination,
    startedAt: new Date().toISOString(),
  });

  try {
    const rootOldId = anchor(exported.root);
    const rootTerminal = terminalByOldId.get(rootOldId)!;
    const rootPane = paneByOldId.get(rootOldId)!;
    const firstDestination =
      destination.kind === "workspace"
        ? { type: "new_tab", workspace_id: destination.workspaceId, label }
        : { type: "new_workspace", label: labelOverride || label, tab_label: label };
    const first = await client.movePane(rootPane.pane_id, firstDestination, rootTerminal === focusedTerminal);
    newPaneByTerminal.set(rootTerminal, first.pane);
    const newTabId = first.pane.tab_id;

    await placeSecondBranches(
      client,
      exported.root,
      newTabId,
      terminalByOldId,
      newPaneByTerminal,
      paneByOldId,
      focusedTerminal,
    );

    await client.focus(first.pane.workspace_id, newTabId);
    const verified = await verifyTerminals(client, terminalIds, newTabId);
    const focused = verified.find((pane) => pane.terminal_id === focusedTerminal) ?? verified[0]!;
    clearJournal();
    return {
      workspaceId: focused.workspace_id,
      tabId: newTabId,
      paneId: focused.pane_id,
      movedPanes: verified.length,
    };
  } catch (error) {
    writeJournal({
      version: 1,
      status: "interrupted",
      sourceTabId: originalTabId,
      sourceTerminalIds: terminalIds,
      destination,
      startedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function placeSecondBranches(
  client: MoveClient,
  node: LayoutNode,
  newTabId: string,
  terminalByOldId: Map<string, string>,
  newPaneByTerminal: Map<string, PaneInfo>,
  paneByOldId: Map<string, PaneInfo>,
  focusedTerminal: string,
): Promise<void> {
  if (node.type === "pane") return;
  const targetTerminal = terminalByOldId.get(anchor(node.first))!;
  const targetPane = newPaneByTerminal.get(targetTerminal);
  if (!targetPane) throw new Error(`Could not resolve destination anchor ${targetTerminal}`);
  const secondOldId = anchor(node.second);
  const secondTerminal = terminalByOldId.get(secondOldId)!;
  const sourcePane = paneByOldId.get(secondOldId);
  if (!sourcePane) throw new Error(`Source pane ${secondOldId} disappeared`);
  const moved = await client.movePane(
    sourcePane.pane_id,
    {
      type: "tab",
      tab_id: newTabId,
      target_pane_id: targetPane.pane_id,
      split: node.direction,
      ratio: node.ratio,
    },
    secondTerminal === focusedTerminal,
  );
  newPaneByTerminal.set(secondTerminal, moved.pane);
  await placeSecondBranches(client, node.first, newTabId, terminalByOldId, newPaneByTerminal, paneByOldId, focusedTerminal);
  await placeSecondBranches(client, node.second, newTabId, terminalByOldId, newPaneByTerminal, paneByOldId, focusedTerminal);
}

async function verifyTerminals(
  client: Pick<HerdrClient, "snapshot"> | MoveClient,
  terminalIds: string[],
  expectedTabId: string,
): Promise<PaneInfo[]> {
  const after = await client.snapshot();
  const expected = new Set(terminalIds);
  const panes = after.panes.filter((pane) => expected.has(pane.terminal_id));
  if (panes.length !== terminalIds.length || panes.some((pane) => pane.tab_id !== expectedTabId)) {
    throw new Error("Move completed only partially; see Schlepr's recovery journal for diagnostics");
  }
  return panes;
}

export function sourceTabFor(snapshot: SessionSnapshot, source: PaneInfo): TabInfo | undefined {
  return snapshot.tabs.find((tab) => tab.tab_id === source.tab_id);
}
