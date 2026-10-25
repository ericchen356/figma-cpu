// The toolbar's memory: each group of tools shows the last one picked from it (os-ui's groupPick in
// main.ts), which osflow's editor does not keep. One register per group of several tools, loaded
// with the outgoing tool whenever the editor writes its tool register, so an event that leaves the
// tool alone leaves these alone too. The screen shows a group's active tool while the tool is one
// of its own (that button covers the group's), else the tool this register remembers.
//
//   PICK        the load enable and next value of every group's register, from the tool register
//   r_pick_<g>  the registers (NATHAN's REGS<n>, like every other register of the chip)
import { ModuleBuilder } from "../../../src/hdl/builder";
import { CONST0, CONST1, type Library } from "../../../src/netlist/types";
import { defineRegS } from "../../../nathan/src/hw/cells";
import { exportLines, Gates } from "./disp";

/** os-ui's toolbar groups of several tools, by tool code (catalog.ts TOOL_NAMES), in their flyout's
 * order: the first is the one a group shows until another is picked. */
export const PICK_GROUPS = {
  move: [0, 1, 2],
  region: [3, 4, 5],
  shape: [6, 7, 8, 9, 10, 11],
  creation: [12, 13, 14],
} as const;
export type PickGroup = keyof typeof PICK_GROUPS;
export const PICK_NAMES = Object.keys(PICK_GROUPS) as PickGroup[];

/** Bits of a group's register: the index of its tool in the group. */
export const pickBits = (g: PickGroup) =>
  Math.ceil(Math.log2(PICK_GROUPS[g].length));

/** The register of a group: instance and output nets (OS scope), LSB first. */
export interface PickReg {
  inst: string;
  nets: string[];
}

/** Defines PICK in `lib` and places it and the registers in the OS module, reading the tool
 * register's outputs `tool` and its load enable `toolLoad`. All registers power on at 0. */
export function addPick(
  lib: Library,
  osName: string,
  tool: string[],
  toolLoad: string,
): Record<PickGroup, PickReg> {
  const b = new ModuleBuilder(lib, "PICK", {
    in: { TOOL: tool.length, TLOAD: 1 },
  });
  const G = new Gates(b);
  const hot = G.decode(b.in("TOOL"), Object.values(PICK_GROUPS).flat());
  const lines = Object.fromEntries(
    PICK_NAMES.map((g) => {
      const tools = PICK_GROUPS[g].map((t) => hot.get(t)!);
      return [
        g,
        {
          load: G.and(b.in1("TLOAD"), G.orAll(tools)),
          d: Array.from({ length: pickBits(g) }, (_, j) =>
            G.orAll(tools.filter((_, k) => (k >> j) & 1)),
          ),
        },
      ];
    }),
  );
  const { src, width } = exportLines(b, lines);
  lib.set(
    "PICK",
    b.build(
      "the toolbar's memory: which tool of each group to show when none of it is active",
    ),
  );

  const os = lib.get(osName)!;
  const conn: Record<string, string[]> = { TOOL: tool, TLOAD: [toolLoad] };
  const outNames = Array.from({ length: width }, (_, i) => `pick_y${i}`);
  os.instances.push({
    name: "pick",
    cell: "PICK",
    conn: { ...conn, ...(width ? { Y: outNames } : {}) },
  });
  const net = (s: unknown): string => {
    const o = s as { y?: number; in?: string; k?: 0 | 1 };
    if (o.y !== undefined) return outNames[o.y];
    if (o.k !== undefined) return o.k ? CONST1 : CONST0;
    const m = /^(\w+?)(?:\[(\d+)\])?$/.exec(o.in!)!;
    return conn[m[1]][m[2] ? Number(m[2]) : 0];
  };
  const regs = {} as Record<PickGroup, PickReg>;
  for (const g of PICK_NAMES) {
    const n = pickBits(g);
    defineRegS(lib, n);
    const s = (src as Record<PickGroup, { load: unknown; d: unknown[] }>)[g];
    const inst = `r_pick_${g}`;
    const nets = Array.from({ length: n }, (_, i) => `pick_${g}[${i}]`);
    os.instances.push({
      name: inst,
      cell: `REGS${n}`,
      conn: {
        D: s.d.map(net),
        LOAD: [net(s.load)],
        CLK: ["CLK"],
        NCLK: ["nclk"],
        Q: nets,
      },
    });
    regs[g] = { inst, nets };
  }
  return regs;
}
