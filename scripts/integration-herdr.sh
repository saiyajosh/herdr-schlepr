#!/usr/bin/env bash
# Opt-in live integration test. Creates two temporary Herdr workspaces, moves a
# two-pane tab between them, verifies stable terminal IDs, and cleans up.
set -euo pipefail

cd "$(dirname "$0")/.."
test "${HERDR_ENV:-}" = 1 || { echo "Run this inside Herdr." >&2; exit 1; }

snapshot=$(herdr api snapshot)
original_workspace=$(jq -r '.result.snapshot.focused_workspace_id' <<<"$snapshot")
original_tab=$(jq -r '.result.snapshot.focused_tab_id' <<<"$snapshot")
source_workspace=""
destination_workspace=""

cleanup() {
  herdr workspace focus "$original_workspace" >/dev/null 2>&1 || true
  herdr tab focus "$original_tab" >/dev/null 2>&1 || true
  [[ -z "$source_workspace" ]] || herdr workspace close "$source_workspace" >/dev/null 2>&1 || true
  [[ -z "$destination_workspace" ]] || herdr workspace close "$destination_workspace" >/dev/null 2>&1 || true
}
trap cleanup EXIT

source_json=$(herdr workspace create --cwd "$PWD" --label schlepr-integration-source --no-focus)
source_workspace=$(jq -r '.result.workspace.workspace_id' <<<"$source_json")
source_tab=$(jq -r '.result.tab.tab_id' <<<"$source_json")
first_pane=$(jq -r '.result.root_pane.pane_id' <<<"$source_json")
first_terminal=$(jq -r '.result.root_pane.terminal_id' <<<"$source_json")
second_json=$(herdr pane split "$first_pane" --direction right --ratio 0.6 --cwd "$PWD" --no-focus)
second_terminal=$(jq -r '.result.pane.terminal_id' <<<"$second_json")

destination_json=$(herdr workspace create --cwd "$PWD" --label schlepr-integration-target --no-focus)
destination_workspace=$(jq -r '.result.workspace.workspace_id' <<<"$destination_json")

SCHLEPR_TEST_T1="$first_terminal" \
SCHLEPR_TEST_T2="$second_terminal" \
SCHLEPR_TEST_TAB="$source_tab" \
SCHLEPR_TEST_DST="$destination_workspace" \
node --import tsx --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { HerdrClient } from "./src/herdr/client.ts";
import { executeTabMove } from "./src/moves/execute.ts";

const client = new HerdrClient();
const terminals = [process.env.SCHLEPR_TEST_T1, process.env.SCHLEPR_TEST_T2];
const result = await executeTabMove(client, terminals[0], process.env.SCHLEPR_TEST_TAB, {
  kind: "workspace",
  workspaceId: process.env.SCHLEPR_TEST_DST,
});
const after = await client.snapshot();
const moved = after.panes.filter((pane) => terminals.includes(pane.terminal_id));
assert.equal(result.movedPanes, 2);
assert.equal(moved.length, 2);
assert.ok(moved.every((pane) => pane.workspace_id === process.env.SCHLEPR_TEST_DST && pane.tab_id === result.tabId));
console.log(`Schlepr integration passed: ${terminals.join(", ")} -> ${result.tabId}`);
NODE
