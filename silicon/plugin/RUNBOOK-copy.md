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

## Verify the first run from outside

After a teammate runs **Build hardware → Compile** in Figma desktop, read the file back (same REST call as above, the
silicon page's id) and run `npm run audit -- page.json` (add `--json` for the structured result). It prints one ✓/✗
line per check and ends with `VERDICT: READY to present` (exit 0) or `VERDICT: REBUILD needed: …` (exit 1):

| Check | Passes when |
|---|---|
| gates | the gates under `cell/CPU` equal the code's 2,285, by type |
| frames / flows | Control, Run A/B, `CPU · Step` exist (+ Reset A/B and Reset A/B (Step) when Reset is chunked); ▶ Present has flows on Control and `CPU · Step` (matched by node, the flow's name does not matter) |
| Step | each `button/Step` is one click, ≤ cap, no navigation |
| Run loop | Run → Run A; Run A ⇄ Run B by AFTER_TIMEOUT; both can exit to Control; each hop ≤ cap |
| Reset on Control / on CPU · Step | the click starts a chain through Reset hop frames of its own flow only, every hop ≤ cap, every hop frame can reach the button's own frame (no cycle without an exit), and nothing exits anywhere else. A single click over the cap = the old unchunked build: rebuild |
| every event | all reactions in the page ≤ cap |
| bindings | 2,285 gate `lit` layers bound; every front panel lamp bound, in the component and each instance; the 128 MEM lamps `lamp/ram/row<N>/b<M>/Q` bound (unbound ones are named) |
| variables | distinct variables bound to lit layers = the code's 2,287 wires, all written by some reaction; control variables are named from how reactions use them |

Event cost: a chunked Step is `now := phase` then K exclusive `if now == k` cases, so one click costs 1 + K + its biggest
chunk (≤ 394 at cap 400), not the sum of all chunks. The old `worstCase` rule summed them and would have called every
chunked rebuild a crash; `eventWorst` counts it the way `apply()` budgets it.

A plugin-built file (fake Figma, `test/audit-e2e.test.ts`) audits READY: Step ≤ 394, Run hops ≤ 396, both Reset chains
return home, 2,295 variables = 2,287 wires + 8 control. Eric's legacy file audits REBUILD (Step 3,861, Reset 2,289, Run hops
3,863) and also has **no MEM matrix**: Compile reuses an existing `Silicon · Front panel`, so **delete that component
before Compile** (or the MEM check stays ✗).
