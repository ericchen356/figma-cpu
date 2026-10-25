// The os-ui chip as the Figma OS runs it: osflow's synthesized editor (osflow/src/gates, the
// hardware target of osflow/src/editor.ts, itself a port of os-ui's reducer), with
//   · every register (osflow's REG_W<n>, a DFFE per bit) swapped for NATHAN's REGS<n>: one shared
//     load enable and one global inverted clock, so an idle register costs a Figma event nothing
//     and a loading one commits behind a single `if`;
//   · the global inverted clock `nclk` at the top, as NATHAN's synthesizer expects;
//   · the toolbar's memory PICK (pick.ts): os-ui keeps it outside the editor, so osflow has none;
//   · the screen decode DISP (disp.ts) as instance "disp", which the screen's layers bind to.
// The swap changes no behaviour: test/chip.test.ts runs it beside osflow's GateMachine.
import { buildEditor } from "../../../../osflow/src/editor";
import {
  synthesize,
  type Synth,
} from "../../../../osflow/src/gates/synthesize";
import { defineRegS } from "../../../nathan/src/hw/cells";
import { powerOn } from "../../../src/compile";
import { flatten } from "../../../src/netlist/flatten";
import type { FlatNetlist, Library } from "../../../src/netlist/types";
import {
  addDisplay,
  SLOT_FIELDS,
  SLOTS,
  type DisplayLines,
  type SlotField,
} from "./disp";
import { addPick, PICK_NAMES, type PickGroup, type PickReg } from "./pick";

export interface OsuiChip {
  syn: Synth;
  lib: Library;
  /** "OS". */
  top: string;
  /** For silicon's powerOn(): every register bit's master and slave latch, at its initial value. */
  pokes: Record<string, number>;
  /** The toolbar's memory: registers of the chip that osflow's editor does not have. */
  picks: Record<PickGroup, PickReg>;
  display: DisplayLines;
}

/** Builds the chip's library: osflow's editor synthesized, registers swapped, the display added. */
export function osuiChip(): OsuiChip {
  const syn = synthesize(buildEditor({ target: "hardware" }));
  const lib = syn.lib;
  const os = lib.get(syn.top)!;
  for (const inst of os.instances) {
    const m = /^REG_W(\d+)$/.exec(inst.cell);
    if (!m) continue;
    defineRegS(lib, Number(m[1]));
    inst.cell = `REGS${m[1]}`;
    inst.conn.NCLK = ["nclk"];
  }
  os.instances.unshift({
    name: "nclk",
    cell: "gate/NOT",
    conn: { A: ["CLK"], Y: ["nclk"] },
  });
  // DFFE's master latch is `<reg>/b<i>/m`; REGS<n> names it `<reg>/m<i>`
  const pokes: Record<string, number> = {};
  for (const [k, v] of Object.entries(syn.pokes)) {
    const m = /^(.*)\/b(\d+)\/m$/.exec(k);
    pokes[m ? `${m[1]}/m${m[2]}` : k] = v;
  }
  const reg = (name: string) => {
    const r = syn.regs.get(name);
    if (!r) throw new Error(`the editor has no register ${name}`);
    return r.nets;
  };
  // the toolbar's memory loads when the editor writes its tool
  const tool = reg("g/tool");
  const toolReg = os.instances.find(
    (i) => i.cell.startsWith("REGS") && i.conn.Q?.[0] === tool[0],
  );
  if (!toolReg) throw new Error("no register drives the tool");
  const picks = addPick(lib, syn.top, tool, toolReg.conn.LOAD[0]);
  for (const g of PICK_NAMES)
    picks[g].nets.forEach((q, i) => {
      pokes[q] = 0;
      pokes[`${picks[g].inst}/m${i}`] = 0;
    });
  const display = addDisplay(lib, syn.top, {
    n: reg("g/n"),
    sel: reg("g/sel"),
    tool,
    fill: reg("g/fill"),
    tCreate: reg("g/tCreate")[0],
    tSelect: reg("g/tSelect")[0],
    pick: Object.fromEntries(
      PICK_NAMES.map((g) => [g, picks[g].nets]),
    ) as Record<PickGroup, string[]>,
    slots: Array.from(
      { length: SLOTS },
      (_, i) =>
        Object.fromEntries(
          (Object.keys(SLOT_FIELDS) as SlotField[]).map((f) => [
            f,
            reg(`L${i}/${f}`),
          ]),
        ) as Record<SlotField, string[]>,
    ),
  });
  return { syn, lib, top: syn.top, pokes, picks, display };
}

export function osuiNetlist(chip: OsuiChip): FlatNetlist {
  return flatten(chip.lib, chip.top);
}

/** The settled power-on state: every register at its initial value, the inputs at 0. */
export function osuiPowerOn(net: FlatNetlist, chip: OsuiChip): Uint8Array {
  return powerOn(net, chip.pokes);
}
