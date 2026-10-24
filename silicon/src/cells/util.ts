// Small helpers shared by the cell definitions.
import type { ModuleBuilder } from "../hdl/builder";
import type { GateType } from "../netlist/types";

/** Places a primitive gate whose instance (the Figma layer) and output net share a meaningful
 * name. `out` overrides the output net (a port bit or a pre-made bus wire). */
export function place(b: ModuleBuilder, type: GateType, name: string, inputs: string[], out?: string): string {
  if (b.instances.some((i) => i.name === name)) throw new Error(`${b.name}: duplicate instance ${name}`);
  return b.gate(type, inputs, out ?? b.wire1(name), name);
}

/** OR of several nets as a balanced tree of named 2-input ORs (`${name}1`, `${name}2`, …);
 * the root drives `out`. */
export function orTree(b: ModuleBuilder, name: string, nets: string[], out: string): string {
  if (nets.length === 0) throw new Error(`${b.name}: empty OR tree ${name}`);
  if (nets.length === 1) return place(b, "BUF", name, nets, out);
  let level = nets;
  let k = 0;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) next.push(level[i]);
      else next.push(place(b, "OR", `${name}${++k}`, [level[i], level[i + 1]], level.length === 2 ? out : undefined));
    }
    level = next;
  }
  return level[0];
}
