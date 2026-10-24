// The contract between the hardware, the reaction compiler, the UI builder and the tests:
// event codes, the layer record layout and the names of the nets the screen is wired to.

/** Event codes on the EVT input (4 bits). One clock tick is one editor event. */
export const EV = {
  NOP: 0,
  TOOL: 1, // ARG = tool (0 move, 1 frame, 2 rectangle, 3 ellipse)
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
  CLICK: 15, // a canvas click: DOWN when nothing is pending, MOVE then UP while a drag is pending
} as const;
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

/** Tool codes (= the kind a creation tool makes: 1 frame, 2 rectangle, 3 ellipse). */
export const TOOL = { move: 0, frame: 1, rect: 2, ellipse: 3 } as const;
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
} as const;

/** Net names of the screen: what the UI frame's layers are bound to. All are top-level wires. */
export const SCREEN_NETS = {
  show: "show", // [8] used·vis
  selk: "selk", // [8] selected
  nx1: "nx1", // [32] ¬x1 bits, layer-major
  ny1: "ny1", // [32] ¬y1 bits
  kfr: "kfr", // [8] kind = frame
  kre: "kre", // [8] kind = rectangle
  kel: "kel", // [8] kind = ellipse
  fill1h: "fill1h", // [128] one-hot colour of each layer, layer-major
  cur1h: "cur1h", // [16] one-hot current colour
  tool1h: "tool1h", // [4]
  hot: "hot", // [4] hotspot sets: idle+move tool, idle+creation tool, drag=move, drag=create/resize
} as const;

/** Hotspot sets (UI layers that receive canvas clicks), in `hot` bit order. */
export const HOT = [
  "idle-move",
  "idle-create",
  "drag-move",
  "drag-span",
] as const;

/** Power-on value of the current fill (the editor model starts on PALETTE[12]). */
export const INITIAL_FILL = 12;
