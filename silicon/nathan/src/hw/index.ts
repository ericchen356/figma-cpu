// CPU NATHAN hardware: the library, the flattened netlist and its power-on state.
import { buildCells } from "../../../src/cells";
import { powerOn } from "../../../src/compile";
import { flatten } from "../../../src/netlist/flatten";
import type { FlatNetlist, Library } from "../../../src/netlist/types";
import { defineEngine } from "./engine";
import { INITIAL_FILL, STATE_NETS } from "./layout";

export * from "./layout";
export { defineEngine } from "./engine";

/** The silicon cell library plus the CPU NATHAN modules (top: ENGINE). */
export function nathanLibrary(): Library {
  const lib: Library = new Map();
  buildCells(lib);
  defineEngine(lib);
  return lib;
}

/** The whole machine flattened to gates. */
export function nathanNetlist(lib: Library = nathanLibrary()): FlatNetlist {
  return flatten(lib, "ENGINE");
}

/** Settled power-on state: every register 0 except the current colour (the editor starts on
 * palette 12). Both latches of the colour register are preset, so the value holds. */
export function nathanPowerOn(net: FlatNetlist): Uint8Array {
  const pokes: Record<string, number> = {};
  const name = STATE_NETS.cur;
  for (let i = 0; i < 4; i++) {
    const bit = (INITIAL_FILL >> i) & 1;
    pokes[`${name}[${i}]`] = bit;
    pokes[`state/${name}/m${i}`] = bit;
  }
  return powerOn(net, pokes);
}
