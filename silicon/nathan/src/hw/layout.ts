// The contract between the hardware, the reaction compiler, the UI builder and the tests:
// event codes, the layer record layout and the names of the nets the screen is wired to.

/** Event codes on the EVT input (5 bits since the pen: codes 0–15 are the editor's, 16–18 the
 * pen's). One clock tick is one editor event. */
export const EV = {
  NOP: 0,
  TOOL: 1, // ARG = tool (0 move, 1 frame, 2 rectangle, 3 ellipse, 4 pen)
  FILL: 2, // ARG = palette index
  DOWN: 3,
  MOVE: 4,
  UP: 5,
  SELECT: 6, // ARG = layer slot
  HANDLE: 7, // ARG bit0 = west handle, bit1 = north handle
  VIS: 8, // ARG = layer slot (eye icon)
  DELETE: 9,
  DUP: 10,
  FWD: 11, // "]" bring forward
  BACK: 12, // "[" send backward
  NUDGE: 13, // ARG = 0 left, 1 right, 2 up, 3 down
  ESC: 14,
  CLICK: 15, // a canvas click: DOWN when nothing is pending, MOVE then UP while a drag is pending;
  //            with the pen and nothing pending: ink the cell and put the pen down / lift it
  PAINT: 16, // the pointer entered cell (PX, PY): inked while the pen is down
  ERASE: 17, // the Erase toggle: the pen inks 0 instead of 1
  CLEAR: 18, // every pixel of the paint plane to 0, in one event
} as const;
export const EVT_BITS = 5;
export type EventName = keyof typeof EV;

export const LAYERS = 8;
export const PALETTE_SIZE = 16;

/** One layer record, 24 bits, in this order (geometry is contiguous: x0 x1 y0 y1). */
export const REC = {
  used: 0,
  vis: 1,
  kind: 2,
  x0: 4,
  x1: 8,
  y0: 12,
  y1: 16,
  fill: 20,
  bits: 24,
  geom: 4,
  geomBits: 16,
} as const;

/** Tool codes (= the kind a creation tool makes: 1 frame, 2 rectangle, 3 ellipse; 4 the pen,
 * which draws on the paint plane instead). The tool register is 3 bits. */
export const TOOL = { move: 0, frame: 1, rect: 2, ellipse: 3, pen: 4 } as const;
export const TOOL_BITS = 3;
/** Drag modes (the DRAG register). */
export const DRAG = { none: 0, move: 1, create: 2, resize: 3 } as const;

/** Net names of the architectural state (flip-flop outputs), as top-level wires of ENGINE. */
export const STATE_NETS = {
  used: (k: number) => `used${k}`,
  vis: (k: number) => `vis${k}`,
  kind: (k: number) => `kind${k}`,
  x0: (k: number) => `x0_${k}`,
  x1: (k: number) => `x1_${k}`,
  y0: (k: number) => `y0_${k}`,
  y1: (k: number) => `y1_${k}`,
  fill: (k: number) => `fill${k}`,
  sel: "sel",
  hassel: "hassel",
  tool: "tool",
  cur: "cur",
  drag: "drag",
  r1: "r1",
  r2: "r2",
  pendown: "pendown", // the pen is down: hovering a cell inks it
  erase: "erase", // the pen inks 0
  pix: "pix", // [140] the paint plane, pixel (x, y) = bit y·14 + x
} as const;

/** Net names of the screen besides the registers: what else the UI frame's layers are bound to.
 * Most of the screen is bound to register bits directly (positions, sizes, visibility); a value
 * that picks one of several layers (a colour, a kind, the selected layer) needs each bit and its
 * inverse, one level of frames per bit. All are top-level wires. */
export const SCREEN_NETS = {
  nsel: "nsel", // [3] ¬sel
  nkind: "nkind", // [16] ¬kind bits, layer-major
  nfill: "nfill", // [32] ¬fill bits, layer-major
  ncur: "ncur", // [4] ¬cur
  ell: "ell", // [8] kind = ellipse: the layer's body is round
  nell: "nell", // [8] ¬ell
  hot: "hot", // [6] hotspot sets: idle+move tool, idle+creation tool, drag=move, drag=create/resize, pen up, pen down
} as const;

/** Hotspot sets (UI layers that receive canvas clicks), in `hot` bit order. */
export const HOT = [
  "idle-move",
  "idle-create",
  "drag-move",
  "drag-span",
  "pen-up",
  "pen-down",
] as const;

/** Power-on value of the current fill (the editor model starts on PALETTE[12]). */
export const INITIAL_FILL = 12;
