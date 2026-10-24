# Leila CPU design

Draws the FigmaCPU machine (8-bit data, 16-bit address, two buses, opcode table on the canvas) on the **Leila** page as a two-bus schematic. The frame is named `Machine v2` and keeps every layer name the FigmaCPU and Leila CPU plugins bind to, so either one can run it. Only the Leila page is touched.

## Build and draw

```bash
node build.mjs --force
```

`--force` replaces an existing drawing on the Leila page. The build reads `../spec/*.json` and the stages in `src/`, then writes two versions of the same script:

- `code.js`: dev plugin. Figma desktop → Plugins → Development → Import plugin from manifest → `manifest.json` → run **FigmaCPU — draw Leila page**.
- `use-figma.js`: body for the Figma MCP `use_figma` tool (about 25,000 characters).

## Stages

Each file in `src/` draws one part of the machine, in build order:

| Stage | File | Draws |
|---|---|---|
| 1 | `base.js` | settings, palette, fonts, drawing primitives, layout grid |
| 2 | `components.js` | Lamp and Register components, labelled lamps, value blocks, bus connectors |
| 3 | `datapath.js` | address and data buses, PC / SP / H:L / W / MAR / memory, IR / OPR / T / ALU / MDR, registers A–L |
| 4 | `control.js` | phase lamps, T-state counter, control signals grouped by role |
| 5 | `memory.js` | decoder (opcode table) and RAM / pinned windows |
| 6 | `devices.js` | 128×96 screen and palette, memory-mapped IO, legend |
| 7 | `machine.js` | puts the stages together on the Leila page |
