// Booting the synthesized OS at any register values, not only at power-on: the pokes that
// silicon's powerOn() needs to settle there. They are synthesize()'s Synth.pokes with other
// values: both latches of every register bit (the slave is the register's output, the master
// what it loads on the next rising edge, so the two must agree) and the input ports at their
// power-on values. codec.ts's stateVars() gives the register values of an editor state, and
// GateMachine.load() boots there.
import { portBits } from "../../../silicon/src/netlist/types";
import type { Val } from "../ir";
import { bitsOfValue, typeRange } from "./dag";
import type { RegInfo, Synth } from "./synthesize";

/** A value for every state variable (every register) by name, a boolean for a bool register.
 * Names that are not registers are ignored, so a flow's whole variable map will do. */
export type RegisterValues = ReadonlyMap<string, Val>;

/** The register's value as the number its bits hold (0 or 1 for a bool), checked against its width. */
function registerValue(name: string, r: RegInfo, v: Val | undefined): number {
  if (v === undefined) throw new Error(`no value for the register ${name}`);
  if (r.bool) {
    if (typeof v !== "boolean")
      throw new Error(`${name} is a bool register, not ${JSON.stringify(v)}`);
    return v ? 1 : 0;
  }
  const [lo, hi] = typeRange(r.bits, r.signed);
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi)
    throw new Error(
      `${name} = ${JSON.stringify(v)} does not fit ${r.signed ? "signed" : "unsigned"} ${r.bits} bits`,
    );
  return v;
}

/** Each register's master latch outputs, bit by bit. A register is the REG_W<n> instance of the
 * top module whose Q drives its output nets; silicon builds REG_W<n> from the DFFE cells b0, b1…,
 * and the master latch of each drives its net m. A constant register has no instance. */
function masterLatches(syn: Synth): Map<string, string[]> {
  const byQ = new Map<string, string>();
  for (const inst of syn.lib.get(syn.top)!.instances)
    if (inst.cell.startsWith("REG_W") && inst.conn.Q)
      byQ.set(inst.conn.Q.join(), inst.name);
  const out = new Map<string, string[]>();
  for (const [name, r] of syn.regs) {
    const inst = byQ.get(r.nets.join());
    if (inst)
      out.set(
        name,
        r.nets.map((_, i) => `${inst}/b${i}/m`),
      );
  }
  return out;
}

/** The power-on pokes for silicon's powerOn() that put every register at its value in `vars`, as
 * Synth.pokes puts them at their initial values: both latches of every register bit, then the
 * input ports at their power-on values (0), in Synth.pokes's order. Throws when a register has no
 * value or one its width cannot hold, or when a register synthesize() proved constant is given
 * another value than its constant. pokesFor(syn, the initial values) is syn.pokes. */
export function pokesFor(
  syn: Synth,
  vars: RegisterValues,
): Record<string, number> {
  const masters = masterLatches(syn);
  const pokes: Record<string, number> = {};
  for (const [name, r] of syn.regs) {
    const value = registerValue(name, r, vars.get(name));
    const m = masters.get(name);
    if (!m) {
      if (value !== r.init)
        throw new Error(
          `${name} is the constant ${r.init} in the gates; it cannot hold ${value}`,
        );
      continue;
    }
    bitsOfValue(value, r.bits).forEach((bit, i) => {
      pokes[r.nets[i]] = bit;
      pokes[m[i]] = bit;
    });
  }
  for (const p of syn.inputs.values())
    for (const bit of portBits({ name: p.port, width: p.bits }))
      pokes[bit] = syn.pokes[bit];
  return pokes;
}
