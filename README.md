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

- By default, the config file and the response cache are stored under your home directory (`.config/figma-reader/config.json` and `.cache/figma-reader/`), not under `%APPDATA%` or `%LOCALAPPDATA%`. On Windows they resolve to `C:\Users\<name>\.config\...` and `C:\Users\<name>\.cache\...`. The cache location can be changed with `FIGMA_READER_CACHE_DIR` (see [Caching](#caching)).
- Cache files are created with mode `0600` so that other users of the machine cannot read the design data they hold. Windows ignores POSIX permission bits, so that protection does not apply there.
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

Retrieve design information (node tree, styles, components) from one or more Figma node URLs.

```bash
figma-reader inspect "https://www.figma.com/design/XXXXX/FileName?node-id=1-2"

# Several nodes of the same file in a single API request — quote each URL separately
figma-reader inspect "https://www.figma.com/design/XXXXX/FileName?node-id=1-2" "https://www.figma.com/design/XXXXX/FileName?node-id=10-99"
```

All URLs must belong to the same file. A Figma request can address only one file, so a mixed set exits with an error **before** any API call and reports which URL belongs to which file key:

```json
{ "success": false, "error": "The given URLs span 2 different Figma files; ...", "groups": [{ "fileKey": "ABC123", "urls": ["https://..."] }, { "fileKey": "XYZ789", "urls": ["https://..."] }] }
```

A URL's `node-id` also accepts a comma-separated list (`?node-id=1-2,10-99`), which is equivalent to passing those nodes as separate URLs.

| Option | Description | Default |
|--------|-------------|---------|
| `--pretty` | Output as a human-readable tree view | `false` |
| `--styles` | Style-focused JSON: removes noise fields, keeps fills / strokes / effects / layout / text styles. Cannot be combined with `--pretty` or `--geometry` | `false` |
| `--depth <N>` | Limit node tree depth (positive integer) | No limit |
| `--geometry` | Include vector data (path information) | `false` |
| `--refresh` | Bypass the local cache and fetch from the Figma API | `false` |

#### Caching

Figma's API rate limit recovers over hours, so `inspect` responses are cached on disk and reused across sessions. A call hits the cache only when the file key, node ids, `--depth`, and `--geometry` all match a previous call; anything else costs a request. There is no expiry — pass `--refresh` when you know the design has changed.

Every response carries a `_cache` object reporting whether it came from the cache and how old it is:

```json
{ "_cache": { "hit": true, "cached": true, "enabled": true, "fetchedAt": "2026-09-19T04:00:00.000Z", "ageSeconds": 93600, "note": "Served from local cache ..." } }
```

Note that `lastModified` reflects the file as of `fetchedAt`, not the current state of the Figma file.

Every `inspect` JSON response also carries `_request.nodeIds`, the node ids the request asked for (de-duplicated and sorted, so it does not line up positionally with the URLs you passed). It is specific to `inspect`; `export` reports partial misses through its own output instead. Figma returns an unresolvable id as `null` **or** omits its key entirely, so comparing this list against the `nodes` entries that actually resolved — not merely against its keys — is the only way to detect a partially fulfilled request:

```json
{ "_request": { "nodeIds": ["10:99", "1:2"] } }
```

`enabled` is `false` when the cache is turned off with `FIGMA_READER_CACHE` (see below). When a response could not be written to disk, `note` names the error code, the cache directory, and how to fix it.

Cache files live in the first of these that applies:

1. `$FIGMA_READER_CACHE_DIR/`, when that variable is set
2. `$XDG_CACHE_HOME/figma-reader/`, when that variable holds an absolute path
3. `~/.cache/figma-reader/`

Nothing else depends on them, so that cache directory can be deleted at any time; the next call simply fetches again.

##### Environment variables

| Variable | Description |
|----------|-------------|
| `FIGMA_READER_CACHE_DIR` | Directory to store the cache in. **Absolute paths only**: `~` and variables are not expanded, and a relative path is rejected with an error. Expand the value in your shell (e.g. `.envrc`) before passing it. The files are placed directly under this directory (no `figma-reader/` is appended), so point it at a **dedicated** directory. Empty or whitespace-only means unset. Takes priority over `XDG_CACHE_HOME` |
| `FIGMA_READER_CACHE` | Turns the cache on or off. `1` / `true` / `on` enable it, `0` / `false` / `off` disable it (case-insensitive, surrounding whitespace ignored). Unset or empty means on. Any other value is rejected with an error |

With `FIGMA_READER_CACHE=off`, `inspect` never touches the disk: it does not read, write, or delete cache files, and `FIGMA_READER_CACHE_DIR` is ignored. Every call spends an API request, and `--refresh` has no additional effect. Existing cache files are left as they are, so turning the cache back on may serve responses stored before it was turned off. It is not a substitute for `--refresh`.

Both variables are read only by `inspect`; an invalid value makes `inspect` exit with a machine-readable error, while other commands are unaffected.

##### Running inside a sandbox

Sandboxed agent environments may refuse writes to your home directory. The sandbox in Claude Code, for example, allows writes only to the working directory and a per-session temporary directory by default, so `~/.cache/figma-reader/` cannot be written. The cache then never fills up, every call spends an API request, and `_cache.note` reports the failed write.

To fix this, either:

- Allow writes to the cache directory in the sandbox. In Claude Code, add it to `sandbox.filesystem.allowWrite` in your user settings (`~/.claude/settings.json`); paths there are merged with every project's settings, so this works across projects:

  ```json
  { "sandbox": { "filesystem": { "allowWrite": ["~/.cache/figma-reader"] } } }
  ```

  This is the default location. If you set `XDG_CACHE_HOME` or `FIGMA_READER_CACHE_DIR`, allow the directory named in `_cache.note` instead.

- Or set `FIGMA_READER_CACHE_DIR` to an absolute path that the sandbox already allows writing to.

Adding `figma-reader` to `sandbox.excludedCommands` is not recommended: the exclusion does not apply to commands that contain a redirect or a pipe, which is how agents usually save `inspect` output. See the [Claude Code sandboxing docs](https://code.claude.com/docs/en/sandboxing.md) for details.

### `export` - Export images

Export Figma nodes as images.

```bash
# Get export URL
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2"

# Download as SVG file
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2" --format svg --download

# With scale and output directory
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2" --scale 2 --download --output ./images

# Several nodes of the same file in a single API request — quote each URL separately
figma-reader export "https://www.figma.com/design/XXXXX/FileName?node-id=1-2" "https://www.figma.com/design/XXXXX/FileName?node-id=10-99" --format svg --download
```

Like `inspect`, `export` accepts several URLs and requires them to belong to the same file. The URLs' own node ids are exported alongside anything passed to `--ids`.

**Every requested node id always appears in the output.** A node Figma could not render is reported as `null` in URL mode, and in `--download` mode it lands in `failures` and the command exits 1 — so a request that produced fewer files than nodes can never look like a success.

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
