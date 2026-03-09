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

```bash
npm install -g figma-reader
```

## Setup

A [Personal Access Token](https://www.figma.com/developers/api#access-tokens) is required to use the Figma API.

### Option 1: `login` command (Recommended)

Interactively enter your token and save it to a config file (`~/.config/figma-reader/config.json`).

```bash
figma-reader login
figma-reader login --pretty
```

| Option | Description |
|--------|-------------|
| `--pretty` | Output in human-readable text format |

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

Install skill files (e.g., for Claude Code) to the current directory.

```bash
figma-reader install
figma-reader install --pretty
```

Skill files are installed to `.claude/skills/figma-reader-cli/`. These files help AI agents understand how to use figma-reader commands.

| Option | Description | Default |
|--------|-------------|---------|
| `--pretty` | Output in human-readable text format | `false` |

## AI Agent Integration

This tool is designed for use by AI agents.

- **JSON by default**: All commands output machine-readable JSON to stdout
- **Error output**: Errors are output in JSON format to stderr
- **Exit codes**: Returns `0` on success, `1` on failure
- **Token setup**: Authentication via `FIGMA_TOKEN` environment variable is recommended
- **Skill install**: Run `figma-reader install` to install skill files for Claude Code

## License

[MIT](./LICENSE)
