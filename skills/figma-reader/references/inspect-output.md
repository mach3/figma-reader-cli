# inspect Output Reference

## Overview

Field descriptions for the `figma-reader inspect` JSON output. Use this as a reference when communicating design information to the user or handing off to implementation workflows (`/feature-dev`, etc.).

## Node Tree (`nodes`)

Each node contains the following information:

- **type**: Node type (FRAME, TEXT, RECTANGLE, COMPONENT, INSTANCE, etc.)
- **name**: Layer name in Figma
- **size**: `width`, `height` (pixels)
- **position**: `x`, `y` (relative to parent node)

### Layout Properties

Frames with Auto Layout include:

- `layoutMode`: `HORIZONTAL` / `VERTICAL` → corresponds to flexbox direction
- `itemSpacing` → corresponds to gap
- `paddingTop` / `paddingRight` / `paddingBottom` / `paddingLeft` → corresponds to padding
- `primaryAxisAlignItems` / `counterAxisAlignItems` → corresponds to justify-content / align-items

Nodes with `layoutMode` set to `NONE` have no Auto Layout. They likely use absolute positioning.

## Styles (`styles`)

### Colors
- `fills` array: Each fill has `color` (RGBA) and `type` (`SOLID`, etc.)
- `strokes` array: Border colors

### Text
- `fontFamily`: Font name
- `fontSize`: Size (px)
- `fontWeight`: Weight (numeric)
- `lineHeight`: Line height
- `textAlignHorizontal` / `textAlignVertical`: Text alignment

### Effects
- `effects` array: Drop shadows, blurs, etc.

## Components (`components`)

- Nodes defined as Components or Component Sets in Figma
- `componentId`: Unique component ID
- Component instances (INSTANCE nodes) hold a reference to their source component

### Identifying Component Candidates

Criteria for determining which nodes should be implemented as components:

- Nodes defined as Components (Component / Component Set) in Figma
- Nodes with component-like naming (e.g. PascalCase names like `OutlinedButton`, `CardHeader` — not generic names like `Frame 1` or `Group 2`)
