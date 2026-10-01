# Schlepr

A keyboard-first Herdr plugin for moving live panes and complete tabs between workspaces. Schlepr runs as a native Herdr popup, keeps shells and agents alive, and has no `fzf` dependency.

## Why Schlepr?

Herdr can move a live pane through `pane.move`, but does not currently expose cross-workspace movement in its built-in TUI. Moving a whole tab is harder because Herdr has no atomic cross-workspace `tab.move` operation. Schlepr provides both workflows without respawning terminal processes.

- Move a pane to any existing tab
- Choose the exact destination pane, split direction, and split ratio
- Create a new tab in any workspace
- Create and move into a new workspace
- Move a complete tab while preserving its BSP split tree and ratios
- Preserve terminal identity, running processes, and agents
- Validate live state before moving and verify the result afterward
- Record interrupted multi-pane moves for diagnosis
- Searchable, dependency-free popup UI

Schlepr requires **Herdr 0.9+**, **Node.js 20+**, and **pnpm 12+** on macOS or Linux.

## Install

From Herdr's plugin registry:

```bash
herdr plugin install saiyajosh/herdr-schlepr
```

From npm:

```bash
pnpm add --global herdr-schlepr
herdr plugin link "$(pnpm root --global)/herdr-schlepr"
```

### Install from source

```bash
git clone https://github.com/saiyajosh/herdr-schlepr
cd herdr-schlepr
corepack pnpm install --frozen-lockfile
pnpm run build
herdr plugin link "$PWD"
```

During local development, rebuild after source changes:

```bash
pnpm run build
herdr server reload-config
```

## Keybindings

Plugin actions do not claim keys automatically. Add whichever bindings you prefer to `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+m"
type = "plugin_action"
command = "schlepr.move"
description = "move pane or tab"

[[keys.command]]
key = "prefix+shift+m"
type = "plugin_action"
command = "schlepr.move-tab"
description = "move complete tab"
```

Then reload Herdr:

```bash
herdr server reload-config
```

## Popup controls

| Key | Action |
| --- | --- |
| `↑` / `↓` | Select a destination |
| Type | Filter destinations; the query names new tabs/workspaces |
| `Backspace` / `Ctrl-U` | Edit or clear the query |
| `Tab` | Switch between moving one pane and the complete tab |
| `Enter` | Move |
| `Ctrl-D` | Toggle right/down split |
| `Ctrl-R` | Cycle 33%/50%/67% split ratios |
| `Ctrl-P` | Cycle the exact target pane in the destination tab |
| `Ctrl-L` | Refresh live Herdr state |
| `Esc` / `Ctrl-C` | Cancel |

## Safety model

A single-pane move is one Herdr operation. A whole-tab move exports Herdr's exact layout tree and then relocates each live pane into a new tab in tree order. It never uses `layout.apply`, because that would respawn processes.

Whole-tab moves are necessarily non-atomic with Herdr 0.9. Schlepr therefore:

1. Revalidates the source immediately before moving.
2. Tracks terminals by stable `terminal_id`, not workspace-qualified pane IDs.
3. Writes `last-move.json` under `HERDR_PLUGIN_STATE_DIR` before mutation.
4. Verifies that every terminal reached the resulting tab.
5. Deletes the journal after success and retains it after interruption.

The journal is diagnostic; automatic rollback is intentionally not promised because source tabs and workspaces can close during a move.

## Development

```bash
pnpm test
pnpm run build
pnpm run check
pnpm run pack:check
pnpm run test:integration # opt-in; requires a running Herdr session
herdr plugin link "$PWD"
herdr plugin action list --plugin schlepr
herdr plugin log list --plugin schlepr
```

Maintainers can publish a verified package with `pnpm publish`. The publish lifecycle reruns the complete check suite, validates the package with Publint, rebuilds `dist/`, and requests npm provenance. Publishing a GitHub release tagged `v<package version>` runs the same flow through npm trusted publishing. Before using that workflow, configure npm's trusted publisher for `saiyajosh/herdr-schlepr` and `.github/workflows/publish.yml`.

## License

MIT
