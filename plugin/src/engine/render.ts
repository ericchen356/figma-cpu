// LANE: engine. Turns machine state into canvas writes through an injected port (Figma in the plugin, a fake in tests).
// Diff-based: a value is forwarded to the port ONLY when it changed since the last frame (PRD §10 perf rules).
import { N, REGS, FLAGS, hex, type Phase, type IoName } from "../contracts/nodes";
import type { MachineState } from "../contracts/messages";
import type { StepInfo } from "./cpu";

export interface RenderPort {
  /** field=null: the node itself is the TEXT node; otherwise write the child TEXT named `field`. */
  text(node: string, field: string | null, value: string): void;
  /** light/unlight the lamp: child "lamp" of the named node. */
  lamp(node: string, on: boolean): void;
  /** highlight a node (register variant active / bus stroke / row or cell fill). */
  mark(node: string, on: boolean): void;
}

export const IO_NAMES: IoName[] = ["MOUSE_X", "MOUSE_Y", "MOUSE_BTN", "KEY", "TICK", "RAND"];
export const RAM_WINDOW = 256;
export const PIN_WINDOW = 64;

export class Renderer {
  private cache = new Map<string, string | boolean>();
  writes = 0; // number of port calls actually made (tests + perf telemetry)
  pinBase = 0x4000;

  constructor(private port: RenderPort) {}

  private text(node: string, field: string | null, v: string) {
    const k = `t|${node}|${field}`;
    if (this.cache.get(k) === v) return;
    this.cache.set(k, v);
    this.writes++;
    this.port.text(node, field, v);
  }
  private flag(kind: "l" | "m", node: string, on: boolean) {
    const k = `${kind}|${node}`;
    if (this.cache.get(k) === on) return;
    this.cache.set(k, on);
    this.writes++;
    kind === "l" ? this.port.lamp(node, on) : this.port.mark(node, on);
  }
  private lamp(n: string, on: boolean) { this.flag("l", n, on); }
  private mark(n: string, on: boolean) { this.flag("m", n, on); }

  /** Forget everything (e.g. after the canvas was rebound): the next render rewrites all nodes. */
  invalidate() { this.cache.clear(); }

  /**
   * @param info the instruction just executed (Watch mode animation); omit in Turbo for state-only frames.
   * @param io current IO register values for mem/io/* (optional)
   */
  render(s: MachineState, mem: Uint8Array, info?: StepInfo | null, io?: Partial<Record<IoName, number>>) {
    for (const r of REGS) {
      this.text(N.reg(r), "value", hex(s.regs[r], 2));
      this.text(N.reg(r), "dec", String(s.regs[r]));
      this.mark(N.reg(r), !!info?.regsWritten.includes(r));
    }
    this.text(N.pc, "value", hex(s.pc, 4));
    this.text(N.sp, "value", hex(s.sp, 4));
    this.text(N.ir, "value", hex(s.ir, 2));
    this.text(N.ir, "mnem", info?.row?.mnem ?? (info?.fault ? "???" : "NOP"));
    this.text(N.hl, null, `H:L = ${hex((s.regs.H << 8) | s.regs.L, 4)}`);
    this.text(N.cycles, null, `cycles ${s.cycles}`);
    for (const f of FLAGS) this.lamp(N.flag(f), s.flags[f]);

    // phase lamps: a step runs all three; show the one that "just finished" as EXEC in Watch, all off in Turbo
    const phase: Phase | null = info ? "EXEC" : null;
    (["FETCH", "DECODE", "EXEC"] as Phase[]).forEach((p) => this.lamp(N.phase(p), p === phase));
    this.lamp(N.clock, !!info);

    if (info?.alu) {
      this.text(N.alu.op, null, info.alu.op);
      this.text(N.alu.in1, null, hex(info.alu.in1, 2));
      this.text(N.alu.in2, null, hex(info.alu.in2, 2));
      this.text(N.alu.out, null, hex(info.alu.out, 2));
    }
    if (info) {
      this.text(N.busAddr, "value", hex(info.addrBus, 4));
      this.text(N.busData, "value", hex(info.dataBus, 2));
      this.mark(N.busAddr, true);
      this.mark(N.busData, true);
    } else {
      this.mark(N.busAddr, false);
      this.mark(N.busData, false);
    }

    // decoder row highlight (the row of the instruction that just ran)
    const rowOp = info?.row?.op ?? null;
    if (this.lastRow && this.lastRow !== rowOp) this.mark(`${N.decoderTable}/${N.row(this.lastRow)}`, false);
    if (rowOp) this.mark(`${N.decoderTable}/${N.row(rowOp)}`, true);
    this.lastRow = rowOp;

    // RAM window follows PC (256-byte page); pinned window shows any address
    const base = s.pc & 0xff00;
    this.text(N.ramBase, null, `base ${hex(base, 4)}`);
    for (let i = 0; i < RAM_WINDOW; i++) this.text(N.ramCell(i), "v", hex(mem[base + i], 2));
    this.mark(N.ramCell(s.pc & 0xff), true);
    if (this.lastPcCell !== null && this.lastPcCell !== (s.pc & 0xff)) this.mark(N.ramCell(this.lastPcCell), false);
    this.lastPcCell = s.pc & 0xff;
    this.text(N.pinBase, null, `base ${hex(this.pinBase, 4)}`);
    for (let i = 0; i < PIN_WINDOW; i++) this.text(N.pinCell(i), "v", hex(mem[this.pinBase + i], 2));

    if (io) for (const n of IO_NAMES) if (io[n] !== undefined) this.text(N.io(n), "value", hex(io[n]!, 2));
  }
  private lastRow: string | null = null;
  private lastPcCell: number | null = null;
}
