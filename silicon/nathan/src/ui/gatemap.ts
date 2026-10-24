// The machine at a glance: one lamp per gate, grouped by the module it sits in, each bound to its
// gate's output (the same variable as that gate's lamp in the drawing). In Present mode every
// click lights the gates it computes, all of them on one screen; the drawing has the wiring.
import type { FlatNetlist } from "../../../src/netlist/types";
import type { NodeSpec } from "./spec";

export interface GateMapOptions {
  /** Width of the map; the blocks are packed into `columns` columns of equal width. */
  width: number;
  columns: number;
  /** Lamp size and gap, px. */
  lamp: number;
  gap: number;
  /** The net a gate's lamp shows (by default its output). */
  netOf?: (gate: number) => string;
  /** A block's title, from the instance name ("hit" → "hit · HIT8"). */
  title?: (block: string, gates: number) => string;
  /** Block background, title text, a lamp that is on, and the square every gate shows when off. */
  colours: { block: string; text: string; lamp: string; off: string };
}

/** Modules in the order of the block diagram; anything else follows, top-level glue last. */
const ORDER = [
  "evdec",
  "conds",
  "hit",
  "free",
  "plane",
  "geom",
  "layerctl",
  "newrec",
  "l0",
  "l1",
  "l2",
  "l3",
  "l4",
  "l5",
  "l6",
  "l7",
  "state",
  "disp",
];
export const GLUE = "glue";
const TITLE_H = 18;
const PAD = 6;
const BLOCK_GAP = 10;

/** The gate map as a node spec, `width` wide; its height is the tallest column. */
export function gateMap(net: FlatNetlist, o: GateMapOptions): NodeSpec {
  const groups = new Map<string, number[]>();
  net.gates.forEach((g, i) => {
    const top = g.path.includes("/") ? g.path.split("/")[0] : GLUE;
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top)!.push(i);
  });
  const rank = (n: string) =>
    n === GLUE
      ? ORDER.length + 1
      : ORDER.includes(n)
        ? ORDER.indexOf(n)
        : ORDER.length;
  const names = [...groups.keys()].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );

  const colW = (o.width - (o.columns - 1) * BLOCK_GAP) / o.columns;
  const pitch = o.lamp + o.gap;
  const perRow = Math.max(1, Math.floor((colW - 2 * PAD + o.gap) / pitch));
  const heights = new Array<number>(o.columns).fill(0);
  const blocks: NodeSpec[] = [];
  for (const name of names) {
    const gates = groups.get(name)!.sort((a, b) =>
      net.gates[a].path.localeCompare(net.gates[b].path, undefined, {
        numeric: true,
      }),
    );
    const rows = Math.ceil(gates.length / perRow);
    const h = TITLE_H + rows * pitch - o.gap + PAD;
    const col = heights.indexOf(Math.min(...heights));
    blocks.push({
      type: "frame",
      name: `block/${name}`,
      x: col * (colW + BLOCK_GAP),
      y: heights[col],
      w: colW,
      h,
      fill: o.colours.block,
      radius: 4,
      children: [
        {
          type: "text",
          name: "title",
          x: PAD,
          y: 3,
          text: {
            chars: o.title?.(name, gates.length) ?? `${name} · ${gates.length}`,
            size: 10,
            bold: true,
            color: o.colours.text,
          },
        },
        // every gate is a dark square; its lamp lights over it while its output is 1
        ...gates.flatMap((gi, k): NodeSpec[] => {
          const x = PAD + (k % perRow) * pitch;
          const y = TITLE_H + Math.floor(k / perRow) * pitch;
          const square = {
            type: "rect",
            x,
            y,
            w: o.lamp,
            h: o.lamp,
            radius: 1,
          } as const;
          return [
            { ...square, name: "off", fill: o.colours.off },
            {
              ...square,
              name: `gate/${net.gates[gi].path}`,
              fill: o.colours.lamp,
              visibleNet: o.netOf?.(gi) ?? net.netNames[net.gates[gi].out],
            },
          ];
        }),
      ],
    });
    heights[col] += h + BLOCK_GAP;
  }
  return {
    type: "frame",
    name: "gate map",
    x: 0,
    y: 0,
    w: o.width,
    h: Math.max(...heights) - BLOCK_GAP,
    children: blocks,
  };
}
