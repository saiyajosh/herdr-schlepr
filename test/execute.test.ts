import assert from "node:assert/strict";
import { test } from "node:test";
import { executePaneMove, executeTabMove, type MoveClient } from "../src/moves/execute.js";
import type { ExportedLayout, MoveOutcome, PaneInfo, SessionSnapshot } from "../src/types.js";

class FakeClient implements MoveClient {
  calls: Array<{ paneId: string; destination: Record<string, unknown>; focus: boolean }> = [];
  focused: [string, string] | undefined;
  nextPane = 10;

  constructor(
    readonly state: SessionSnapshot,
    readonly exported: ExportedLayout,
  ) {}

  async snapshot(): Promise<SessionSnapshot> {
    return structuredClone(this.state);
  }

  async exportLayout(): Promise<ExportedLayout> {
    return structuredClone(this.exported);
  }

  async movePane(paneId: string, destination: Record<string, unknown>, focus: boolean): Promise<MoveOutcome> {
    this.calls.push({ paneId, destination, focus });
    const pane = this.state.panes.find((candidate) => candidate.pane_id === paneId);
    if (!pane) throw new Error(`missing ${paneId}`);
    const previous = { pane: paneId, workspace: pane.workspace_id, tab: pane.tab_id };
    let workspaceId: string;
    let tabId: string;
    if (destination.type === "tab") {
      tabId = String(destination.tab_id);
      workspaceId = this.state.tabs.find((tab) => tab.tab_id === tabId)!.workspace_id;
    } else if (destination.type === "new_tab") {
      workspaceId = String(destination.workspace_id);
      tabId = `${workspaceId}:t-new`;
      if (!this.state.tabs.some((tab) => tab.tab_id === tabId)) {
        this.state.tabs.push({ tab_id: tabId, workspace_id: workspaceId, number: 9, focused: false, pane_count: 0 });
      }
    } else {
      workspaceId = "w-new";
      tabId = "w-new:t1";
      if (!this.state.workspaces.some((workspace) => workspace.workspace_id === workspaceId)) {
        this.state.workspaces.push({ workspace_id: workspaceId, number: 9, focused: false, tab_count: 1, pane_count: 0 });
        this.state.tabs.push({ tab_id: tabId, workspace_id: workspaceId, number: 1, focused: false, pane_count: 0 });
      }
    }
    pane.workspace_id = workspaceId;
    pane.tab_id = tabId;
    pane.pane_id = `${workspaceId}:p${this.nextPane++}`;
    return {
      pane: structuredClone(pane),
      previous_pane_id: previous.pane,
      previous_workspace_id: previous.workspace,
      previous_tab_id: previous.tab,
    };
  }

  async focus(workspaceId: string, tabId: string): Promise<void> {
    this.focused = [workspaceId, tabId];
  }
}

function fixture(): { state: SessionSnapshot; layout: ExportedLayout } {
  const panes: PaneInfo[] = [
    { pane_id: "w1:p1", terminal_id: "term-a", workspace_id: "w1", tab_id: "w1:t1", focused: true },
    { pane_id: "w1:p2", terminal_id: "term-b", workspace_id: "w1", tab_id: "w1:t1", focused: false },
    { pane_id: "w1:p3", terminal_id: "term-c", workspace_id: "w1", tab_id: "w1:t1", focused: false },
    { pane_id: "w2:p1", terminal_id: "term-target", workspace_id: "w2", tab_id: "w2:t1", focused: true },
  ];
  const state: SessionSnapshot = {
    focused_workspace_id: "w1",
    focused_tab_id: "w1:t1",
    focused_pane_id: "w1:p1",
    workspaces: [
      { workspace_id: "w1", number: 1, focused: true, tab_count: 1, pane_count: 3 },
      { workspace_id: "w2", number: 2, focused: false, tab_count: 1, pane_count: 1 },
    ],
    tabs: [
      { tab_id: "w1:t1", workspace_id: "w1", label: "source", number: 1, focused: true, pane_count: 3 },
      { tab_id: "w2:t1", workspace_id: "w2", label: "target", number: 1, focused: false, pane_count: 1 },
    ],
    panes,
    agents: [],
    layouts: [
      { workspace_id: "w1", tab_id: "w1:t1", zoomed: false, focused_pane_id: "w1:p1", panes: [], splits: [], area: { x: 0, y: 0, width: 120, height: 40 } },
      { workspace_id: "w2", tab_id: "w2:t1", zoomed: false, focused_pane_id: "w2:p1", panes: [], splits: [], area: { x: 0, y: 0, width: 120, height: 40 } },
    ],
  };
  const layout: ExportedLayout = {
    workspace_id: "w1",
    tab_id: "w1:t1",
    zoomed: false,
    focused_pane_id: "w1:p1",
    root: {
      type: "split",
      direction: "right",
      ratio: 0.6,
      first: { type: "pane", pane_id: "w1:p1" },
      second: {
        type: "split",
        direction: "down",
        ratio: 0.4,
        first: { type: "pane", pane_id: "w1:p2" },
        second: { type: "pane", pane_id: "w1:p3" },
      },
    },
  };
  return { state, layout };
}

test("pane move uses the selected target, direction, and ratio", async () => {
  const { state, layout } = fixture();
  const client = new FakeClient(state, layout);
  const result = await executePaneMove(
    client,
    "term-a",
    "w1:t1",
    { kind: "tab", workspaceId: "w2", tabId: "w2:t1" },
    { direction: "down", ratio: 0.67, targetTerminalId: "term-target" },
  );
  assert.equal(result.tabId, "w2:t1");
  assert.deepEqual(client.calls[0]?.destination, {
    type: "tab",
    tab_id: "w2:t1",
    target_pane_id: "w2:p1",
    split: "down",
    ratio: 0.67,
  });
});

test("tab move replays the exact exported split tree with live panes", async () => {
  const { state, layout } = fixture();
  const client = new FakeClient(state, layout);
  const result = await executeTabMove(
    client,
    "term-a",
    "w1:t1",
    { kind: "workspace", workspaceId: "w2" },
  );
  assert.equal(result.movedPanes, 3);
  assert.equal(result.tabId, "w2:t-new");
  assert.equal(client.calls.length, 3);
  assert.deepEqual(client.calls.map((call) => [call.destination.type, call.destination.split, call.destination.ratio]), [
    ["new_tab", undefined, undefined],
    ["tab", "right", 0.6],
    ["tab", "down", 0.4],
  ]);
  assert.deepEqual(client.focused, ["w2", "w2:t-new"]);
  assert.deepEqual(
    state.panes.filter((pane) => pane.terminal_id.startsWith("term-") && pane.terminal_id !== "term-target").map((pane) => pane.tab_id),
    ["w2:t-new", "w2:t-new", "w2:t-new"],
  );
});

test("tab move refuses a changed source before mutation", async () => {
  const { state, layout } = fixture();
  state.panes[0]!.tab_id = "w2:t1";
  const client = new FakeClient(state, layout);
  await assert.rejects(
    executeTabMove(client, "term-a", "w1:t1", { kind: "workspace", workspaceId: "w2" }),
    /source tab changed/,
  );
  assert.equal(client.calls.length, 0);
});
