# inspect Output Reference

## Overview

Field descriptions for the `figma-reader inspect` JSON output. Use this as a reference when communicating design information to the user or handing off to implementation workflows (`/feature-dev`, etc.).

With `--styles`, each node keeps only the fields listed below (noise fields like `blendMode`, `constraints`, `scrollBehavior`, `absoluteRenderBounds`, `exportSettings` are removed). Empty arrays and undefined fields are omitted.

## Node Tree (`nodes`)

Each node contains the following information:

- **type**: Node type (FRAME, TEXT, RECTANGLE, COMPONENT, INSTANCE, etc.)
- **name**: Layer name in Figma
- **absoluteBoundingBox**: `x`, `y`, `width`, `height` (pixels)
- **visible**: Present only when `false`. **A node with `visible: false` exists in the layer tree but is NOT rendered — do not implement it.** The same applies to individual fills/strokes with `visible: false` (see below)
- **opacity**: Layer opacity (0–1). Omitted when 1

### Layout Properties

Frames with Auto Layout include:

- `layoutMode`: `HORIZONTAL` / `VERTICAL` → corresponds to flexbox direction
- `itemSpacing` → corresponds to gap (main axis / column-gap)
- `counterAxisSpacing`: Cross-axis gap between wrapped tracks → row-gap. Only present with `layoutWrap: WRAP` — **the row gap is NOT `itemSpacing`**
- `counterAxisAlignContent`: `AUTO` / `SPACE_BETWEEN` → align-content for wrapped layouts
- `paddingTop` / `paddingRight` / `paddingBottom` / `paddingLeft` → corresponds to padding
- `primaryAxisAlignItems` / `counterAxisAlignItems` → corresponds to justify-content / align-items
- `layoutSizingHorizontal` / `layoutSizingVertical`: `FIXED` / `HUG` / `FILL` → fixed size / fit-content / flex-grow
- `layoutWrap`: `WRAP` → flex-wrap
- `layoutPositioning`: `ABSOLUTE` → the child ignores the parent's Auto Layout flow and is absolutely positioned (e.g. a badge overlaying a button). **Implement as `position: absolute`, not as a flex item.** Omitted when `AUTO` (normal flow)

Nodes with `layoutMode` set to `NONE` have no Auto Layout. They likely use absolute positioning.

## Style Fields

### Fills (background / text color)

- `fills` array: Each fill has `type` (`SOLID`, `GRADIENT_LINEAR`, `IMAGE`, etc.) and, for `SOLID`, `color` (RGBA, each channel 0–1)
- A fill with `visible: false` is disabled in Figma — **skip it**, do not implement it
- `opacity` on a fill multiplies with the color's alpha

### Strokes (borders)

- `strokes` array: Border paints (same shape as fills). **An empty/absent `strokes` means no border**
- `strokeWeight`: Border width (px). Applies to all sides unless `individualStrokeWeights` is present
- `individualStrokeWeights`: `{ top, right, bottom, left }` — per-side border widths (a side with 0 has no border)
- `strokeAlign`: `INSIDE` / `OUTSIDE` / `CENTER` — affects how the border relates to the box size (CSS `border` is inside for `box-sizing: border-box`; `OUTSIDE` may need `outline` or `box-shadow`)
- `strokeDashes`: Dash pattern array (e.g. `[4, 2]`) → dashed/dotted border

### Corner Radius / Shape

- `cornerRadius`: Radius applied to all corners (px)
- `rectangleCornerRadii`: `[topLeft, topRight, bottomRight, bottomLeft]` — per-corner radii. Takes precedence over `cornerRadius` when present
- `rotation`: Rotation in radians. When present, `absoluteBoundingBox` is the axis-aligned box of the **rotated** shape — do not use it as the element's width/height; apply a CSS transform instead
- `isMask`: `true` → this node is a clip mask, not visible content. Its shape clips sibling nodes; implement as `clip-path` / `overflow: hidden` / `mask`, never as a filled layer

### Effects

- `effects` array: `DROP_SHADOW` / `INNER_SHADOW` / `LAYER_BLUR` / `BACKGROUND_BLUR`. Each has `color`, `offset`, `radius`, `spread` → box-shadow / filter: blur / backdrop-filter
- An effect with `visible: false` is disabled — skip it

### Text

- `characters`: The text content
- `style`: Typography object
  - `fontFamily`: Font name
  - `fontSize`: Size (px)
  - `fontWeight`: Weight (numeric)
  - `lineHeightPx` / `lineHeightPercent`: Line height
  - `letterSpacing`: Letter spacing
  - `textAlignHorizontal` / `textAlignVertical`: Text alignment
  - `textCase`: `UPPER` / `LOWER` / `TITLE` → text-transform
  - `textDecoration`: `UNDERLINE` / `STRIKETHROUGH`
- `characterStyleOverrides` + `styleOverrideTable`: Mixed styling within one TEXT node (e.g. one bold or differently colored word). `characterStyleOverrides[i]` is the override id for character `i` (`0` = base `style`); `styleOverrideTable` maps each id to the overriding TypeStyle. **When present, the base `style` alone is NOT enough — split the text into spans**

### Design Token References

- `styles` (per node): Map of property → style ID (e.g. `{ "fill": "S:abc..." }`). Style names resolve via the top-level `styles` map — prefer the named token over the raw value when the project has a theme
- `boundVariables`: Figma Variables bound to properties (colors, spacing, radii). When present, the value comes from a design token — look for a matching token/theme value in the codebase instead of hardcoding

## Components (`components`)

- Nodes defined as Components or Component Sets in Figma
- `componentId`: Unique component ID
- Component instances (INSTANCE nodes) hold a reference to their source component

### Identifying Component Candidates

Criteria for determining which nodes should be implemented as components:

- Nodes defined as Components (Component / Component Set) in Figma
- Nodes with component-like naming (e.g. PascalCase names like `OutlinedButton`, `CardHeader` — not generic names like `Frame 1` or `Group 2`)

## Implementation Style Checklist

For **every** node you implement, verify each of the following against the saved JSON (not from memory or the screenshot):

- [ ] `fills` — background / text color (skip fills with `visible: false`)
- [ ] `strokes` + `strokeWeight` (+ `individualStrokeWeights`) — border presence, width, color, per-side differences
- [ ] `strokeAlign` / `strokeDashes` — border position and dash style
- [ ] `cornerRadius` / `rectangleCornerRadii` — rounding, per-corner differences
- [ ] `effects` — shadows and blurs
- [ ] `opacity` — layer transparency
- [ ] `visible: false` — the node (or fill/stroke/effect) must NOT be implemented
- [ ] `rotation` / `isMask` — rotated elements need a transform; masks clip, they are not content
- [ ] Auto Layout (`layoutMode`, `itemSpacing`, `counterAxisSpacing`, `padding*`, alignment) — spacing and alignment; wrapped layouts have a separate row gap
- [ ] `layoutPositioning: ABSOLUTE` — overlay children are positioned, not flex items
- [ ] Text `style` — font family, size, weight, line height, letter spacing, case, decoration
- [ ] `characterStyleOverrides` / `styleOverrideTable` — mixed-style text needs spans, not one uniform style
- [ ] `styles` / `boundVariables` — use the project's design tokens instead of hardcoded values when a token is referenced
