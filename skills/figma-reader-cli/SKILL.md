---
name: figma-reader-cli
description: Retrieve Figma design structure, style information, and export images via CLI. Use when the user shares a Figma URL, mentions "from Figma" or "from the design", or asks about figma-reader setup.
allowed-tools: Bash(figma-reader:*)
---

# Figma Design Data with figma-reader

## Cost model — read this before your first call

Figma's API rate limit is severe and recovery is measured in **hours**. Treat every call as a scarce shared resource, not a free lookup.

**Two independent budgets.** `inspect` spends `/v1/files`; `export` spends `/v1/images`. Exhausting one does not block the other — an `export` was observed succeeding while `inspect` was already returning 429.

**The budget is small.** Observed in practice: one `inspect --styles` on a frame plus one `inspect --depth 2` on a page was enough to exhaust the files budget. A single `export` was enough to exhaust the images budget.

**`inspect` results are cached on disk and survive across sessions — but only for an exact repeat.** A cache hit costs nothing. A hit requires the file key, the *set* of node ids, `--depth`, and `--geometry` to all match a previous call. Change any one of them and you pay full price:

- `node-id=1-2` then `node-id=1-2,10-99` are **two different requests**. The escalation in hard rule 4 always costs a second call — that is expected, not a failure to plan.
- Adding or removing `--depth` is a different request. `--styles` and `--pretty` are not (they only reshape output you already paid for).
- A response in which any requested id did not resolve (it came back `null`, or was missing entirely) is **never cached**, so that exact combination costs a call every time until the id resolves. `_cache.cached` is `false` in that case.

This changes nothing about hard rules 3 and 5: plan the whole fetch before the first call, and never spend one on speculation. The cache rewards repeating a call you already made; it does nothing for the exploratory call you were about to invent.

**`retryAfter` is in seconds, and the values are enormous.** Observed 27,000 (~7.5 h) on the first 429, rising to 96,000 (~26 h) after retries. **Retrying while limited extends the lock.** A day of work can be lost to a handful of careless calls.

### Hard rules

1. **On 429, do not retry and do not wait.** Stop, report to the user, and ask them to export from the Figma app (browser/desktop) — that path does not touch the API budget. See [Error handling](#error-handling).
2. **One `inspect` and one `export` per screen.** Inspect the common ancestor (`--styles` brings every descendant along), and batch every vector into a single `export --ids "a,b,c"`. **Never call `export` once per node** — cost is per request, not per node, so ten icons cost the same as one.
3. **Plan the whole fetch before the first call.** List every node you need — structure *and* every vector you will have to export — then spend the two calls. Discovering afterwards that one more icon is missing can cost a day.
4. **Read `components` and `componentSets`, not just `document`.** They are siblings of `document` in the same response and they tell you *what else you need to fetch*. An instance whose component is named `state=default` / `size=lg` is one variant of a set — the other states (hover, disabled, empty) live in the component set named by `componentSetId`, which is a **different node your screen fetch did not include**. Screens only ever carry the variant they render. You cannot know this before call 1 — `componentSetId` only exists in call 1's response — so the rule is: **read `componentSets` in the response you just got, and if it names a set you need, re-request with both node ids in one call** (comma-separated `node-id`, see [Fetching several nodes in one call](#fetching-several-nodes-in-one-call)). That keeps you at one `inspect`. A missed variant is not caught by lint, types, or a build: the screen looks right and the hover state is silently wrong, so it typically surfaces long after the budget is gone.
5. **Never spend a call on speculation.** Do not fetch a page to check whether some frame (an OGP image, a desktop variant) exists. Ask the user.
6. **Classify each shape's origin before fetching it.** The node name usually gives it away:
   - `lucide/chevron-right`, `mdi/...` → an icon library. Install the package instead; 0 calls.
   - Third-party brand marks (Google, GitHub, X) → official brand kits, or already vendored in the repo.
   - Product-specific artwork (the product's own logo, wordmark, illustrations) → **the only category that genuinely requires Figma.**

   Check the repository before exporting — the asset is often already committed.
7. **`figma-reader me` costs a call too.** Run it only when diagnosing an auth failure, never as a routine preflight.
8. **On a cache hit, tell the user how old the data is, before you implement from it.** Every `inspect` response carries `_cache`; when `hit` is `true`, read `ageSeconds` and say so in your own words ("this design data was fetched 3 days ago"). There is no expiry, so a hit can be arbitrarily stale and the CLI will not warn you beyond that field. If the age is large enough that the design plausibly changed, **ask the user** whether it has — do not spend a call to find out. Use `--refresh` only when you or the user already know the design changed; it is a full-price request, so using it "just to be sure" is exactly the careless spending hard rule 1 exists to prevent.

## Quick start

```bash
# get design structure from a Figma URL
figma-reader inspect "https://www.figma.com/design/XXXXX/File-Name?node-id=1:2"
# export as PNG
figma-reader export "https://www.figma.com/design/XXXXX/File-Name?node-id=1:2" --format png --scale 2 --download --output ./assets
```

There is deliberately no auth check here. `figma-reader me` spends a call and proves nothing that the `inspect` above would not tell you — run it only when diagnosing a failure (hard rule 7).

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
figma-reader inspect "<figma-url>" --depth 3  # limit tree depth (structure overview only — see caveats below)
figma-reader inspect "<figma-url>" --geometry # raw vector path data (cannot be combined with --styles)
figma-reader inspect "<figma-url>" --pretty   # human-readable (cannot be combined with --styles)
figma-reader inspect "<figma-url>" --refresh  # bypass the cache and spend a call (see hard rule 8)
```

#### Fetching several nodes in one call

`inspect` has no `--ids` flag, but it does not need one: **the URL's `node-id` accepts a comma-separated list, and every id is resolved in a single request.** The rate limit charges per request, so two nodes cost exactly what one costs.

```bash
# One request, two nodes: a screen and the component set its instances point at
figma-reader inspect "https://www.figma.com/design/XXXXX/File?node-id=1-2,10-99" --styles
```

Use the same `-` form the Figma UI puts in the URL (`10-99`); it is converted to `10:99` for the API. The response's `nodes` object comes back keyed by every id you asked for:

```json
{ "nodes": { "1:2":   { "document": { "type": "FRAME", ... } },
             "10:99": { "document": { "type": "COMPONENT_SET", ... } } } }
```

This is the way to satisfy hard rule 4 without spending a second call: when call 1's `componentSets` reveals a set you need, re-request the screen **and** the set together. An id the token cannot resolve comes back as `null` rather than failing the whole request, so check for nulls before reading (see the `jq` recipes below).

**When you need vector shapes, `export --format svg` is almost always the right tool, not `--geometry`.** Export returns a finished SVG (boolean operations resolved, transforms applied, usable as a file). `--geometry` returns raw path coordinates (`fillGeometry` / `strokeGeometry`) that you must interpret yourself — use it only when you need path data as code, e.g. generating `clip-path: polygon(...)` values or Canvas drawing commands.

When you do use `--geometry`, scope it down in two steps: first run `--styles` on the parent to find the target vector node's id, then run `--geometry` against that node's own URL (`?node-id=<id>`). Never fetch a whole frame with `--geometry`. Redirect to a file and extract with `jq` as usual — e.g. `jq '.. | objects | select(.name? == "Logo") | .fillGeometry'`.

**When implementing UI from a design, always use `--styles`.** It removes noise fields (`blendMode`, `constraints`, `scrollBehavior`, `absoluteRenderBounds`, etc.) and keeps everything needed to reproduce styles: `fills`, `strokes`, `strokeWeight`, `cornerRadius`, `effects`, `opacity`, Auto Layout properties, text styles, and `boundVariables`.

**Save the output to a file, then read it selectively with `jq`.** Piping large JSON directly into your context risks silent truncation (tool output limits) — styles of later/deeper nodes get cut off without warning. Save to your session's temporary working directory (scratchpad; use `mktemp -d` if none). Do not use a fixed path like `/tmp/design.json` — fixed names get silently overwritten across sessions and you may read stale data. Include the node id in the filename.

This is about *your* `jq` scratch file, not about re-fetching. Re-running `inspect` on the same node is free (cache hit), so re-run it rather than reaching for a file some earlier session left behind. Staleness of the design data itself is now reported by the CLI in `_cache` — see hard rule 8.

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

**`--ids` is the default way to call this, not an extra.** One request can carry every node you need, and the rate limit charges per request — so exporting ten icons in one call costs exactly what one icon costs, while ten separate calls will lock you out. Collect the node ids first (from the saved `--styles` JSON), then fire once.

```bash
# The normal case: every vector you need, in one request
figma-reader export "<figma-url>" --ids "1:2,3:4,5:6" --format svg --download --output ./icons

figma-reader export "<figma-url>"                                  # single node, URL mode
figma-reader export "<figma-url>" --format png --scale 2 --download --output ./assets
figma-reader export "<figma-url>" --format pdf --download
```

The URL's own `node-id` is exported too, so `--ids` only needs the *additional* nodes.

**Without `--download` the command returns S3 URLs instead of files.** Those URLs are served outside the Figma API, so a URL you already hold can be fetched with `curl` without spending budget. This is not a way around the rate limit — the URL only exists for a node you already exported.

**These URLs expire.** They are presigned links with a limited lifetime (on the order of weeks), so treat them as valid for the current session only. Never record one as a durable reference and re-fetch it in a later session: by the time it 403s you are back to needing a call you may not have. If you want the bytes to survive the session, pass `--download` and keep the file.

### Install

```bash
figma-reader install
figma-reader install --agent codex        # claude (default) | codex | antigravity
figma-reader install --dest <path>        # arbitrary path; not combinable with --agent
figma-reader install --pretty
```

## Output format

All commands output JSON by default (machine-readable). Use `--pretty` only when showing results to the user.

### inspect output

```json
{
  "_cache": {
    "hit": true,
    "cached": true,
    "fetchedAt": "2026-03-01T12:00:00Z",
    "ageSeconds": 93600,
    "note": "Served from local cache fetched 26h ago; ..."
  },
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

**`_cache` is present on every response**, whether the data came from the API or from disk. `hit` says which; `ageSeconds` is how old the data is; `cached` says whether the response is on disk now; `note` restates it all in prose. **When `cached` is `false`, repeating the request costs another call** — the response could not be stored, either because the write failed or because some requested id did not resolve. Report the age to the user on a hit — see hard rule 8.

**`lastModified` is the value as of `fetchedAt`, not the current state of the Figma file.** On a cache hit it is frozen at whatever it was when the data was fetched, so comparing it across runs will never tell you the design changed. It is not a freshness check.

Cache files live in `~/.cache/figma-reader/` (or `$XDG_CACHE_HOME/figma-reader/` when that variable holds an absolute path). Deleting the directory is safe; the next call just fetches again. Do not delete it to "get fresh data" — that throws away every file's cache to refresh one, and `--refresh` does that for a single request.

See [references/inspect-output.md](references/inspect-output.md) for detailed field descriptions and the style checklist.

With `--styles`, the response has the same top-level shape but each node keeps only identity, layout, and style fields. Empty arrays and `undefined` are omitted; `visible` appears only when `false` (a hidden fill/stroke layer — do not implement it).

**`components` and `componentSets` sit beside `document` — read them.** They resolve every `INSTANCE`'s `componentId` and are the only place the response admits that a component has *other variants*:

```json
"components":    { "10:20": { "name": "state=default", "componentSetId": "10:99" } },
"componentSets": { "10:99": { "name": "Button" } }
```

A component named `state=default` (or `size=lg`, `variant=outline`) is one cell of a variant matrix. The screen you fetched renders only that cell; **hover / disabled / empty states live in the component set, a node your fetch did not include.** Re-request the screen and the set together — see hard rule 4 and [Fetching several nodes in one call](#fetching-several-nodes-in-one-call). `jq` it out of the saved file first:

```bash
# Every variant set the screen touches, and which cell of it the screen rendered.
# Anything listed under "sets" is a node you have NOT fetched yet.
# select(. != null) is required: an id the token cannot resolve comes back as
# null, and jq aborts with "Cannot iterate over null" without it.
jq '.nodes[] | select(. != null) | {
  sets: (.componentSets | map_values(.name)),
  variants: (.components | with_entries(select(.value.componentSetId)) | map_values({name, componentSetId}))
}' "$WORKDIR/design-1-2.json"
```

```json
{
  "sets":     { "10:99": "Button" },
  "variants": { "10:20": { "name": "state=default", "componentSetId": "10:99" } }
}
```

Do not use `--depth` to shrink output for implementation work: it drops child nodes entirely, and colors/borders live on leaf nodes. Use `--styles` + file redirect + `jq` instead. `--depth` is only for a quick structure overview.

**Do not run `--depth` against a page/canvas node.** Walking a whole page is the most expensive `/v1/files` request available, and the motive is usually speculative ("does a desktop variant exist?"). It is a common way to lose the files budget before the real fetch has started. If you need to know whether some frame exists, ask the user — they have the file open.

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

Rate-limited responses (429/503) **may** include a `retryAfter` field:

```json
{ "success": false, "error": "...", "retryAfter": 93026 }
```

**`retryAfter` is in seconds**, and observed values run from 27,000 (~7.5 h) to 96,000 (~26 h). This is not a transient you can sleep through. See [Cost model](#cost-model--read-this-before-your-first-call).

**A failed `--refresh` may report that usable cached data exists**, via an optional `hint` field:

```json
{ "success": false, "error": "...", "hint": "A cached response for this request is available. Re-run without --refresh to use it." }
```

When `hint` is present, re-run the same command **without** `--refresh` instead of stopping. You get the previously cached data and spend nothing. The data is stale by definition — say so to the user — but it is far better than losing a day to the lock. The field is absent when there is no cache to fall back to.

**The field is optional — do not assume it is there.** It is emitted only when Figma sends a purely numeric `Retry-After` header; when the header is absent or uses the HTTP-date form, the field is omitted entirely. If it is missing, say so plainly ("rate limited, duration unknown"). The 27,000–96,000 range above is an observation, not a contract — **never quote it to the user as the remaining lock time** when no `retryAfter` came back.

Common errors and actions:
- **429 / 503 (rate limited)**: Do **not** retry and do **not** wait — retrying while limited extends the lock (observed 27,000 s → 96,000 s). Stop immediately, report the lock (quoting `retryAfter` only if it is present — see above), and ask the user to supply what is missing from the Figma app (browser/desktop): **Copy/Paste as → Copy as SVG**, or the Export panel. The app does not consume the API budget. Do not substitute hand-written or recalled paths for artwork you failed to fetch — a wrong glyph passes lint, typecheck, and build silently
- **`A network error occurred`**: The request never reached Figma, so **no budget was spent** — this is not a rate limit and not an auth failure, despite arriving in the same shape. The usual cause is a sandbox or proxy that does not allow the API host: the CLI talks to `api.figma.com`, which is a different host from the `www.figma.com` URLs you were given, so an allowlist built from the design URL will not cover it. Report it as an environment problem and ask the user to allow `api.figma.com`; do not retry in a loop, and do not treat it as a reason to fall back to recalled data
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

Two API calls. A third is a deliberate decision, not a reflex — see the note on the reference shot below.

```bash
# 0. Prepare a working directory (use your scratchpad if available). No API call.
WORKDIR=$(mktemp -d)

# 1. CALL 1 — structure and styles for the whole screen, saved to a file
figma-reader inspect "https://www.figma.com/design/XXXXX/File?node-id=1:2" --styles > "$WORKDIR/design-1-2.json"

# 2. Decide everything you need from the saved JSON before spending call 2:
#    every vector node id you will have to export. No API call.
jq '[.. | objects | select(.type? == "VECTOR" or .type? == "INSTANCE") | {id, name, type}]' "$WORKDIR/design-1-2.json"

# 3. CALL 2 — every vector you need, in one request
figma-reader export "https://www.figma.com/design/XXXXX/File?node-id=1:2" \
  --ids "10:2,10:3,10:4" --format svg --download --output "$WORKDIR"
```

Skip `figma-reader me` — it spends a call and proves nothing that call 1 would not have told you.

**`--format` applies to the whole request, so a PNG reference shot of the frame cannot ride along with SVG assets.** It is genuinely a third call:

```bash
# OPTIONAL CALL 3 — a rendered PNG of the frame, only if you decided you need one
figma-reader export "https://www.figma.com/design/XXXXX/File?node-id=1:2" \
  --format png --scale 2 --download --output "$WORKDIR"
```

Spend it only when you actually intend to look at the result. Every style value is already in the JSON from call 1, so the reference shot buys you a visual sanity check and nothing else — worth a call on an unfamiliar or visually dense layout, not worth one on a simple form. Note that call 2 above also renders the frame itself (the URL's own `node-id` is always included), so you may already have the whole screen as SVG.

Then extract style values per node with `jq`, and read the exported image if you took one. If the user needs implementation, suggest `/feature-dev`.

### Verify after implementing

Subtle styles (1px borders, slight color differences) are easy to miss in a screenshot alone.

1. **JSON cross-check — always do this.** For each node, compare your implementation against the style checklist in [references/inspect-output.md](references/inspect-output.md) — `fills`, `strokes`, `strokeWeight`, `cornerRadius`, `effects`, `opacity`. Values live in the saved JSON, not your memory of it. This check needs no API call and catches the differences a screenshot cannot.
2. **Visual diff — only if you already have a rendered reference.** Screenshot your implementation and compare it side by side with the exported frame. **Do not spend a call just to obtain the reference for this step**; if you did not take one, the JSON cross-check above stands on its own.

## Example: Export multiple assets

However many assets there are, this is **one** request. A loop over nodes is always wrong here.

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
