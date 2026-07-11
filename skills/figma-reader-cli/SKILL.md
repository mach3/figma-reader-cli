---
name: figma-reader-cli
description: Retrieve Figma design structure, style information, and export images via CLI. Use when the user shares a Figma URL, mentions "from Figma" or "from the design", or asks about figma-reader setup.
allowed-tools: Bash(figma-reader:*)
---

# Figma Design Data with figma-reader

## Quick start

```bash
# check authentication
figma-reader me
# get design structure from a Figma URL
figma-reader inspect "https://www.figma.com/design/XXXXX/File-Name?node-id=1:2"
# export as PNG
figma-reader export "https://www.figma.com/design/XXXXX/File-Name?node-id=1:2" --format png --scale 2 --download --output ./assets
```

## Commands

### Authentication

Multiple tokens can be saved as named profiles and switched at any time.

```bash
figma-reader auth login                # save a token (profile name derived from account email local part)
figma-reader auth login --name work    # save under an explicit profile name
figma-reader auth list                 # list saved profiles (tokens are masked)
figma-reader auth switch work          # switch the active profile
figma-reader auth status               # verify the active token via the Figma API
figma-reader me
figma-reader me --pretty
```

`login` (top-level) is an alias of `auth login`.
`auth login` is interactive — do not run it directly. Ask the user to run it.
Token is a [Figma Personal Access Token](https://www.figma.com/developers/api#access-tokens) from Figma settings.
All other commands (`me`, `inspect`, `export`) use the active profile's token. The `FIGMA_TOKEN` environment variable, when set, overrides any saved profile.

`me`, `inspect`, `export`, and `auth status` accept `--profile <name>` to use a specific saved profile for that single run without changing the active profile or the config file. Precedence: `--profile` > `FIGMA_TOKEN` > active profile.

```bash
figma-reader inspect "<figma-url>" --profile personal
```

### Inspect

```bash
figma-reader inspect "<figma-url>" --styles   # style-focused output (recommended for implementation)
figma-reader inspect "<figma-url>"            # raw Figma API response
figma-reader inspect "<figma-url>" --depth 3  # limit tree depth (structure overview only — see caveat below)
figma-reader inspect "<figma-url>" --geometry # raw vector path data (cannot be combined with --styles)
figma-reader inspect "<figma-url>" --pretty   # human-readable (cannot be combined with --styles)
```

**When you need vector shapes, `export --format svg` is almost always the right tool, not `--geometry`.** Export returns a finished SVG (boolean operations resolved, transforms applied, usable as a file). `--geometry` returns raw path coordinates (`fillGeometry` / `strokeGeometry`) that you must interpret yourself — use it only when you need path data as code, e.g. generating `clip-path: polygon(...)` values or Canvas drawing commands.

When you do use `--geometry`, scope it down in two steps: first run `--styles` on the parent to find the target vector node's id, then run `--geometry` against that node's own URL (`?node-id=<id>`). Never fetch a whole frame with `--geometry`. Redirect to a file and extract with `jq` as usual — e.g. `jq '.. | objects | select(.name? == "Logo") | .fillGeometry'`.

**When implementing UI from a design, always use `--styles`.** It removes noise fields (`blendMode`, `constraints`, `scrollBehavior`, `absoluteRenderBounds`, etc.) and keeps everything needed to reproduce styles: `fills`, `strokes`, `strokeWeight`, `cornerRadius`, `effects`, `opacity`, Auto Layout properties, text styles, and `boundVariables`.

**Save the output to a file, then read it selectively with `jq`.** Piping large JSON directly into your context risks silent truncation (tool output limits) — styles of later/deeper nodes get cut off without warning. Save to your session's temporary working directory (scratchpad; use `mktemp -d` if none). Do not use a fixed path like `/tmp/design.json` — fixed names get silently overwritten across sessions and you may read stale data. Include the node id in the filename.

```bash
# 0. Working directory: prefer your session's scratchpad; fall back to mktemp
WORKDIR=$(mktemp -d)

# 1. Save (filename includes the node id)
figma-reader inspect "https://www.figma.com/design/XXXXX/File?node-id=1:2" --styles > "$WORKDIR/design-1-2.json"

# 2. Structure overview (name/type tree) — select on id+name+type so paint/effect
#    objects (which also have a "type" key but no id/name) don't pollute the list
jq '[.. | objects | select(.id? and .name? and .type?) | {id, name, type}]' "$WORKDIR/design-1-2.json"

# 3. Style values for every node — check these against your implementation
jq '[.. | objects | select(.id? and .name? and .type?) | {name, type, fills, strokes, strokeWeight, cornerRadius, effects, opacity} | with_entries(select(.value != null))]' "$WORKDIR/design-1-2.json"

# 4. Single node by name
jq '.. | objects | select(.name? == "CardHeader")' "$WORKDIR/design-1-2.json"
```

### Export

```bash
figma-reader export "<figma-url>"
figma-reader export "<figma-url>" --format svg --download --output ./icons
figma-reader export "<figma-url>" --format png --scale 2 --download --output ./assets
figma-reader export "<figma-url>" --format pdf --download
figma-reader export "<figma-url>" --ids "1:2,3:4" --format svg --download
```

### Install

```bash
figma-reader install
figma-reader install --pretty
```

## Output format

All commands output JSON by default (machine-readable). Use `--pretty` only when showing results to the user.

### inspect output

```json
{
  "name": "My Design File",
  "lastModified": "2026-03-01T12:00:00Z",
  "editorType": "figma",
  "nodes": {
    "1:2": {
      "document": {
        "id": "1:2",
        "name": "Card",
        "type": "FRAME",
        "absoluteBoundingBox": { "x": 0, "y": 0, "width": 320, "height": 200 },
        "children": [
          {
            "id": "1:3",
            "name": "Title",
            "type": "TEXT",
            "characters": "Hello World",
            "style": { "fontFamily": "Inter", "fontSize": 16, "fontWeight": 600 }
          }
        ]
      },
      "components": {},
      "styles": {}
    }
  }
}
```

See [references/inspect-output.md](references/inspect-output.md) for detailed field descriptions and the style checklist.

With `--styles`, the response has the same top-level shape but each node keeps only identity, layout, and style fields. Empty arrays and `undefined` are omitted; `visible` appears only when `false` (a hidden fill/stroke layer — do not implement it).

Do not use `--depth` to shrink output for implementation work: it drops child nodes entirely, and colors/borders live on leaf nodes. Use `--styles` + file redirect + `jq` instead. `--depth` is only for a quick structure overview.

### export output (URL mode)

```json
{ "images": { "1:2": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/..." } }
```

### export output (download mode)

```json
{
  "successes": [{ "nodeId": "1:2", "filePath": "./assets/1-2.png" }],
  "failures": []
}
```

### me output

```json
{ "id": "12345", "email": "user@example.com", "handle": "username", "img_url": "https://..." }
```

### auth list output

```json
[{ "name": "work", "masked": "figd_abc...", "active": true }]
```

### auth switch output

```json
{ "success": true, "active": "work" }
```

### auth status output

```json
{ "success": true, "profile": "work", "user": { "id": "12345", "email": "user@example.com", "handle": "username", "img_url": "https://..." } }
```

`profile` is `"env"` when the token comes from the `FIGMA_TOKEN` environment variable.

## Error handling

Errors are written to **stderr** as JSON with exit code 1:

```json
{ "success": false, "error": "Error message here" }
```

Rate-limited responses (429/503) include a `retryAfter` field:

```json
{ "success": false, "error": "...", "retryAfter": 30 }
```

Common errors and actions:
- **Authentication error**: Ask the user to run `figma-reader auth login`
- **403 (invalid token)**: The token itself is invalid or expired. Another saved profile may work. Fallback procedure:
  1. `figma-reader auth list` to see saved profiles
  2. Retry the failed command with `--profile <name>` using a different profile
  3. If all profiles fail, ask the user to run `figma-reader auth login`
- **404 (not found / no access)**: The Figma API returns 404 — not 403 — for files the token has no access to, to avoid leaking their existence. Procedure:
  1. Verify the node-id in the URL; ensure the correct page/frame is specified
  2. If the URL is correct, the active profile likely lacks access: run `figma-reader auth list` and retry with `--profile <name>` using a different profile
  3. If all profiles fail, ask the user to check file permissions or run `figma-reader auth login`
- **Profile not found** (from `auth switch` or `--profile`): The error message lists saved profile names; run `figma-reader auth list` to check
- **Output too large**: Use `--styles` and redirect to a file, then extract with `jq` (see Inspect section). Do NOT lower `--depth` — it silently discards leaf-node styles

## Choosing an export format

- Icons / logos → SVG
- Photos / screenshots → PNG (scale 2 for Retina)
- Print → PDF

## Example: Get design info and hand off to implementation

```bash
# 0. Prepare a working directory (use your scratchpad if available)
WORKDIR=$(mktemp -d)
# 1. Check auth
figma-reader me
# 2. Get style-focused design data, saved to a file
figma-reader inspect "https://www.figma.com/design/XXXXX/File?node-id=1:2" --styles > "$WORKDIR/design-1-2.json"
# 3. Export reference image
figma-reader export "https://www.figma.com/design/XXXXX/File?node-id=1:2" --format png --scale 2 --download --output "$WORKDIR"
```

Then read the exported image and extract style values per node with `jq`. If the user needs implementation, suggest `/feature-dev`.

### Verify after implementing

Subtle styles (1px borders, slight color differences) are easy to miss in a screenshot alone. Always do both checks:

1. **JSON cross-check**: for each node, compare your implementation against the style checklist in [references/inspect-output.md](references/inspect-output.md) — `fills`, `strokes`, `strokeWeight`, `cornerRadius`, `effects`, `opacity`. Values live in the saved JSON, not your memory of it.
2. **Visual diff**: screenshot your implementation and compare it side by side with the exported Figma PNG.

## Example: Export multiple assets

```bash
# Export specific nodes as SVG
figma-reader export "https://www.figma.com/design/XXXXX/Icons?node-id=10:1" --ids "10:2,10:3,10:4" --format svg --download --output ./src/assets/icons
```

## Example: Screenshot a Figma design

```bash
figma-reader export "<figma-url>" --format png --scale 2 --download --output "$(mktemp -d)"
```

Prefer your session's scratchpad directory over `mktemp -d` when one is available.

Read the downloaded image with the Read tool to visually inspect the design.

## Local installation

If the global `figma-reader` command is not found, use `npx`:

```bash
npx figma-reader inspect "<figma-url>"
npx figma-reader export "<figma-url>" --format png --download
```
