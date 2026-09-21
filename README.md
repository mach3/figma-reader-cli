# figma-reader

A CLI tool for retrieving and processing Figma design data from the command line.
Primarily designed for AI agents to execute as a subprocess and obtain accurate, essential design information.

[日本語版 README](./README-ja.md)

## Features

- **Design Retrieval**: Fetch node trees, styles, and component information from Figma URLs
- **Image Export**: Export in PNG / SVG / PDF formats with file download support
- **AI Agent Friendly**: JSON output by default, designed for subprocess execution
- **Human Friendly**: Switch to human-readable text output with the `--pretty` flag

## Installation

Requires **Node.js 22.12 or later**. Node 18 and 20 have reached end-of-life and are no longer supported.

The supported platforms are **macOS and Linux**. Windows is best-effort: the CLI is expected to run, but it is not an officially supported target, and the following known differences will not be addressed.

- The config file is stored under your home directory at `.config/figma-reader/config.json` (on Windows, `C:\Users\<name>\.config\figma-reader\config.json`), not under `%APPDATA%`.
- Paths beginning with `~` (such as `--dest ~/.codex/skills/figma-reader-cli`) are not expanded by `cmd.exe` or PowerShell. Pass an absolute path instead.

```bash
npm install -g figma-reader
```

## Setup

A [Personal Access Token](https://www.figma.com/developers/api#access-tokens) is required to use the Figma API.

### Option 1: `auth login` command (Recommended)

Interactively enter your token and save it to a config file (`~/.config/figma-reader/config.json`).
The path is resolved from your home directory, so on Windows it is `C:\Users\<name>\.config\figma-reader\config.json`. The `~` above is shorthand: `cmd.exe` and PowerShell do not expand it if you type the path yourself.
Multiple tokens can be saved under different profile names and switched at any time.

```bash
figma-reader auth login                # profile name is derived from your Figma account email (local part)
figma-reader auth login --name work    # save as profile "work"
figma-reader login                     # alias of `auth login`
```

| Option | Description |
|--------|-------------|
| `--name <name>` | Profile name to save the token under. When omitted, the local part of the account email fetched from the Figma API is used (the token is validated as a side effect) |
| `--pretty` | Output in human-readable text format |

#### Managing multiple tokens

```bash
figma-reader auth list             # list saved profiles (tokens are masked)
figma-reader auth switch work      # switch the active profile
figma-reader auth status           # verify the active token via the Figma API
```

The first saved token automatically becomes active. All commands (`me`, `inspect`, `export`) use the active token.

To use a specific profile for a single run without switching, pass `--profile <name>` to `me`, `inspect`, `export`, or `auth status`. Precedence: `--profile` > `FIGMA_TOKEN` > active profile.

### Option 2: Environment variable

Set the `FIGMA_TOKEN` environment variable. Environment variables take priority over the config file.

```bash
export FIGMA_TOKEN="figd_xxxxxxxxxxxx"
```

## Usage

### `me` - Get user info

Display the authenticated user's information.

```bash
figma-reader me
figma-reader me --pretty
```

### `inspect` - Get design context

Retrieve design information (node tree, styles, components) from a Figma node URL.

```bash
figma-reader inspect "https://www.figma.com/design/XXXXX/FileName?node-id=1-2"
```

| Option | Description | Default |
|--------|-------------|---------|
| `--pretty` | Output as a human-readable tree view | `false` |
| `--styles` | Style-focused JSON: removes noise fields, keeps fills / strokes / effects / layout / text styles. Cannot be combined with `--pretty` or `--geometry` | `false` |
| `--depth <N>` | Limit node tree depth (positive integer) | No limit |
| `--geometry` | Include vector data (path information) | `false` |

### `export` - Export images

Export Figma nodes as images.

```bash
# Get export URL
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2"

# Download as SVG file
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2" --format svg --download

# With scale and output directory
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2" --scale 2 --download --output ./images
```

| Option | Description | Default |
|--------|-------------|---------|
| `--format <fmt>` | Output format (`png`, `svg`, `pdf`) | `png` |
| `--scale <N>` | Scale (0.01-4, png/pdf only) | `1` |
| `--ids <ids>` | Additional node IDs (comma-separated) | - |
| `--download` | Download as files | `false` |
| `--output <dir>` | Download directory | `.` |
| `--pretty` | Output in human-readable text format | `false` |

### `install` - Install skill files for AI agents

Install skill files to the current directory. These files help AI agents understand how to use figma-reader commands.

```bash
# Claude Code (default)
figma-reader install

# Other agents
figma-reader install --agent codex
figma-reader install --agent antigravity

# Arbitrary path (for unsupported agents)
figma-reader install --dest .windsurf/skills/figma-reader-cli
```

The bundled skill is in the SKILL.md-based Agent Skills format and is copied as-is, without any conversion.

| `--agent` | Install destination |
|-----------|---------------------|
| `claude` (default) | `.claude/skills/figma-reader-cli/` |
| `codex` | `.agents/skills/figma-reader-cli/` |
| `antigravity` | `.agents/skills/figma-reader-cli/` |

`codex` and `antigravity` resolve to the same directory: both look up repository-scoped skills under `.agents/`. To install for Codex CLI at the user scope instead, use `--dest ~/.codex/skills/figma-reader-cli`. On Windows, `cmd.exe` and PowerShell do not expand `~`, so pass an absolute path instead.

| Option | Description | Default |
|--------|-------------|---------|
| `--agent <name>` | Target agent (`claude`, `codex`, `antigravity`) | `claude` |
| `--dest <path>` | Install to an arbitrary path (cannot be used with `--agent`) | - |
| `--pretty` | Output in human-readable text format | `false` |

## AI Agent Integration

This tool is designed for use by AI agents.

- **JSON by default**: All commands output machine-readable JSON to stdout
- **Error output**: Errors are output in JSON format to stderr
- **Exit codes**: Returns `0` on success, `1` on failure
- **Token setup**: Authentication via `FIGMA_TOKEN` environment variable is recommended
- **Skill install**: Run `figma-reader install` to install skill files (use `--agent` to target Codex CLI or Antigravity)

## License

[MIT](./LICENSE)
