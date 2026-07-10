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
figma-reader inspect "<figma-url>"
figma-reader inspect "<figma-url>" --depth 3
figma-reader inspect "<figma-url>" --geometry
figma-reader inspect "<figma-url>" --pretty
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

See [references/inspect-output.md](references/inspect-output.md) for detailed field descriptions.

Do not specify `--depth` by default. Only use `--depth 3`–`5` if the output is too large.

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
- **Output too large**: Re-run with a lower `--depth` value

## Choosing an export format

- Icons / logos → SVG
- Photos / screenshots → PNG (scale 2 for Retina)
- Print → PDF

## Example: Get design info and hand off to implementation

```bash
# 1. Check auth
figma-reader me
# 2. Get design structure
figma-reader inspect "https://www.figma.com/design/XXXXX/File?node-id=1:2"
# 3. Export reference image
figma-reader export "https://www.figma.com/design/XXXXX/File?node-id=1:2" --format png --scale 2 --download --output /tmp
```

After retrieving design info, read the JSON output and the exported image. If the user needs implementation, suggest `/feature-dev`.

## Example: Export multiple assets

```bash
# Export specific nodes as SVG
figma-reader export "https://www.figma.com/design/XXXXX/Icons?node-id=10:1" --ids "10:2,10:3,10:4" --format svg --download --output ./src/assets/icons
```

## Example: Screenshot a Figma design

```bash
figma-reader export "<figma-url>" --format png --scale 2 --download --output /tmp
```

Read the downloaded image with the Read tool to visually inspect the design.

## Local installation

If the global `figma-reader` command is not found, use `npx`:

```bash
npx figma-reader inspect "<figma-url>"
npx figma-reader export "<figma-url>" --format png --download
```
