// The display's look-up tables: what a slot's screen lines become on screen when a line alone is
// not a picture. The gates compute every value down to one-hot lines and decimal digits (cpu/disp.ts);
// these tables only map such a line to its glyph or colour, as a character ROM and a palette DAC
// do in a display controller: one constant per case, chosen by the lines that are on. No
// arithmetic: a case is a conjunction of lines, its value a constant.
//
// They run at the end of a slot's display tail, each behind the load enables of the registers it
// shows, so a slot whose x moved looks up its x digits again and nothing else. One variable per
// value, bound by every layer that shows it (the Layers panel, the canvas label, the Design panel
// and the size tag all show the same id digits).
import type { Line, Num, SlotLines } from "../cpu/disp";
import { KINDS } from "../cpu/disp";

/** PICO-8, os-ui's palette (model.ts PALETTE). */
export const PALETTE = [
  "#000000",
  "#1d2b53",
  "#7e2553",
  "#008751",
  "#ab5236",
  "#5f574f",
  "#c2c3c7",
  "#fff1e8",
  "#ff004d",
  "#ffa300",
  "#ffec27",
  "#00e436",
  "#29adff",
  "#83769c",
  "#ff77a8",
  "#ffccaa",
];
/** A layer's name is its kind's label and its id (os-ui model.ts LABEL), by kind (tool) code. */
export const KIND_LABEL: Record<number, string> = {
  3: "Frame",
  4: "Section",
  5: "Slice",
  6: "Rectangle",
  7: "Line",
  8: "Arrow",
  9: "Ellipse",
  10: "Polygon",
  11: "Star",
};

export type RomValue =
  string | number | { r: number; g: number; b: number; a: number };

export interface RomTable {
  /** Variable name. */
  name: string;
  type: "STRING" | "FLOAT" | "COLOR";
  /** The slot fields whose registers, when one loads, look this table up again. */
  fields: string[];
  /** Each case: every line in `when` has the given value. Cases never overlap. */
  cases: Array<{ when: Array<[Line, boolean]>; value: RomValue }>;
}

export const romName = (slot: number, key: string) => `ui/L${slot}/${key}`;

const rgb = (hex: string, a = 1) => {
  const n = parseInt(hex.slice(1), 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
    a,
  };
};

/** A digit's glyph by its four BCD bits; a constant bit decides cases without a condition. */
function digitCases(d: Num["digits"][number]): RomTable["cases"] {
  const out: RomTable["cases"] = [];
  for (let v = 0; v <= 9; v++) {
    const when: Array<[Line, boolean]> = [];
    let possible = true;
    d.bits.forEach((b, i) => {
      const want = ((v >> i) & 1) === 1;
      if ("k" in b) possible &&= (b.k === 1) === want;
      else when.push([b, want]);
    });
    if (possible) out.push({ when, value: String(v) });
  }
  return out;
}

const hot = (
  lines: Line[],
  value: (k: number) => RomValue,
): RomTable["cases"] =>
  lines.map((l, k) => ({ when: [[l, true]], value: value(k) }));

/** Every look-up table of slot `i`. */
export function slotRom(s: SlotLines, i: number): RomTable[] {
  const out: RomTable[] = [];
  const digits = (field: "x" | "y" | "w" | "h" | "id", n: Num) =>
    n.digits.forEach((d, k) =>
      out.push({
        name: romName(i, `${field}/d${k}`),
        type: "STRING",
        fields: [field],
        cases: digitCases(d),
      }),
    );
  digits("x", s.x);
  digits("y", s.y);
  digits("w", s.w);
  digits("h", s.h);
  digits("id", s.id);
  out.push({
    name: romName(i, "kind"),
    type: "STRING",
    fields: ["kind"],
    cases: KINDS.map((k) => ({
      when: [[s.kind[k], true]],
      value: KIND_LABEL[k],
    })),
  });
  out.push({
    name: romName(i, "fill/hex"),
    type: "STRING",
    fields: ["fill"],
    cases: hot(s.fill, (k) => PALETTE[k].slice(1).toUpperCase()),
  });
  out.push({
    name: romName(i, "fill/colour"),
    type: "COLOR",
    fields: ["fill"],
    cases: hot(s.fill, (k) => rgb(PALETTE[k])),
  });
  out.push({
    name: romName(i, "stroke/hex"),
    type: "STRING",
    fields: ["stroke"],
    cases: hot(s.stroke, (k) => PALETTE[k].slice(1).toUpperCase()),
  });
  out.push({
    name: romName(i, "stroke/colour"),
    type: "COLOR",
    fields: ["stroke"],
    cases: hot(s.stroke, (k) => rgb(PALETTE[k])),
  });
  // a line or arrow is drawn in its stroke colour when it has one, else in its fill
  out.push({
    name: romName(i, "line/colour"),
    type: "COLOR",
    fields: ["fill", "stroke"],
    cases: [
      ...s.fill.map((l, k) => ({
        when: [
          [s.strokeNone, true],
          [l, true],
        ] as Array<[Line, boolean]>,
        value: rgb(PALETTE[k]),
      })),
      ...hot(s.stroke, (k) => rgb(PALETTE[k])),
    ],
  });
  out.push({
    name: romName(i, "opacity/text"),
    type: "STRING",
    fields: ["opacity"],
    cases: hot(s.opacity, (k) => `${k * 10}%`),
  });
  out.push({
    name: romName(i, "opacity"),
    type: "FLOAT",
    fields: ["opacity"],
    // Figma reads a number bound to a layer's opacity as a percentage
    cases: hot(s.opacity, (k) => k * 10),
  });
  out.push({
    name: romName(i, "radius/text"),
    type: "STRING",
    fields: ["radius"],
    cases: hot(s.radius, (k) => String(k)),
  });
  // a hidden layer's row is faded (styles.css .row.hidden)
  out.push({
    name: romName(i, "row/opacity"),
    type: "FLOAT",
    fields: ["vis"],
    cases: [
      { when: [[s.vis, true]], value: 100 },
      { when: [[s.vis, false]], value: 45 },
    ],
  });
  // a quarter cell per step (view.ts glyph: radius × CELL / 4)
  out.push({
    name: romName(i, "radius"),
    type: "FLOAT",
    fields: ["radius"],
    cases: hot(s.radius, (k) => k * 12),
  });
  return out;
}

/** A table's value for line values (null when no case holds: a slot that was never drawn). */
export function romValue(
  t: RomTable,
  line: (l: Line) => boolean,
): RomValue | null {
  for (const c of t.cases)
    if (c.when.every(([l, v]) => line(l) === v)) return c.value;
  return null;
}
