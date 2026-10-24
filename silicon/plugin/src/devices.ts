// The device layer: input and output for the gate-level CPU WITHOUT new gates. It lives only in
// the plugin-clock path. The CPU reads memory with `LD Rd,[addr]`, so a memory-mapped INPUT
// register is simply a RAM byte the plugin overwrites from outside, between ticks, by forcing the
// 8 RAM latch outputs of that byte (exactly how loadProgram preloads RAM). The poked latch nets
// then differ from what the variables show, so PluginClock's write() diff pushes them to their
// Figma variables like any other change: the MEM screen and the bound wires light up.
//
// Pure: no Figma API here. It works on any SimLike (FastSim, RefSim), so it is tested in Node.
import { ramBit, readRam, type SimLike } from "../../src/cpu/probes";
import { OUT_ADDR, RAM_BYTES } from "../../src/isa/spec";

/** The memory-mapped input byte. 15 is taken: a store to 15 also latches the OUT display
 * (OUT_ADDR), so the input byte is the one just below it, the last byte that is plain RAM.
 * Programs that read input must fit in bytes 0–13. */
export const IN_ADDR = OUT_ADDR - 1; // 14

/** What PluginClock calls (see ClockOptions.devices): at a tick boundary, before ticks run. */
export interface DeviceHook {
  /** Applies pending device state to the simulator; returns the number of nets forced. */
  apply(sim: SimLike): number;
}

/** Holds a pending input byte and writes it into RAM[addr] at the next tick boundary.
 *
 * Semantics: every input(v) is an event. The next apply() forces RAM[addr] to v, unless the
 * latch already holds v (then nothing is poked). A program may overwrite RAM[addr] itself (the
 * keypad program clears it to 0 to "consume" a key); the bus does not fight it, so pressing the
 * same key twice delivers it twice. */
export class DeviceBus implements DeviceHook {
  private pending = 0;
  private dirty = false;
  /** Bytes actually written into RAM (for the log / tests). */
  pokes = 0;

  constructor(readonly addr: number = IN_ADDR) {
    if (!Number.isInteger(addr) || addr < 0 || addr >= RAM_BYTES) throw new Error(`no RAM byte ${addr}`);
    if (addr === OUT_ADDR) throw new Error(`RAM[${OUT_ADDR}] is the OUT port, not an input`);
  }

  /** The last input byte requested. */
  get value(): number {
    return this.pending;
  }

  /** True while an input has not been applied yet. */
  get isPending(): boolean {
    return this.dirty;
  }

  /** Queues an input byte (0–255); it reaches RAM at the next apply(). */
  input(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new Error(`input must be a byte 0–255, got ${value}`);
    this.pending = value;
    this.dirty = true;
  }

  /** At a tick boundary (the state a tick ends in: CLK high, every master latch and RAM row
   * closed), forces the 8 latch outputs of RAM[addr] to the pending byte and settles, like
   * loadProgram. Only when an input is pending and the byte differs. Returns nets forced. */
  apply(sim: SimLike): number {
    if (!this.dirty) return 0;
    this.dirty = false;
    sim.set("CLK", 1); // already high between ticks; makes the hold explicit (a no-op then)
    const v = this.pending;
    if (readRam(sim, this.addr) === v) return 0;
    for (let bit = 0; bit < 8; bit++) sim.poke(ramBit(this.addr, bit), (v >> bit) & 1);
    sim.settle();
    const got = readRam(sim, this.addr);
    if (got !== v) throw new Error(`input RAM[${this.addr}]: wrote ${v}, reads ${got}`);
    this.pokes++;
    return 8;
  }
}

/** RAM bytes `firstRow` … `firstRow + rows - 1`, read straight from the latches: a readout other
 * code can render (MEM screen, image fill, a text dump). */
export function readFramebuffer(sim: Pick<SimLike, "peek">, firstRow = 0, rows = RAM_BYTES - firstRow): number[] {
  if (!Number.isInteger(firstRow) || !Number.isInteger(rows) || firstRow < 0 || rows < 0 || firstRow + rows > RAM_BYTES)
    throw new Error(`framebuffer rows ${firstRow}..${firstRow + rows - 1} are outside RAM (0..${RAM_BYTES - 1})`);
  return Array.from({ length: rows }, (_, i) => readRam(sim, firstRow + i));
}
