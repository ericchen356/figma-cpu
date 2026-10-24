// Constants the flow shares with os-ui, plus the encoding of its enums as numbers. A Figma
// variable is a boolean, a number or a string, so tools and kinds become their index in TOOLS.
import {
  GRID_H,
  GRID_W,
  MAX_LAYERS,
  PALETTE,
  TOOL_KEYS,
  type Corner,
  type Tool,
} from "../../os-ui/src/model";

export { GRID_H, GRID_W, MAX_LAYERS, PALETTE, TOOL_KEYS };
export type { Corner, Tool };

/** Order of the Tool union in os-ui/src/model.ts. A kind's code is its tool's code. */
export const TOOLS: readonly Tool[] = [
  "move",
  "hand",
  "scale",
  "frame",
  "section",
  "slice",
  "rect",
  "line",
  "arrow",
  "ellipse",
  "polygon",
  "star",
  "pen",
  "paint",
  "erase",
  "text",
  "comment",
];
export const toolCode = (t: Tool): number => {
  const i = TOOLS.indexOf(t);
  if (i < 0) throw new Error(`unknown tool ${t}`);
  return i;
};

/** Tools that create a layer by dragging out its box (DRAG_TO_CREATE in the reducer). */
export const CREATE_TOOLS: readonly Tool[] = [
  "frame",
  "section",
  "slice",
  "rect",
  "line",
  "arrow",
  "ellipse",
  "polygon",
  "star",
];
/** Tools whose click selects and drags what is under the pointer. */
export const SELECT_TOOLS: readonly Tool[] = ["move", "scale"];
/** Tools the flow does not implement yet (they need a paint grid, a pen path or typed text). */
export const UNSUPPORTED_TOOLS: readonly Tool[] = [
  "pen",
  "paint",
  "erase",
  "text",
  "comment",
];

export const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];
export const ALIGNS = [
  "left",
  "hcenter",
  "right",
  "top",
  "vcenter",
  "bottom",
] as const;

/** One layer slot. Geometry is in px (cells × K) so that a Figma node's width, height and
 * padding can bind to it directly; the other numbers keep the reducer's units. */
export const NUM_FIELDS = [
  "id",
  "kind",
  "x",
  "y",
  "w",
  "h",
  "fill",
  "opacity",
  "radius",
  "stroke",
  "rot",
  "rr",
] as const;
export const BOOL_FIELDS = ["vis", "shadow", "flip"] as const;
export const FIELDS: readonly string[] = [...NUM_FIELDS, ...BOOL_FIELDS];
export const FIELD_INIT: Record<string, number | boolean> = {
  opacity: 10,
  stroke: -1,
};

/** `rr` (rendered corner radius) of an ellipse: Figma clamps a radius to half the smaller side. */
export const ELLIPSE_RR = 9999;

/** Default pixels per cell on the Figma canvas. */
export const DEFAULT_K = 40;
