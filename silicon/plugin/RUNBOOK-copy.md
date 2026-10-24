# Running the hardened copy (ours/silicon) without touching Eric's file

This branch is a **copy** of `eric/silicon` plus fixes. It has no upstream and never pushes to `eric/*`. To try it in
Figma without affecting anyone: **File → Duplicate** Eric's "Eric testing" file into your own drafts and run everything
there. His file and his branches are never written.

## What changed vs eric/silicon

| Change | Why |
|---|---|
| **Chunked Reset** (`src/prototype/apply.ts`) | Reset ran ~2,290 actions in one click. The viewer died at 2,001 in the team's own spike. A big reset is now a hop chain over two extra frames (`Reset A ⇄ Reset B`), ≤ 395 actions per event, then back to Control. |
| **MEM screen** (`plugin/src/panel.ts`) | The front panel gets a 16 × 8 lamp matrix bound to the 128 RAM bits. No hardware change; works in Present mode and with the plugin clock. A program "draws" by storing bytes (code shows up too: the RAM is shared). |
| **5 new programs** (`src/isa/programs/`) | `pow2`, `triangle`, `mod`, `blink`, `lfsr`. All verified gate-level against the ISA model, tick for tick. |
| **`npm run audit -- page.json`** | Checks a REST dump of a built page: gates drawn = gates the code builds, and every event ≤ the action budget. |

## Steps (Figma desktop, in your duplicate)

```bash
cd silicon && npm ci && node plugin/build.mjs        # → plugin/dist/code.js + ui.html
```

1. Plugins → Development → Import plugin from manifest → `silicon/plugin/manifest.json` → run **FigmaCPU Silicon**.
2. **Build hardware** (once; slow: ~72k layers), then **Compile** (the default `Max actions / event` = 400 is the safe value).
3. ▶ Present → flow **CPU · Step**. A clock tick is now 11 Step clicks (watch the `phase` counter); **Run ▸** loops;
   **Reset** hops through the two Reset frames and returns to Control.
4. Fast mode: the panel's **Run** (plugin clock). About 115k ticks/s simulated; the cost inside Figma is variable writes
   (about 110–120 per tick on count/lfsr/blink, peak about 256).

## Check a built file from the outside (read-only)

Fetch the silicon page's nodes with the Figma REST API (`GET /v1/files/<file key>/nodes?ids=<silicon page id>`, header
`X-Figma-Token`), save the JSON, then:

```bash
npm run audit -- page.json          # exit 1 if a gate count differs or an event is over the cap
```

Eric's current file (built before the chunking commit) audits as: 2,285 gates identical to the code, but Step (3,861),
Reset (2,289) and both Run hops (3,863) are single events far past 2,001, so **rebuild with Compile** before presenting.

## Not verified (needs a person in Figma desktop)

Everything above is tested in Node against a fake Figma API and the Figma action emulator. Not yet seen in the real
viewer: the chunked Step/Reset hop chain, the MEM lamp bindings, and the plugin clock's write rate.
