import assert from "node:assert/strict";
import { test } from "node:test";
import { anchor, destinationItems, filterItems, leaves, paneLabel } from "../src/moves/model.js";
import type { LayoutNode, SessionSnapshot } from "../src/types.js";

const snapshot: SessionSnapshot = {
  focused_workspace_id: "w1",
  focused_tab_id: "w1:t1",
  focused_pane_id: "w1:p1",
  workspaces: [
    { workspace_id: "w1", label: "web", number: 1, focused: true, tab_count: 2, pane_count: 2 },
    { workspace_id: "w2", label: "api", number: 2, focused: false, tab_count: 1, pane_count: 2 },
  ],
  tabs: [
    { tab_id: "w1:t1", workspace_id: "w1", label: "code", number: 1, focused: true, pane_count: 1 },
    { tab_id: "w1:t2", workspace_id: "w1", label: "logs", number: 2, focused: false, pane_count: 1 },
    { tab_id: "w2:t1", workspace_id: "w2", label: "server", number: 1, focused: false, pane_count: 2 },
  ],
  panes: [
    { pane_id: "w1:p1", terminal_id: "term-1", workspace_id: "w1", tab_id: "w1:t1", focused: true, terminal_title: "editor" },
    { pane_id: "w1:p2", terminal_id: "term-2", workspace_id: "w1", tab_id: "w1:t2", focused: true },
    { pane_id: "w2:p1", terminal_id: "term-3", workspace_id: "w2", tab_id: "w2:t1", focused: true },
    { pane_id: "w2:p2", terminal_id: "term-4", workspace_id: "w2", tab_id: "w2:t1", focused: false },
  ],
  layouts: [
    { workspace_id: "w1", tab_id: "w1:t1", zoomed: false, focused_pane_id: "w1:p1", panes: [], splits: [], area: { x: 0, y: 0, width: 80, height: 24 } },
    { workspace_id: "w1", tab_id: "w1:t2", zoomed: false, focused_pane_id: "w1:p2", panes: [], splits: [], area: { x: 0, y: 0, width: 80, height: 24 } },
    { workspace_id: "w2", tab_id: "w2:t1", zoomed: true, focused_pane_id: "w2:p1", panes: [], splits: [], area: { x: 0, y: 0, width: 80, height: 24 } },
  ],
  agents: [],
};

const source = snapshot.panes[0]!;

test("pane destinations span workspaces, include creators, and mark zoomed tabs", () => {
  const items = destinationItems(snapshot, "pane", source);
  assert.equal(items.some((item) => item.id === "tab:w1:t1"), false);
  assert.equal(items.find((item) => item.id === "tab:w2:t1")?.disabledReason, "target tab is zoomed");
  assert.equal(items.filter((item) => item.destination.kind === "new-tab").length, 2);
  assert.equal(items.at(-1)?.destination.kind, "new-workspace");
});

test("tab destinations exclude the source workspace", () => {
  const items = destinationItems(snapshot, "tab", source);
  assert.deepEqual(items.map((item) => item.id), ["workspace:w2", "new-workspace"]);
});

test("filter keeps destination creation available so the query can become its name", () => {
  const items = filterItems(destinationItems(snapshot, "pane", source), "brand new thing");
  assert.equal(items.some((item) => item.destination.kind === "new-workspace"), true);
  assert.equal(items.some((item) => item.destination.kind === "new-tab"), true);
  assert.equal(items.some((item) => item.destination.kind === "tab"), false);
});

test("layout helpers preserve BSP leaf order", () => {
  const root: LayoutNode = {
    type: "split",
    direction: "right",
    ratio: 0.6,
    first: { type: "pane", pane_id: "a" },
    second: {
      type: "split",
      direction: "down",
      ratio: 0.5,
      first: { type: "pane", pane_id: "b" },
      second: { type: "pane", pane_id: "c" },
    },
  };
  assert.equal(anchor(root), "a");
  assert.deepEqual(leaves(root), ["a", "b", "c"]);
});

test("pane labels prefer terminal presentation over opaque IDs", () => {
  assert.equal(paneLabel(source), "editor");
});
