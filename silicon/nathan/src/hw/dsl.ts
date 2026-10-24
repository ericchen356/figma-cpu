// Small gate-building helpers shared by the CPU NATHAN modules. Every helper places real
// primitive gates (gate/AND …) through the silicon HDL, with unique instance names, so the
// drawn module shows exactly the gates that compute the signal. Nothing here is behaviour:
// it only saves typing `place(b, "AND", `g${n++}`, [x, y])` a few thousand times.
import { place } from "../../../src/cells/util";
import type { ModuleBuilder } from "../../../src/hdl/builder";
import { CONST0, CONST1, type GateType } from "../../../src/netlist/types";

export type Bus = string[];

export interface Logic {
  g(t: GateType, ins: string[], out?: string): string;
  AND(x: string, y: string): string;
  OR(x: string, y: string): string;
  NOT(x: string): string;
  and3(x: string, y: string, z: string): string;
  /** Balanced OR / AND trees; the empty OR is 0, the empty AND is 1. `out` names the root net. */
  orAll(xs: string[], out?: string): string;
  andAll(xs: string[], out?: string): string;
  /** Bus select: S ? B : A (one NOT, then AND-AND-OR per bit). `outs` names the result nets. */
  mux2(A: Bus, B: Bus, S: string, outs?: Bus): Bus;
  /** Per bit: OR over terms of (select AND bus bit). Terms are expected to be mutually exclusive. */
  andOr(terms: Array<[string, Bus]>, width: number, outs?: Bus): Bus;
  /** A one-hot decoder cell (DEC2 / DEC3 / DEC4), enabled; `outs` names the output nets. */
  dec(A: Bus, name: string, outs?: Bus): Bus;
  /** A buffer into a named net (to drive an output port bit from an existing net). */
  buf(x: string, out: string): string;
}

/** Gate helpers bound to one module builder. Call once per module. */
export function logic(b: ModuleBuilder): Logic {
  let n = 0;
  const g = (t: GateType, ins: string[], out?: string) =>
    place(b, t, `g${n++}`, ins, out);
  const AND = (x: string, y: string, out?: string) => g("AND", [x, y], out);
  const OR = (x: string, y: string, out?: string) => g("OR", [x, y], out);
  const NOT = (x: string) => g("NOT", [x]);
  const buf = (x: string, out: string) => g("BUF", [x], out);
  const tree = (
    op: (x: string, y: string, out?: string) => string,
    xs: string[],
    empty: string,
    out?: string,
  ) => {
    if (!xs.length) return out ? buf(empty, out) : empty;
    if (xs.length === 1) return out ? buf(xs[0], out) : xs[0];
    let level = xs;
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2)
        next.push(
          i + 1 < level.length
            ? op(level[i], level[i + 1], level.length === 2 ? out : undefined)
            : level[i],
        );
      level = next;
    }
    return level[0];
  };
  const orAll = (xs: string[], out?: string) => tree(OR, xs, CONST0, out);
  const andAll = (xs: string[], out?: string) => tree(AND, xs, CONST1, out);
  return {
    g,
    AND: (x, y) => AND(x, y),
    OR: (x, y) => OR(x, y),
    NOT,
    and3: (x, y, z) => AND(AND(x, y), z),
    orAll,
    andAll,
    mux2(A, B, S, outs) {
      const ns = NOT(S);
      return A.map((a, i) => OR(AND(a, ns), AND(B[i], S), outs?.[i]));
    },
    andOr(terms, width, outs) {
      return Array.from({ length: width }, (_, i) =>
        orAll(
          terms.map(([s, bus]) => AND(s, bus[i])),
          outs?.[i],
        ),
      );
    },
    dec(A, name, outs) {
      return b.use(
        `DEC${A.length}`,
        outs ? { A, EN: CONST1, Y: outs } : { A, EN: CONST1 },
        name,
      ).Y;
    },
    buf,
  };
}

/** `k`-th group of `width` bits of a flat bus. */
export const slice = (bus: Bus, k: number, width: number): Bus =>
  bus.slice(k * width, (k + 1) * width);

export const zeros = (n: number): Bus => Array(n).fill(CONST0);
