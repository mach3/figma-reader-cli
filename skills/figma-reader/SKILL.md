---
name: figma-reader
description: >
  Retrieve Figma design structure/style information and export images.
  Uses the figma-reader CLI to fetch design data via the Figma REST API.
  Use in the following situations:
  (1) When retrieving design structure or style information from a Figma URL,
  (2) When exporting images (PNG/SVG/PDF) from Figma designs,
  (3) When the user asks about figma-reader setup or login.
  Trigger when the user shares a Figma URL or mentions "from Figma" or "from the design".
  Component implementation and codebase analysis are out of scope. Delegate implementation to /feature-dev.
allowed-tools: Bash(figma-reader:*)
---

# figma-reader

Retrieve Figma design information and export images using the `figma-reader` CLI.

**Component implementation is out of scope for this skill.** After retrieving design information, suggest `/feature-dev` to the user if implementation is needed.

## Running the CLI

Check if globally installed, otherwise use `npx`:

```bash
# Try global command first
figma-reader me
# If not found
npx figma-reader me
```

Use whichever method works for subsequent commands.

## Authentication

Flow for first-time setup or authentication errors:

1. Run `figma-reader me` to check authentication status
2. If it fails, ask the user to run `figma-reader login` (requires interactive input)
3. Token is a [Figma Personal Access Token](https://www.figma.com/developers/api#access-tokens) obtained from Figma settings
4. After login, verify with `me` again

`login` is an interactive command — Claude should not run it directly. Ask the user to do it.

## Workflow 1: Retrieving Design Information

Retrieve design structure and style information from a Figma URL.

```bash
figma-reader inspect "<figma-url>"
```

| Option | Description | Default |
|--------|-------------|---------|
| `--pretty` | Output in human-readable tree view format | `false` |
| `--depth <N>` | Limit node tree depth (positive integer) | No limit |
| `--geometry` | Include vector data (path information) | `false` |

### Reading the inspect output

Key fields in the JSON output:
- `nodes`: Node tree (layer structure, type, size, position)
- `styles`: Colors, text styles, effects
- `components`: Component names and properties

Do not specify `--depth` by default. Only use `--depth 3`–`5` if the output is too large.

See [references/inspect-output.md](references/inspect-output.md) for detailed field descriptions.

## Workflow 2: Image Export

```bash
figma-reader export "<figma-url>" --format svg --download --output <destination>
figma-reader export "<figma-url>" --format png --scale 2 --download --output <destination>
figma-reader export "<figma-url>" --ids "1-2,3-4" --format svg --download
```

Match the destination to the project's directory structure.

| Option | Description | Default |
|--------|-------------|---------|
| `--format` | `png`, `svg`, `pdf` | `png` |
| `--scale` | Scale 0.01-4 (png/pdf only) | `1` |
| `--ids` | Additional node IDs (comma-separated) | - |
| `--download` | Download as files | `false` |
| `--output` | Download directory | `.` |

### Choosing a format

- Icons / logos → SVG
- Photos / screenshots → PNG (scale 2 for Retina)
- Print → PDF

### Taking screenshots

When asked to capture or screenshot a Figma design, use the `export` command to download a PNG:

```bash
figma-reader export "<figma-url>" --format png --scale 2 --download --output /tmp
```

Read the downloaded image with the Read tool to visually inspect the design.

## Error Handling

- **Authentication error**: Ask the user to run `figma-reader login`
- **Node not found**: Verify the node-id in the URL; ensure the correct page/frame is specified
- **Output too large**: Re-run with a lower `--depth` value
