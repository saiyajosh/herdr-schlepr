#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import type { MoveMode } from "./types.js";

const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
const pluginId = process.env.HERDR_PLUGIN_ID ?? "schlepr";
const mode: MoveMode = process.argv[2] === "tab" ? "tab" : "pane";
const context = parseContext(process.env.HERDR_PLUGIN_CONTEXT_JSON);
const paneId = process.env.HERDR_PANE_ID ?? context.focused_pane_id;

if (!paneId) {
  fail("no focused pane was supplied by Herdr");
}

const opened = spawnSync(
  herdr,
  [
    "plugin",
    "pane",
    "open",
    "--plugin",
    pluginId,
    "--entrypoint",
    "picker",
    "--width",
    "80%",
    "--height",
    "75%",
    "--env",
    `SCHLEPR_MODE=${mode}`,
    "--env",
    `SCHLEPR_SOURCE_PANE=${paneId}`,
  ],
  { encoding: "utf8" },
);

if (opened.status !== 0) {
  fail((opened.stderr || opened.stdout || "could not open the Schlepr popup").trim());
}

function parseContext(raw: string | undefined): Record<string, string | undefined> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string | undefined>;
  } catch {
    return {};
  }
}

function fail(message: string): never {
  console.error(`schlepr: ${message}`);
  process.exit(1);
}
