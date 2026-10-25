// FigmaCPU Flowchart: draws a board that explains CPU NATHAN on the current page, left of what is
// already there. Two boards, one command each:
//   build       the demo board: a title, four numbers and four short panels, sized like a slide
//   build-full  the full board: nine sections, every block of the machine, the limits, the tests
// A build only adds a board; it never removes or changes anything already on the page.
//
// Each board is data (DEMO / sections() below): panels, each a grid of cards plus the arrows between
// them. The render code sizes the cards (cards in a grid row share one height), routes the arrows
// orthogonally between card edges, and draws small illustrations where a card has art. Gate counts
// come from the measured netlist (silicon/nathan, 2026-10-24) and silicon/nathan/README.md; the
// variable and screen counts are read from the file. Nothing here runs when the file is used.

const NAME_DEMO = "FigmaCPU · how it works (demo)";
const NAME_FULL = "FigmaCPU · how it works";
const W = 7400; // board width
const PAD = 200; // board padding
const IW = W - 2 * PAD; // section width
const LOG = "http://localhost:8823/"; // dev log server (devAllowedDomains); unused when not running

const C = {
  paper: "#F3F1EC",
  white: "#FFFFFF",
  ink: "#16151A",
  body: "#3B3944",
  muted: "#6B6875",
  line: "#57545F",
  rule: "#E4E0D8",
  panel: "#1E1E1E",
  code: "#0F172A",
};

/** Where a thing lives / what it is: one colour family each. */
const K = {
  code: {
    label: "TypeScript · build time",
    dark: "#1D4ED8",
    mid: "#93C5FD",
    light: "#EFF6FF",
  },
  figma: {
    label: "Figma file · run time",
    dark: "#6D28D9",
    mid: "#C4B5FD",
    light: "#F5F3FF",
  },
  hw: { label: "Gates", dark: "#047857", mid: "#6EE7B7", light: "#ECFDF5" },
  screen: {
    label: "Screen",
    dark: "#B45309",
    mid: "#FCD34D",
    light: "#FFFBEB",
  },
  limit: {
    label: "Figma limit · measured",
    dark: "#BE123C",
    mid: "#FDA4AF",
    light: "#FFF1F2",
  },
  test: {
    label: "Verification",
    dark: "#0E7490",
    mid: "#67E8F9",
    light: "#ECFEFF",
  },
  user: {
    label: "You, in ▶ Present",
    dark: "#334155",
    mid: "#CBD5E1",
    light: "#F8FAFC",
  },
};

const PICO = {
  red: "#FF004D",
  orange: "#FFA300",
  blue: "#29ADFF",
  green: "#00E436",
  yellow: "#FFEC27",
};

/** Type and spacing of each board: the demo one is read from across a room. */
const STYLE = {
  full: {
    sp: 110,
    cardTitle: 38,
    titleLh: 118,
    cardBody: 26,
    bodyLh: 145,
    boldFont: "semi",
    chip: 19,
    stat: 24,
    badge: [52, 26],
    padTop: 34,
    padBottom: 38,
    padSide: 40,
    radius: 26,
    stroke: 3,
    cardGap: 16,
    label: 21,
    labelPad: [16, 7],
    arrowW: 4,
    head: 26,
    secBadge: [116, 58],
    secTitle: 76,
    link: 23,
  },
  demo: {
    sp: 120,
    cardTitle: 50,
    titleLh: 115,
    cardBody: 34,
    bodyLh: 140,
    boldFont: "bold",
    chip: 22,
    stat: 28,
    badge: [60, 30],
    padTop: 40,
    padBottom: 46,
    padSide: 48,
    radius: 32,
    stroke: 4,
    cardGap: 18,
    label: 28,
    labelPad: [20, 9],
    arrowW: 6,
    head: 34,
    secBadge: [110, 56],
    secTitle: 84,
    link: 30,
  },
};

// ---------- the demo board ----------

const DEMO = {
  built: {
    title: "How we built it",
    cols: 5,
    gap: 250,
    nodes: [
      {
        id: "b1",
        step: 1,
        kind: "code",
        col: 0,
        row: 0,
        title: "Figma in TypeScript",
        body: "Our working Figma editor, os-ui, is the spec.",
      },
      {
        id: "b2",
        step: 2,
        kind: "hw",
        col: 1,
        row: 0,
        title: "Redesigned as logic gates",
        body: "5,636 AND / OR / NOT gates in 51 modules. Even the memory is gates.",
      },
      {
        id: "b3",
        step: 3,
        kind: "code",
        col: 2,
        row: 0,
        title: "Compiled, one click at a time",
        body: "Each button, key and canvas cell gets its own short list of gate steps.",
      },
      {
        id: "b4",
        step: 4,
        kind: "figma",
        col: 3,
        row: 0,
        title: "Written into this file",
        body: "wire → variable\ngate → action\nlamp → layer",
      },
      {
        id: "b5",
        step: 5,
        kind: "user",
        col: 4,
        row: 0,
        title: "▶ Present runs it",
        body: "Figma's own prototype engine computes every gate. No plugin, no code.",
      },
    ],
    edges: [
      { from: "b1", to: "b2", label: "spec" },
      { from: "b2", to: "b3", label: "compile" },
      { from: "b3", to: "b4", label: "build once" },
      { from: "b4", to: "b5", label: "play" },
    ],
  },
  click: {
    title: "One click = one clock tick",
    cols: 2,
    gap: 260,
    rowGap: 200,
    nodes: [
      {
        id: "k1",
        step: 1,
        kind: "user",
        col: 0,
        row: 0,
        title: "You click",
        body: "a canvas cell, a tool or a key",
      },
      {
        id: "k2",
        step: 2,
        kind: "figma",
        col: 1,
        row: 0,
        title: "Its reaction runs",
        body: "at most 700 gate actions, all in one go",
      },
      {
        id: "k3",
        step: 3,
        kind: "hw",
        col: 1,
        row: 1,
        title: "Wires change",
        body: "registers latch the new state",
      },
      {
        id: "k4",
        step: 4,
        kind: "screen",
        col: 0,
        row: 1,
        title: "The screen redraws",
        body: "every layer on it is bound to a wire",
      },
    ],
    edges: [
      { from: "k1", to: "k2" },
      { from: "k2", to: "k3" },
      { from: "k3", to: "k4" },
      { from: "k4", to: "k1", label: "next click" },
    ],
  },
  inside: {
    title: "Inside the CPU",
    cols: 3,
    gap: 200,
    rowGap: 200,
    nodes: [
      {
        id: "i1",
        kind: "user",
        col: 0,
        row: 0,
        chip: "input",
        title: "Click or key",
        body: "the event's code and the pointer's cell",
      },
      {
        id: "i2",
        kind: "hw",
        col: 1,
        row: 0,
        stat: "648 gates",
        title: "Decode & decide",
        body: "what is this event allowed to do?",
      },
      {
        id: "i3",
        kind: "hw",
        col: 2,
        row: 0,
        stat: "1,831 gates",
        title: "Find & move",
        body: "hit-test all 8 layers at once; move, resize, nudge",
      },
      {
        id: "i4",
        kind: "hw",
        col: 2,
        row: 1,
        stat: "2,272 gates",
        title: "Layer memory",
        body: "8 layers × 24 bits, held in latches",
      },
      {
        id: "i5",
        kind: "screen",
        col: 1,
        row: 1,
        stat: "83 gates",
        title: "Screen",
        body: "83 display gates and 17,592 bound layers",
      },
      {
        id: "i6",
        kind: "hw",
        col: 0,
        row: 1,
        stat: "792 gates",
        title: "Pen RAM",
        body: "a 14 × 10 one-bit bitmap",
      },
    ],
    edges: [
      { from: "i1", to: "i2" },
      { from: "i2", to: "i3" },
      { from: "i3", to: "i4", label: "new layer data" },
      { from: "i4", to: "i5" },
      { from: "i6", to: "i5" },
      { from: "i2", to: "i6", vertical: true, fromAt: 0.2, label: "pen" },
    ],
  },
  limits: {
    title: "Making Figma run a CPU",
    cols: 4,
    gap: 120,
    nodes: [
      {
        id: "l1",
        kind: "limit",
        chip: "Figma limit",
        col: 0,
        row: 0,
        title: "Over ~1,000 actions, a click crashes the viewer",
        body: "**Fix:** every click is compiled down to at most 700. The longest is 591.",
      },
      {
        id: "l2",
        kind: "limit",
        chip: "Figma limit",
        col: 1,
        row: 0,
        title: "No functions, no arrays, one-level ifs",
        body: "**Fix:** a separate reaction for each canvas row, cell and selected layer.",
      },
      {
        id: "l3",
        kind: "limit",
        chip: "Figma limit",
        col: 2,
        row: 0,
        title: "Only visible layers get clicks",
        body: "**Fix:** the CPU's own wires decide which button is visible.",
      },
      {
        id: "l4",
        kind: "test",
        chip: "Verified",
        col: 3,
        row: 0,
        title: "And it matches the spec",
        body: "40 random sessions × 120 events agree with the TypeScript editor, gate for gate.",
      },
    ],
    edges: [],
  },
};

/** Rows of demo panels, top to bottom; panels in one row share its width equally and its height. */
const DEMO_LAYOUT = [["built"], ["click", "inside"], ["limits"]];

const DEMO_TILES = (f) => [
  ["5,636", "logic gates", "hw"],
  [f.vars, "variables, one per wire", "figma"],
  ["761", "click reactions", "figma"],
  ["0", "lines of code running in ▶ Present", "user"],
];

// ---------- the full board ----------

function sections(f) {
  return [
    {
      title: "The big picture: from TypeScript to a machine Figma runs",
      sub: "We write and test everything in TypeScript, compile it down to logic gates, and a builder plugin writes the gates into this file once. After that, only Figma runs it.",
      cols: 6,
      gap: 230,
      rowTitles: {
        0: [
          "BUILD TIME",
          "TypeScript we wrote. It runs once, on a laptop, and then it's gone.",
          "code",
        ],
        1: [
          "RUN TIME",
          "Only Figma. No plugin, no server, none of our code.",
          "figma",
        ],
      },
      nodes: [
        {
          id: "osui",
          kind: "code",
          col: 0,
          row: 0,
          chip: "os-ui",
          title: "Figma, written in TypeScript",
          body: "A working Figma editor in the browser, written as a reducer: **state + action → new state**. Tools, layers, menus, shortcuts. Everything else has to match it.",
        },
        {
          id: "spec",
          kind: "code",
          col: 1,
          row: 0,
          chip: "reference.ts",
          title: "The part that fits on a chip",
          body: "A frozen subset of that editor: a **14 × 10-cell** canvas, **8 layers**, Move / Frame / Rectangle / Ellipse / Pen; select, move, resize, delete, duplicate, reorder, nudge, recolour, show/hide.",
        },
        {
          id: "hdl",
          kind: "hw",
          col: 2,
          row: 0,
          chip: "silicon HDL",
          title: "Circuits from 2-input gates only",
          body: "Hardware is described with `AND OR NAND NOR XOR XNOR NOT BUF` and nothing else. A latch, a register, an adder, a comparator: each is a circuit of those gates.",
        },
        {
          id: "engine",
          kind: "hw",
          col: 3,
          row: 0,
          chip: "ENGINE",
          stat: "5,636 gates",
          title: "CPU NATHAN",
          body: "51 modules wired into one machine and flattened to **5,636 gates** and **5,656 wires**. Its only job is to be the editor: one clock tick = one editor event.",
        },
        {
          id: "compiler",
          kind: "code",
          col: 4,
          row: 0,
          chip: "reaction compiler",
          title: "One reaction per control",
          body: "For every button, shortcut and canvas cell: tie the event's inputs, fold the constants through the gates, keep what can change, emit Figma actions. At most 700 per event.",
        },
        {
          id: "builder",
          kind: "code",
          col: 5,
          row: 0,
          chip: "builder plugin",
          title: "Build once, then close it",
          body: "**Build hardware** draws every gate (~40 s). **Build the OS** writes the variables, lamp bindings, reactions and frames (~5 min). **Self-test** replays random clicks against the spec.",
        },
        {
          id: "tests",
          kind: "test",
          col: 0,
          row: 1,
          span: 2,
          chip: "tests in Node",
          title: "Checked before it ever reaches Figma",
          body: "The gate machine runs against the spec on **40 random sessions × 120 events**: every register, pixel and screen line is compared after every event. Every reaction is checked against a full gate-level clock tick.",
        },
        {
          id: "you",
          kind: "user",
          col: 2,
          row: 1,
          chip: "you",
          title: "Click, draw, press keys",
          body: "In ▶ Present, on the frame **NATHAN · Figma OS**. Every click or key press is one event for the machine.",
        },
        {
          id: "react",
          kind: "figma",
          col: 3,
          row: 1,
          chip: "stored reaction",
          title: "Figma runs the gate actions",
          body: "The click's reaction is a list of `SET_VARIABLE` actions, one per live gate, like `wire = AND(a, b)`. Figma's prototype engine evaluates them in order.",
        },
        {
          id: "vars",
          kind: "figma",
          col: 4,
          row: 1,
          chip: "variables",
          stat: f.vars,
          title: "Every wire is a variable",
          body: "BOOLEAN variables in the collections NATHAN, NATHAN · 2 and NATHAN · UI. Registers keep their value between clicks, so the machine remembers.",
        },
        {
          id: "layers",
          kind: "screen",
          col: 5,
          row: 1,
          chip: "bound layers",
          stat: "17,592",
          title: "The screen follows the wires",
          body: "Rectangles, colours, the selection and every gate's lamp are layers bound to variables. When a wire flips, Figma redraws. No code.",
        },
      ],
      edges: [
        { from: "osui", to: "spec", label: "freeze a subset" },
        { from: "spec", to: "hdl", label: "design in gates" },
        { from: "hdl", to: "engine", label: "51 modules" },
        { from: "engine", to: "compiler", label: "flatten" },
        { from: "compiler", to: "builder", label: "761 reactions" },
        { from: "builder", to: "layers", label: "writes the file once" },
        { from: "you", to: "react", label: "click" },
        { from: "react", to: "vars", label: "sets" },
        { from: "vars", to: "layers", label: "bound to" },
        {
          from: "layers",
          to: "you",
          loop: "below",
          off: 110,
          label: "you see the result, and click again",
        },
        {
          from: "tests",
          to: "spec",
          dashed: true,
          color: K.test.dark,
          label: "the oracle",
        },
      ],
    },
    {
      title: "One click, step by step",
      sub: "What happens between your click and the screen changing. There is no clock running in the background: each click is exactly one tick of the machine.",
      cols: 8,
      gap: 110,
      nodes: [
        {
          id: "s1",
          step: 1,
          kind: "user",
          col: 0,
          row: 0,
          title: "You click a canvas cell",
          body: "…or press a key. Hovering the cell already stored its column (PX) in a variable, so the click knows where it is.",
        },
        {
          id: "s2",
          step: 2,
          kind: "screen",
          col: 1,
          row: 0,
          title: "The showing click layer takes it",
          body: "Six click layers cover the canvas: select, draw, drop, opposite corner, pen up, pen down. The machine's `hot` lines show exactly one. Hidden layers never get clicks or keys.",
        },
        {
          id: "s3",
          step: 3,
          kind: "figma",
          col: 2,
          row: 0,
          title: "Its reaction starts",
          body: "One trigger, one event, at most 700 actions; the longest of all 761 runs 591. It was compiled for this row, this tool and this state, so it is small.",
        },
        {
          id: "s4",
          step: 4,
          kind: "hw",
          col: 3,
          row: 0,
          title: "Inputs are constants",
          body: "EVT = the event code, PY = this row, PX copied from the hover. At build time, every gate those constants decide was folded away.",
        },
        {
          id: "s5",
          step: 5,
          kind: "hw",
          col: 4,
          row: 0,
          title: "LOW pass: compute",
          body: "One `SET_VARIABLE` per live gate, in dependency order: `n812 = AND(n77, n401)`. Registers that will load open their master latch.",
        },
        {
          id: "s6",
          step: 6,
          kind: "hw",
          col: 5,
          row: 0,
          title: "HIGH pass: commit",
          body: "`if (LOAD) { Q = D }` for each register: the 8 layer records, selection, tool, colour, drag, pen, and the 140 RAM pixels. The rest keep their value.",
        },
        {
          id: "s7",
          step: 7,
          kind: "screen",
          col: 6,
          row: 0,
          title: "Screen lines",
          body: "Only the display lines whose registers changed are recomputed, each behind `if (that register loaded)`. 83 display gates in total.",
        },
        {
          id: "s8",
          step: 8,
          kind: "screen",
          col: 7,
          row: 0,
          title: "Figma redraws itself",
          body: "Bound spacers move the rectangles, pick trees switch the colour, the outline jumps to the selection, and gate lamps light up.",
        },
      ],
      edges: [
        ...[1, 2, 3, 4, 5, 6, 7].map((i) => ({
          from: `s${i}`,
          to: `s${i + 1}`,
        })),
        {
          from: "s8",
          to: "s1",
          loop: "below",
          off: 100,
          label: "next click = next clock tick",
        },
      ],
    },
    {
      title: "Inside the machine: ENGINE, 5,636 gates in 13 blocks",
      sub: "The block diagram of CPU NATHAN. The number on each block is how many gates it has. Every block is a real component on this page: follow its ↗ link to see its circuit.",
      cols: 7,
      gap: 200,
      rowGap: 170,
      nodes: [
        {
          id: "in1",
          kind: "user",
          col: 0,
          row: 0,
          chip: "inputs",
          title: "EVT · ARG",
          body: "**EVT** (5 bits): which event, 0–18. **ARG** (4 bits): its argument: the tool, the colour, the slot or the arrow.",
        },
        {
          id: "in2",
          kind: "user",
          col: 0,
          row: 1,
          chip: "inputs",
          title: "PX · PY · CLK",
          body: "The pointer's canvas cell: column 0–13 and row 0–9, 4 bits each. **CLK** is the clock: a LOW pass, then a HIGH pass.",
        },
        {
          id: "evdec",
          kind: "hw",
          col: 1,
          row: 0,
          chip: "EVDEC",
          stat: "61",
          title: "Event decoder",
          body: "One line per event (EV_DOWN, EV_DUP…), plus the tool and drag mode. A click becomes DOWN, or MOVE + UP while a drag is pending.",
          link: ["cell/EVDEC"],
        },
        {
          id: "hit",
          kind: "hw",
          col: 1,
          row: 1,
          chip: "HIT8",
          stat: "623",
          title: "Which layer is under the pointer?",
          body: "8 COVERS units test all 8 layers at once (x0 ≤ px < x1, y0 ≤ py < y1). The topmost hit wins. Reads all 8 records.",
          link: ["cell/HIT8"],
        },
        {
          id: "free",
          kind: "hw",
          col: 1,
          row: 2,
          chip: "FREESLOT",
          stat: "40",
          title: "First free slot",
          body: "The lowest unused layer slot for a new or duplicated layer, and whether any is left (8 at most).",
          link: ["cell/FREESLOT"],
        },
        {
          id: "pen",
          kind: "hw",
          col: 1,
          row: 3,
          chip: "PEN",
          stat: "26",
          title: "The pen",
          body: "Pen down or up, ink or erase, and **PLOT**: does this event ink the pixel under the pointer?",
          link: ["cell/PEN"],
        },
        {
          id: "conds",
          kind: "hw",
          col: 2,
          row: 0,
          chip: "CONDS",
          stat: "109",
          title: "What is allowed?",
          body: "What this event may do to the layer stack: create, duplicate, delete, reorder or move, only if there is a free slot, a selection, a neighbour…",
          link: ["cell/CONDS"],
        },
        {
          id: "plane",
          kind: "hw",
          col: 2,
          row: 1,
          chip: "READPLANE",
          stat: "387",
          title: "Read one record",
          body: "An 8-way multiplexer: the layer under the pointer on DOWN, otherwise the selected layer, as one 24-bit record.",
          link: ["cell/READPLANE"],
        },
        {
          id: "state",
          kind: "hw",
          col: 2,
          row: 2,
          chip: "STATE",
          stat: "264",
          title: "Editor state",
          body: "Registers for the selection, the tool (3 bits), the current colour, the pending drag and the grab offset or resize anchor.",
          link: ["cell/STATE"],
        },
        {
          id: "paint",
          kind: "hw",
          col: 2,
          row: 3,
          chip: "PAINT",
          stat: "766",
          title: "Paint plane: 140-bit RAM",
          body: "14 × 10 one-bit RAM words. Word line = PY, bit line = PX. Clear raises every line: 140 pixels erased in one event.",
          link: ["cell/PAINT"],
        },
        {
          id: "lctl",
          kind: "hw",
          col: 3,
          row: 0,
          chip: "LAYERCTL",
          stat: "124",
          title: "Write enables",
          body: "One enable per layer and field: load a new record, take a neighbour's (delete and reorder shift whole records), rectangle, fill, eye.",
          link: ["cell/LAYERCTL"],
        },
        {
          id: "geom",
          kind: "hw",
          col: 3,
          row: 1,
          chip: "GEOM",
          stat: "821",
          title: "Geometry units",
          body: "**MOVE** (264) drags with clamping, **SPAN** (100) makes a rectangle from two corners, **NUDGE** (229) steps one cell and stops at the edge.",
          link: ["cell/GEOM"],
        },
        {
          id: "newrec",
          kind: "hw",
          col: 3,
          row: 2,
          chip: "NEWREC",
          stat: "50",
          title: "New record",
          body: "What a new layer starts as: colour (a frame is white), kind = the tool, visible. A duplicate copies the selected record.",
          link: ["cell/NEWREC"],
        },
        {
          id: "layers",
          kind: "hw",
          col: 4,
          row: 0,
          rows: 3,
          chip: "LAYER × 8",
          stat: "2,272",
          title: "The layer file",
          body: "8 records of 24 bits held in registers, 284 gates each: **used · vis · kind · x0 · x1 · y0 · y1 · fill**.\nSlot order is stacking order, so delete and reorder shift whole records.\n↺ The records feed back into HIT8, READPLANE, FREESLOT and DISPLAY.",
          link: ["cell/LAYER"],
        },
        {
          id: "disp",
          kind: "hw",
          col: 5,
          row: 0,
          rows: 2,
          chip: "DISPLAY",
          stat: "83",
          title: "Screen decode",
          body: "The few lines the screen needs besides the register bits: inverted bits for the pick trees, round or square corners, and the `hot` lines that choose the click layer. (428 gates with one-hot decoders; 83 this way.)",
          link: ["cell/DISPLAY"],
        },
        {
          id: "screen",
          kind: "screen",
          col: 6,
          row: 0,
          rows: 4,
          chip: "screen",
          title: "NATHAN · Figma OS",
          body: "The editor you use in ▶ Present: toolbar, 14 × 10-cell canvas, layers panel, colours, Arrange buttons.\n1,387 of its layers are bound straight to wires and screen lines.",
          link: ["NATHAN · Figma OS"],
        },
        {
          id: "record",
          kind: "hw",
          col: 0,
          row: 4,
          span: 3,
          chip: "one layer record",
          title: "24 bits = one rectangle",
          art: { h: 250, draw: artRecord },
          body: "Example: a blue rectangle from cell (2, 1) to (6, 4). x1 and y1 are exclusive ends, so the width is x1 − x0 = 4 cells.",
        },
        {
          id: "mix",
          kind: "hw",
          col: 3,
          row: 4,
          span: 2,
          chip: "where the gates are",
          title: "5,636 gates, by block and by kind",
          art: { h: 420, draw: artBars },
        },
        {
          id: "codes",
          kind: "user",
          col: 5,
          row: 4,
          span: 2,
          chip: "EVT codes",
          title: "19 events, one tick each",
          body: "`0` nothing · `1` TOOL · `2` FILL · `3` DOWN · `4` MOVE · `5` UP · `6` SELECT · `7` HANDLE · `8` VIS (eye) · `9` DELETE · `10` DUPLICATE · `11` FORWARD `]` · `12` BACKWARD `[` · `13` NUDGE · `14` ESC · `15` CLICK · `16` PAINT (pen hover) · `17` ERASE · `18` CLEAR",
        },
      ],
      edges: [
        { from: "in1", to: "evdec", label: "event" },
        { from: "in2", to: "hit", label: "pointer" },
        { from: "evdec", to: "conds", label: "event lines" },
        { from: "hit", to: "conds", mid: 0.35, toAt: 0.62, label: "hit" },
        { from: "free", to: "conds", mid: 0.8, toAt: 0.86 },
        { from: "conds", to: "lctl", label: "go / no-go" },
        { from: "state", to: "plane", label: "selection" },
        { from: "plane", to: "geom", label: "record" },
        { from: "lctl", to: "layers", label: "enables" },
        { from: "geom", to: "layers", label: "rectangle" },
        { from: "newrec", to: "layers", label: "new record" },
        { from: "layers", to: "disp", label: "8 records" },
        { from: "disp", to: "screen", label: "screen lines" },
        { from: "pen", to: "paint", label: "PLOT · ink" },
        {
          from: "paint",
          to: "screen",
          label: "140 pixels, bound to the ink layer",
        },
      ],
    },
    {
      title: "Everything is gates: from one gate to a layer",
      sub: "No part of the machine is a black box. Memory, comparison and RAM are all small circuits of the same eight primitives, nested like components (because they are components).",
      cols: 5,
      gap: 170,
      nodes: [
        {
          id: "prims",
          kind: "hw",
          col: 0,
          row: 0,
          rows: 3,
          chip: "the 8 primitives",
          title: "The only parts we use",
          art: { h: 700, draw: artGallery },
          body: "NOT and BUF take one input, the rest two. In CPU NATHAN: **AND 3,093 · OR 1,797 · NOT 548 · XOR 160 · BUF 34 · NOR 4**.",
        },
        {
          id: "dlatch",
          kind: "hw",
          col: 1,
          row: 0,
          chip: "DLATCH",
          stat: "4 gates",
          title: "A latch: one bit of memory",
          art: {
            h: 230,
            draw: (a, w, h) => artComponent(a, w, h, "cell/DLATCH"),
          },
          body: "`Q = D·EN + Q·¬EN`. While EN is 1 it follows D; while EN is 0 it holds. The loop through Q is the memory.",
          link: ["cell/DLATCH"],
        },
        {
          id: "dffe",
          kind: "hw",
          col: 2,
          row: 0,
          chip: "DFFE",
          title: "A flip-flop with load enable",
          art: {
            h: 230,
            draw: (a, w, h) => artComponent(a, w, h, "cell/DFFE"),
          },
          body: "Two latches. The master is open while `¬CLK · LOAD`, the slave while `CLK`: the bit changes only on the rising edge, and only if LOAD = 1.",
          link: ["cell/DFFE"],
        },
        {
          id: "reg",
          kind: "hw",
          col: 3,
          row: 0,
          chip: "REGS",
          title: "A register",
          art: {
            h: 230,
            draw: (a, w, h) => artComponent(a, w, h, "cell/REGS4"),
          },
          body: "n flip-flops sharing LOAD and CLK. The tool register is 3 bits, the colour 4, one layer record 24.",
          link: ["cell/REGS4"],
        },
        {
          id: "rec",
          kind: "hw",
          col: 4,
          row: 0,
          chip: "LAYER",
          stat: "284 gates",
          title: "A layer record",
          body: "24 register bits plus the logic that picks what loads next: a new record, its upper or lower neighbour, a new rectangle, a colour or the eye.",
          link: ["cell/LAYER"],
        },
        {
          id: "ramw",
          kind: "hw",
          col: 1,
          row: 1,
          chip: "RAMW1",
          stat: "5 gates",
          title: "A RAM bit: a latch on its own",
          art: {
            h: 200,
            draw: (a, w, h) => artComponent(a, w, h, "cell/RAMW1"),
          },
          body: "No slave latch. Written in the LOW pass while its row and column lines are both on: `EN = ¬CLK · row · col`. 5 gates a pixel instead of 8.",
          link: ["cell/RAMW1"],
        },
        {
          id: "paintb",
          kind: "hw",
          col: 2,
          row: 1,
          chip: "PAINT",
          stat: "140 bits",
          title: "The bitmap",
          body: "10 rows of 14 RAM words. PY picks the word line and PX the bit line, two address bits decoded at a time.",
          link: ["cell/PAINT"],
        },
        {
          id: "clock",
          kind: "hw",
          col: 3,
          row: 1,
          span: 2,
          chip: "clock rules",
          title: "Why it never glitches",
          body: "One tick = **LOW pass, then HIGH pass**; state changes on the rising edge. Every feedback loop goes through a latch. LOAD and write enables come only from registers and logic, never from a loop, so evaluating gates in order always settles.",
        },
        {
          id: "ge4",
          kind: "hw",
          col: 1,
          row: 2,
          chip: "GE4",
          title: "Is A ≥ B? (4 bits)",
          art: { h: 200, draw: (a, w, h) => artComponent(a, w, h, "cell/GE4") },
          body: "The carry out of `A + ¬B + 1`: a 4-bit adder whose carry answers A ≥ B.",
          link: ["cell/GE4"],
        },
        {
          id: "covers",
          kind: "hw",
          col: 2,
          row: 2,
          chip: "COVERS",
          title: "Is the pointer in this layer?",
          body: "Four GE4 comparisons, px ≥ x0, px < x1, py ≥ y0, py < y1, ANDed with the layer's `used` bit.",
          link: ["cell/COVERS"],
        },
        {
          id: "hit8",
          kind: "hw",
          col: 3,
          row: 2,
          chip: "HIT8",
          stat: "623 gates",
          title: "The hit test",
          body: "Eight COVERS side by side, then a priority encoder: the highest slot (the topmost layer) wins.",
          link: ["cell/HIT8"],
        },
        {
          id: "mux",
          kind: "hw",
          col: 4,
          row: 2,
          chip: "MUX",
          title: "Choosing between inputs",
          body: "`Y = A·¬S + B·S`. READPLANE's 8-way read is the same idea: AND each record with its select line, OR the results.",
          link: ["cell/MUX2"],
        },
      ],
      edges: [
        { from: "prims", to: "dlatch", label: "4 gates" },
        { from: "dlatch", to: "dffe", label: "× 2" },
        { from: "dffe", to: "reg", label: "× n" },
        { from: "reg", to: "rec", label: "× 24" },
        { from: "dlatch", to: "ramw", label: "alone" },
        { from: "ramw", to: "paintb", label: "× 140" },
        { from: "prims", to: "ge4", label: "an adder" },
        { from: "ge4", to: "covers", label: "× 4" },
        { from: "covers", to: "hit8", label: "× 8" },
      ],
    },
    {
      title: "The screen has no code: it is bound to the wires",
      sub: "Figma can bind a layer's visibility to a variable. That one feature, used 17,592 times, is the whole display.",
      cols: 3,
      gap: 140,
      nodes: [
        {
          id: "sp",
          kind: "screen",
          col: 0,
          row: 0,
          title: "Spacers place every rectangle",
          art: { h: 420, draw: artSpacers },
          body: "A layer's box is an auto-layout frame. Spacer frames 1, 2, 4 and 8 cells wide are each visible only while their bit is 1. x0's spacers push the body right, y0's push it down, x1's and y1's give the size. Auto layout does the arithmetic.",
        },
        {
          id: "tree",
          kind: "screen",
          col: 1,
          row: 0,
          title: "Pick trees choose colours",
          art: { h: 420, draw: artTree },
          body: "A colour, a kind or the selection outline is one leaf of a tree of frames, one level per bit: child 0 shows on the inverted bit, child 1 on the bit. Exactly one leaf is visible. 16 colours = 4 levels.",
        },
        {
          id: "lamps",
          kind: "screen",
          col: 2,
          row: 0,
          title: "Every gate has a lamp",
          art: { h: 420, draw: artLamps },
          body: "A lamp is a layer whose visibility is bound to its gate's output: **10,541** on the drawn circuit and **5,636** on the gate map. Click, and the gates that computed light up.",
        },
        {
          id: "click",
          kind: "screen",
          col: 0,
          row: 1,
          title: "The machine routes its own clicks",
          art: { h: 380, draw: artStack },
          body: "Six click layers are stacked on the canvas; the `hot` lines show one. Duplicate, `[` and `]` have 8 stacked buttons and 8 key layers, one per selected slot, picked by the selection bits.",
        },
        {
          id: "ink",
          kind: "screen",
          col: 1,
          row: 1,
          title: "The pen's ink is RAM",
          art: { h: 380, draw: artInk },
          body: "140 cell-sized rectangles above the layers, each bound to its pixel's RAM bit. A stroke is the cells the pointer enters while the pen is down.",
        },
        {
          id: "bind",
          kind: "figma",
          col: 2,
          row: 1,
          chip: "what Figma stores",
          title: "A binding, not a program",
          body: "In the file, a lamp is just `visible ← n812`, a spacer `visible ← x0[2]`, a colour leaf `visible ← cur[3]` (or its inverse).\nWhen a reaction changes a variable, every layer bound to it updates. Nothing else is needed: **17,592 bindings** in all.",
        },
      ],
      edges: [],
    },
    {
      title: "Fitting a CPU inside Figma's prototype engine",
      sub: "Figma's prototypes were not made for this. We measured where they break, then shaped the machine and the compiler around each limit.",
      cols: 6,
      gap: 150,
      rowGap: 120,
      rowTitles: {
        0: [
          "MEASURED → BUILT",
          "Each rose card is a limit we measured in Figma desktop; the green card is the answer in CPU NATHAN.",
          "limit",
        ],
        5: [
          "HOW ONE REACTION IS COMPILED",
          "Six steps, run by the builder for each of the 761 controls.",
          "code",
        ],
      },
      nodes: [
        {
          id: "l1",
          kind: "limit",
          col: 0,
          row: 0,
          span: 2,
          title: "About 1,000 actions per event",
          body: "On a cold page, 1,000 actions in one event ran; 1,200 overflowed the viewer's stack and the prototype ignored every click until a reload. (Warm: 1,700 ran, 2,500 crashed.) Only executed actions count.",
        },
        {
          id: "a1",
          kind: "hw",
          col: 3,
          row: 0,
          span: 3,
          title: "Every control is one event of ≤ 700 actions",
          body: "The longest of the 761 reactions runs 591. A skipped `if` costs nothing: a 30,000-action reaction with all but two actions behind a false `if` ran fine.",
        },
        {
          id: "l2",
          kind: "limit",
          col: 0,
          row: 1,
          span: 2,
          title: "One IF and one ELSE, never nested",
          body: "A CONDITIONAL keeps its first block and an ELSE; extra blocks are silently dropped, and a conditional inside another is rejected.",
        },
        {
          id: "a2",
          kind: "hw",
          col: 3,
          row: 1,
          span: 3,
          title: "One level deep: `if (LOAD) { … }`",
          body: "Logic that only one register reads moves inside that register's `if (LOAD)`, where LOAD = 1 simplifies it. An idle register costs one action, or none.",
        },
        {
          id: "l3",
          kind: "limit",
          col: 0,
          row: 2,
          span: 2,
          title: "No functions, no arrays",
          body: 'A reaction can\'t say "the selected layer" or "this cell": every value has to be wired in.',
        },
        {
          id: "a3",
          kind: "hw",
          col: 3,
          row: 2,
          span: 3,
          title: "A reaction for each state",
          body: "One per canvas row (PY built in), one per cell for the pen and pick-up, one per selected slot for Duplicate, `[` and `]`. Duplicate went from 875 to 515 actions, Bring forward from 873 to 388.",
        },
        {
          id: "l4",
          kind: "limit",
          col: 0,
          row: 3,
          span: 2,
          title: "Only a showing layer takes a click or key",
          body: "Hidden layers never receive clicks or key presses; a key goes to the showing layer that listens for it.",
        },
        {
          id: "a4",
          kind: "hw",
          col: 3,
          row: 3,
          span: 3,
          title: "Dispatch by visibility",
          body: "Register bits pick which stacked click layer, button or key layer shows, exactly the way they pick a colour. The machine routes its own input.",
        },
        {
          id: "l5",
          kind: "limit",
          col: 0,
          row: 4,
          span: 2,
          title: "Big work doesn't fit one event",
          body: "A long reaction would blow the budget.",
        },
        {
          id: "a5",
          kind: "hw",
          col: 3,
          row: 4,
          span: 3,
          title: "Timed overlay chains, when needed",
          body: "The click runs part 1 and opens an invisible 1×1 overlay whose 1 ms timer runs the next part on a fresh stack. All register writes stay in the last part. At 700 actions, no CPU NATHAN control needs one.",
        },
        {
          id: "c1",
          step: 1,
          kind: "code",
          col: 0,
          row: 5,
          title: "Tie",
          body: "EVT = the event, ARG = the button's value, PY = the row, plus the tool and drag mode the clicked layer implies.",
        },
        {
          id: "c2",
          step: 2,
          kind: "code",
          col: 1,
          row: 5,
          title: "Fold",
          body: "Propagate 0, 1 and unknown through all 5,636 gates. Whole units become constants.",
        },
        {
          id: "c3",
          step: 3,
          kind: "code",
          col: 2,
          row: 5,
          title: "Wires and merges",
          body: "`AND(x, 1)`, `OR(x, 0)` and `BUF` become wires; two identical gates on the same inputs become one.",
        },
        {
          id: "c4",
          step: 4,
          kind: "code",
          col: 3,
          row: 5,
          title: "Keep the live cone",
          body: "Only gates that feed a register that can load in this event, plus the screen lines it changes.",
        },
        {
          id: "c5",
          step: 5,
          kind: "code",
          col: 4,
          row: 5,
          title: "Move into `if (LOAD)`",
          body: "Logic that one register alone reads goes inside its `if`, simplified there with LOAD = 1.",
        },
        {
          id: "c6",
          step: 6,
          kind: "code",
          col: 5,
          row: 5,
          title: "Emit",
          body: "Logic in dependency order, then the register commit, then the changed screen lines. One `SET_VARIABLE` per gate.",
        },
      ],
      edges: [
        ...[1, 2, 3, 4, 5].map((i) => ({
          from: `l${i}`,
          to: `a${i}`,
          color: K.limit.dark,
          label: "so",
        })),
        ...[1, 2, 3, 4, 5].map((i) => ({ from: `c${i}`, to: `c${i + 1}` })),
      ],
    },
    {
      title: "How we know it's right",
      sub: "The gates are checked against the TypeScript spec at every level, from single reactions to whole random sessions, before and after they reach Figma.",
      cols: 6,
      gap: 150,
      nodes: [
        {
          id: "v1",
          step: 1,
          kind: "test",
          col: 0,
          row: 0,
          title: "The spec is the oracle",
          body: "reference.ts: the editor as pure functions, no DOM. Every check below compares against it.",
        },
        {
          id: "v2",
          step: 2,
          kind: "test",
          col: 1,
          row: 0,
          title: "Gates vs spec",
          body: "40 random sessions × 120 events, pen sessions included: every register, pixel, screen line and the drawn picture, compared after every event.",
        },
        {
          id: "v3",
          step: 3,
          kind: "test",
          col: 2,
          row: 0,
          title: "Reaction vs full tick",
          body: "Every reaction against the full two-pass gate tick, on up to 140 sampled states where its control shows, in all four latch modes.",
        },
        {
          id: "v4",
          step: 4,
          kind: "test",
          col: 3,
          row: 0,
          title: "Builder vs a fake Figma",
          body: "The plugin runs end to end against a fake of Figma's Plugin API at 700 and 400 actions per event, then the stored reactions are replayed and compared.",
        },
        {
          id: "v5",
          step: 5,
          kind: "test",
          col: 4,
          row: 0,
          title: "Self-test inside the file",
          body: "The builder's Self-test drives 300 random user actions through the reactions stored in this file and compares registers, screen lines and layers with the spec.",
        },
        {
          id: "v6",
          step: 6,
          kind: "test",
          col: 5,
          row: 0,
          title: "By hand, in ▶ Present",
          body: "Tools by click and key, drawing, moving, resizing, recolouring, the layers panel, show/hide, Duplicate, Delete, `[` `]`, nudging, and the gate map lighting up live.",
        },
      ],
      edges: [1, 2, 3, 4, 5].map((i) => ({ from: `v${i}`, to: `v${i + 1}` })),
    },
    {
      title: "Try it yourself",
      sub: "Press ▶ Present in this file. The page holds about 200,000 layers, so give it up to a minute to load before the first click.",
      cols: 6,
      gap: 140,
      nodes: [
        {
          id: "t1",
          step: 1,
          kind: "user",
          col: 0,
          row: 0,
          title: "Open the flow",
          body: "▶ Present → flow **CPU NATHAN**. It opens the frame NATHAN · Figma OS.",
          link: ["NATHAN · Figma OS"],
        },
        {
          id: "t2",
          step: 2,
          kind: "user",
          col: 1,
          row: 0,
          title: "Pick a tool",
          body: "`V` move · `F` frame · `R` rectangle · `O` ellipse · `P` pen. Or click the toolbar.",
        },
        {
          id: "t3",
          step: 3,
          kind: "user",
          col: 2,
          row: 0,
          title: "Draw",
          body: "Click one cell, then the opposite corner. Two clicks, two clock ticks.",
        },
        {
          id: "t4",
          step: 4,
          kind: "user",
          col: 3,
          row: 0,
          title: "Edit",
          body: "Click a layer to pick it up, click again to drop it. Click a corner handle, then where the corner goes. Swatches recolour; the eye hides.",
        },
        {
          id: "t5",
          step: 5,
          kind: "user",
          col: 4,
          row: 0,
          title: "Keys",
          body: "`D` duplicate · `Delete` / `Backspace` · `]` forward · `[` backward · arrows nudge · `Esc`. With the pen: `E` erase, `C` clear.",
        },
        {
          id: "t6",
          step: 6,
          kind: "user",
          col: 5,
          row: 0,
          title: "Watch the machine",
          body: "The button **see the machine** shows all 5,636 gates as lamps: click and watch what lights. **the circuit** scrolls the full wiring, one button per module.",
          link: ["NATHAN · the machine", "NATHAN · the circuit"],
        },
        {
          id: "j1",
          kind: "figma",
          col: 0,
          row: 1,
          span: 2,
          chip: "on this page",
          title: "The running machine",
          body: "The three frames ▶ Present plays, and the circuit library: every block of the machine is a component.",
          link: [
            "NATHAN · Figma OS",
            "NATHAN · the machine",
            "NATHAN · the circuit",
            "cell/LAYER",
            "cell/HIT8",
            "cell/GEOM",
          ],
        },
        {
          id: "j2",
          kind: "figma",
          col: 2,
          row: 1,
          span: 2,
          chip: "page Figma OS",
          title: "os-ui's interface on gates",
          body: "The full os-ui interface, its menus and timed overlays, wired to gate-level logic synthesized from the editor's spec (osflow).",
          link: ["os-ui · live (gate-level CPU)"],
        },
        {
          id: "j3",
          kind: "figma",
          col: 4,
          row: 1,
          span: 2,
          chip: "page UI",
          title: `Every screen of os-ui (${f.uiScreens})`,
          body: "Captured 1:1 from the running TypeScript editor: every menu, tool, mode and dialog, as the reference the Figma builds are held to.",
          link: [
            "os-ui · Default",
            "os-ui · Main menu",
            "os-ui · Prototype tab",
          ],
        },
      ],
      edges: [1, 2, 3, 4, 5].map((i) => ({ from: `t${i}`, to: `t${i + 1}` })),
    },
    {
      title: "The whole project, and where this page fits",
      sub: "FigmaCPU is one idea at three sizes: an 8-bit CPU, a CPU that is a small Figma editor (this page), and all of os-ui compiled to gates.",
      cols: 5,
      gap: 180,
      nodes: [
        {
          id: "p_osui",
          kind: "code",
          col: 0,
          row: 0,
          chip: "os-ui",
          title: "Figma, rebuilt in TypeScript",
          body: "The spec for everything: a working Figma editor in the browser: toolbar, layers, properties, menus, ⌘K, Prototype, Present, Dev Mode.",
        },
        {
          id: "p_sil",
          kind: "hw",
          col: 0,
          row: 1,
          chip: "silicon",
          title: "The gate toolkit, and an 8-bit CPU",
          body: "HDL, a cell library of latches, adders and decoders, a netlist compiler and a prototype compiler. Its first machine is an 8-bit CPU that runs count, mul and fib in ▶ Present at about 95 ticks/s, in its own file.",
        },
        {
          id: "p_nat",
          kind: "hw",
          col: 2,
          row: 1,
          chip: "this page",
          title: "CPU NATHAN",
          body: "A machine built to be the editor: 5,636 gates, 761 reactions, one clock tick per click. What this board explains.",
        },
        {
          id: "p_flow",
          kind: "code",
          col: 2,
          row: 0,
          chip: "osflow",
          title: "All of os-ui, compiled to gates",
          body: "The whole editor reducer as a verified flow, synthesized automatically into 24,893 gates and checked register by register against os-ui.",
        },
        {
          id: "p_os",
          kind: "figma",
          col: 4,
          row: 0,
          chip: "page Figma OS",
          title: "os-ui's face on gates",
          body: "os-ui's interface, menus and overlays, driven by those synthesized gates in ▶ Present.",
          link: ["os-ui · live (gate-level CPU)"],
        },
        {
          id: "p_ui",
          kind: "screen",
          col: 4,
          row: 1,
          chip: "page UI",
          title: "The reference screens",
          body: `${f.uiScreens} screens captured 1:1 from os-ui: what every Figma build here is compared with.`,
          link: ["os-ui · Default"],
        },
      ],
      edges: [
        { from: "p_osui", to: "p_flow", label: "the whole reducer" },
        { from: "p_flow", to: "p_os", label: "drives" },
        {
          from: "p_osui",
          to: "p_nat",
          fromAt: 0.78,
          mid: 0.4,
          toAt: 0.3,
          label: "a frozen subset",
        },
        { from: "p_sil", to: "p_nat", label: "gates, cells, compilers" },
        { from: "p_nat", to: "p_ui", dashed: true, label: "same look" },
      ],
    },
  ];
}

const FULL_TILES = (f) => [
  ["5,636", "logic gates: AND, OR, NOT, XOR…", "hw"],
  ["51", "circuit modules, each a component on this page", "hw"],
  [f.vars, "Figma variables, one per wire", "figma"],
  ["761", "stored reactions: one per button, key or canvas cell", "figma"],
  ["142,839", "gate actions stored in those reactions", "figma"],
  ["≤ 591", "actions run by any one click (safe limit ~700)", "limit"],
  ["17,592", "layers bound to wires: lamps, rectangles, colours", "screen"],
  ["0", "lines of our code running when you press ▶", "user"],
];

const GLOSSARY = [
  [
    "Gate",
    "A tiny logic rule on 1-bit wires, like `y = a AND b`. Here every gate becomes one Figma action.",
  ],
  [
    "Wire",
    "One Figma BOOLEAN variable. 5,656 of them carry the machine's signals and state.",
  ],
  [
    "Register",
    "Memory built from gates (latches). It keeps a value between clicks: the 8 layers, the tool, the colour…",
  ],
  [
    "Clock tick",
    "One step of the machine. Here, one click or one key press is exactly one tick.",
  ],
  [
    "Reaction",
    "What a Figma prototype runs on a click or key: a list of SET_VARIABLE actions. Ours evaluate the gates.",
  ],
  [
    "Lamp",
    "A layer whose visibility is bound to a wire: lit while the wire is 1.",
  ],
];

// ---------- fonts, colours, text ----------

const F = {};
async function loadFonts() {
  const want = [
    ["reg", "Inter", "Regular"],
    ["med", "Inter", "Medium"],
    ["semi", "Inter", "Semi Bold"],
    ["bold", "Inter", "Bold"],
    ["xbold", "Inter", "Extra Bold"],
    ["mono", "Roboto Mono", "Regular"],
    ["monoBold", "Roboto Mono", "Bold"],
  ];
  for (const [key, family, style] of want) {
    try {
      await figma.loadFontAsync({ family, style });
      F[key] = { family, style };
    } catch (e) {
      F[key] = key === "xbold" ? F.bold : key === "monoBold" ? F.semi : F.med;
    }
  }
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}
const solid = (hex, opacity = 1) => [
  { type: "SOLID", color: rgb(hex), opacity },
];
const plain = (s) => s.replace(/\*\*|`/g, "");
/** 5660 → "5,660" (the plugin sandbox has no Intl, so toLocaleString adds no commas). */
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** `**bold**` and `` `code` `` marks → plain text plus ranges. */
function marks(src) {
  let out = "";
  const runs = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("**", i)) {
      const j = src.indexOf("**", i + 2);
      if (j > i) {
        runs.push({ s: out.length, e: out.length + j - i - 2, t: "b" });
        out += src.slice(i + 2, j);
        i = j + 2;
        continue;
      }
    }
    if (src[i] === "`") {
      const j = src.indexOf("`", i + 1);
      if (j > i) {
        runs.push({ s: out.length, e: out.length + j - i - 1, t: "m" });
        out += src.slice(i + 1, j);
        i = j + 1;
        continue;
      }
    }
    out += src[i++];
  }
  return { out, runs };
}

function text(src, o = {}) {
  const t = figma.createText();
  const { out, runs } = marks(String(src));
  t.fontName = F[o.font || "reg"];
  t.characters = out;
  t.fontSize = o.size || 26;
  t.fills = solid(o.color || C.body);
  if (o.lh) t.lineHeight = { unit: "PERCENT", value: o.lh };
  if (o.ls != null) t.letterSpacing = { unit: "PERCENT", value: o.ls };
  for (const r of runs) {
    if (r.e <= r.s) continue;
    if (r.t === "b") t.setRangeFontName(r.s, r.e, F[o.boldFont || "semi"]);
    else {
      t.setRangeFontName(r.s, r.e, F.mono);
      t.setRangeFontSize(r.s, r.e, Math.round((o.size || 26) * 0.9));
      t.setRangeFills(r.s, r.e, solid(o.codeColor || C.code));
    }
  }
  if (o.upper) t.textCase = "UPPER";
  if (o.w) {
    t.resize(o.w, Math.max(1, t.height));
    t.textAutoResize = "HEIGHT";
  }
  return t;
}

/** Adds `child` to an auto-layout parent and lets it fill the parent's width. */
function fill(parent, child) {
  parent.appendChild(child);
  child.layoutSizingHorizontal = "FILL";
  if (child.type === "TEXT") child.textAutoResize = "HEIGHT";
  return child;
}

function box(dir, gap = 0) {
  const f = figma.createFrame();
  f.layoutMode = dir;
  f.primaryAxisSizingMode = "AUTO";
  f.counterAxisSizingMode = "AUTO";
  f.itemSpacing = gap;
  f.fills = [];
  f.clipsContent = false;
  return f;
}

/** A vertical auto-layout box `w` wide whose height hugs its children. */
function column(w, gap) {
  const f = box("VERTICAL", gap);
  f.resize(w, 10);
  f.counterAxisSizingMode = "FIXED";
  f.primaryAxisSizingMode = "AUTO";
  return f;
}

function rect(parent, x, y, w, h, color, o = {}) {
  const r = figma.createRectangle();
  parent.appendChild(r);
  r.x = x;
  r.y = y;
  r.resize(Math.max(0.01, w), Math.max(0.01, h));
  r.fills = color ? solid(color, o.opacity ?? 1) : [];
  if (o.stroke) {
    r.strokes = solid(o.stroke);
    r.strokeWeight = o.sw || 2;
    if (o.dash) r.dashPattern = o.dash;
  }
  if (o.radius) r.cornerRadius = o.radius;
  return r;
}

function put(parent, node, x, y) {
  parent.appendChild(node);
  node.x = Math.round(x);
  node.y = Math.round(y);
  return node;
}

function badge(label, color, size, fontSize) {
  const b = box("HORIZONTAL");
  b.primaryAxisSizingMode = "FIXED";
  b.counterAxisSizingMode = "FIXED";
  b.resize(size, size);
  b.cornerRadius = size / 2;
  b.primaryAxisAlignItems = "CENTER";
  b.counterAxisAlignItems = "CENTER";
  b.fills = solid(color);
  b.appendChild(
    text(String(label), { size: fontSize, font: "bold", color: C.white }),
  );
  return b;
}

// ---------- links ----------

const LINKS = {}; // name → top-level node, this page first, then the other pages
const COMPS = {}; // component name → component on this page

async function findTargets(page) {
  for (const n of page.children) {
    if (n.type === "COMPONENT") COMPS[n.name] = n;
    if (!(n.name in LINKS)) LINKS[n.name] = n;
  }
  for (const p of figma.root.children) {
    if (p === page) continue;
    await p.loadAsync();
    for (const n of p.children) if (!(n.name in LINKS)) LINKS[n.name] = n;
  }
}

function linkText(names, color, size) {
  const found = names.filter((n) => LINKS[n]);
  if (!found.length) return null;
  const t = text(found.map((n) => `↗ ${n}`).join("   "), {
    size,
    font: "semi",
    color,
    lh: 160,
  });
  let at = 0;
  for (const n of found) {
    const label = `↗ ${n}`;
    t.setRangeHyperlink(at, at + label.length, {
      type: "NODE",
      value: LINKS[n].id,
    });
    t.setRangeTextDecoration(at + 2, at + label.length, "UNDERLINE");
    at += label.length + 3;
  }
  return t;
}

// ---------- cards and panels ----------

function card(n, w, st) {
  const k = K[n.kind];
  const f = column(w, st.cardGap);
  f.name = plain(n.title);
  f.paddingTop = st.padTop;
  f.paddingBottom = st.padBottom;
  f.paddingLeft = f.paddingRight = st.padSide;
  f.cornerRadius = st.radius;
  f.fills = solid(k.light);
  f.strokes = solid(k.mid);
  f.strokeWeight = st.stroke;

  const head = box("HORIZONTAL", 14);
  head.counterAxisAlignItems = "CENTER";
  fill(f, head);
  head.primaryAxisAlignItems = "SPACE_BETWEEN";
  const left = box("HORIZONTAL", 16);
  left.counterAxisAlignItems = "CENTER";
  head.appendChild(left);
  if (n.step != null)
    left.appendChild(badge(n.step, k.dark, st.badge[0], st.badge[1]));
  left.appendChild(
    text(n.chip || k.label, {
      size: st.chip,
      font: "bold",
      color: k.dark,
      ls: 6,
      upper: true,
    }),
  );
  if (n.stat)
    head.appendChild(
      text(n.stat, { size: st.stat, font: "monoBold", color: k.dark }),
    );

  fill(
    f,
    text(n.title, {
      size: st.cardTitle,
      font: "bold",
      color: C.ink,
      lh: st.titleLh,
      ls: -1,
    }),
  );
  if (n.art) {
    const a = figma.createFrame();
    a.name = "illustration";
    a.fills = [];
    a.clipsContent = false;
    fill(f, a);
    a.resize(w - 2 * st.padSide, n.art.h);
    const used = n.art.draw(a, w - 2 * st.padSide, n.art.h);
    if (typeof used === "number") a.resize(w - 2 * st.padSide, used);
  }
  if (n.body)
    for (const para of n.body.split("\n"))
      fill(
        f,
        text(para, { size: st.cardBody, lh: st.bodyLh, boldFont: st.boldFont }),
      );
  if (n.link) {
    const t = linkText(n.link, k.dark, st.link);
    if (t) fill(f, t);
  }
  return f;
}

function sideAt(r, side, t) {
  if (side === "right") return [r.x + r.w, r.y + r.h * t];
  if (side === "left") return [r.x, r.y + r.h * t];
  if (side === "top") return [r.x + r.w * t, r.y];
  return [r.x + r.w * t, r.y + r.h];
}

/** Orthogonal route from card A to card B: straight when they face each other, else one elbow.
 * `loop` goes round below (or above) both; `vertical` leaves A's bottom or top even when B is to
 * the side; `fromAt` / `toAt` / `mid` place the ends and the elbow as fractions. */
function route(A, B, e) {
  if (e.loop) {
    const below = e.loop === "below";
    const y = below
      ? Math.max(A.y + A.h, B.y + B.h) + e.off
      : Math.min(A.y, B.y) - e.off;
    const p = sideAt(A, below ? "bottom" : "top", e.fromAt ?? 0.5);
    const q = sideAt(B, below ? "bottom" : "top", e.toAt ?? 0.5);
    return [p, [p[0], y], [q[0], y], q];
  }
  const right = B.x >= A.x + A.w - 1;
  const left = B.x + B.w <= A.x + 1;
  if ((right || left) && !e.vertical) {
    const x1 = right ? A.x + A.w : A.x;
    const x2 = right ? B.x : B.x + B.w;
    const lo = Math.max(A.y, B.y);
    const hi = Math.min(A.y + A.h, B.y + B.h);
    if (e.fromAt == null && e.toAt == null && hi - lo > 60) {
      const y = (lo + hi) / 2;
      return [
        [x1, y],
        [x2, y],
      ];
    }
    const y1 = e.fromAt != null ? A.y + A.h * e.fromAt : A.y + A.h / 2;
    const y2 = B.y + B.h * (e.toAt ?? 0.5);
    if (Math.abs(y1 - y2) < 1)
      return [
        [x1, y1],
        [x2, y2],
      ];
    const mx = x1 + (x2 - x1) * (e.mid ?? 0.5);
    return [
      [x1, y1],
      [mx, y1],
      [mx, y2],
      [x2, y2],
    ];
  }
  const down = B.y >= A.y + A.h - 1;
  const y1 = down ? A.y + A.h : A.y;
  const y2 = down ? B.y : B.y + B.h;
  const lo = Math.max(A.x, B.x);
  const hi = Math.min(A.x + A.w, B.x + B.w);
  if (e.fromAt == null && e.toAt == null && hi - lo > 60) {
    const x = (lo + hi) / 2;
    return [
      [x, y1],
      [x, y2],
    ];
  }
  const x1 = A.x + A.w * (e.fromAt ?? 0.5);
  const x2 = B.x + B.w * (e.toAt ?? 0.5);
  if (Math.abs(x1 - x2) < 1)
    return [
      [x1, y1],
      [x2, y2],
    ];
  const my = y1 + (y2 - y1) * (e.mid ?? 0.5);
  return [
    [x1, y1],
    [x1, my],
    [x2, my],
    [x2, y2],
  ];
}

function poly(parent, pts, color, weight, dashed) {
  const x0 = Math.min(...pts.map((p) => p[0]));
  const y0 = Math.min(...pts.map((p) => p[1]));
  const v = figma.createVector();
  parent.appendChild(v);
  v.vectorPaths = [
    {
      windingRule: "NONE",
      data: pts
        .map(
          (p, i) =>
            `${i ? "L" : "M"} ${Math.round(p[0] - x0)} ${Math.round(p[1] - y0)}`,
        )
        .join(" "),
    },
  ];
  v.x = Math.round(x0);
  v.y = Math.round(y0);
  v.fills = [];
  v.strokes = solid(color);
  v.strokeWeight = weight;
  v.strokeJoin = "ROUND";
  v.strokeCap = "ROUND";
  if (dashed) v.dashPattern = [18, 14];
  v.name = "arrow";
  return v;
}

function arrowhead(parent, x, y, ux, uy, size, color) {
  const bx = x - ux * size;
  const by = y - uy * size;
  const px = -uy * size * 0.48;
  const py = ux * size * 0.48;
  const pts = [
    [x, y],
    [bx + px, by + py],
    [bx - px, by - py],
  ];
  const x0 = Math.min(...pts.map((p) => p[0]));
  const y0 = Math.min(...pts.map((p) => p[1]));
  const v = figma.createVector();
  parent.appendChild(v);
  v.vectorPaths = [
    {
      windingRule: "NONZERO",
      data:
        pts
          .map(
            (p, i) =>
              `${i ? "L" : "M"} ${(p[0] - x0).toFixed(1)} ${(p[1] - y0).toFixed(1)}`,
          )
          .join(" ") + " Z",
    },
  ];
  v.x = x0;
  v.y = y0;
  v.fills = solid(color);
  v.strokes = [];
  v.name = "arrowhead";
  return v;
}

function pill(parent, label, cx, cy, color, st) {
  const p = box("HORIZONTAL");
  p.paddingLeft = p.paddingRight = st.labelPad[0];
  p.paddingTop = p.paddingBottom = st.labelPad[1];
  p.cornerRadius = 999;
  p.fills = solid(C.white);
  p.strokes = solid(color);
  p.strokeWeight = 2;
  p.name = `label · ${label}`;
  p.appendChild(text(label, { size: st.label, font: "med", color: C.body }));
  put(parent, p, cx - p.width / 2, cy - p.height / 2);
}

function arrow(parent, pts, e, st) {
  const color = e.color || C.line;
  const size = st.head;
  const n = pts.length;
  const [ax, ay] = pts[n - 2];
  const [bx, by] = pts[n - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const body = pts
    .slice(0, -1)
    .concat([[bx - ux * (size - 6), by - uy * (size - 6)]]);
  parent.insertChild(0, poly(parent, body, color, st.arrowW, e.dashed));
  arrowhead(parent, bx, by, ux, uy, size, color);
  if (!e.label) return;
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < n - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (l > bestLen) {
      bestLen = l;
      best = i;
    }
  }
  pill(
    parent,
    e.label,
    (pts[best][0] + pts[best + 1][0]) / 2,
    (pts[best][1] + pts[best + 1][1]) / 2,
    color,
    st,
  );
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Lays out a panel's cards in a grid inside `content` (`cw` wide); returns the height used. */
async function grid(content, s, cw, st) {
  const gap = s.gap ?? 160;
  const rowGap = s.rowGap ?? 190;
  const colW = (cw - gap * (s.cols - 1)) / s.cols;
  const cards = [];
  for (const n of s.nodes) {
    const span = n.span || 1;
    const c = card(n, Math.round(colW * span + gap * (span - 1)), st);
    content.appendChild(c);
    cards.push({ n, c });
    await tick();
  }
  const nrows = Math.max(...s.nodes.map((n) => n.row + (n.rows || 1)));
  const rowH = new Array(nrows).fill(0);
  for (const { n, c } of cards)
    if ((n.rows || 1) === 1) rowH[n.row] = Math.max(rowH[n.row], c.height);
  for (const { n, c } of cards) {
    const rows = n.rows || 1;
    if (rows === 1) continue;
    let have = rowGap * (rows - 1);
    for (let r = n.row; r < n.row + rows; r++) have += rowH[r];
    if (c.height > have) rowH[n.row + rows - 1] += c.height - have;
  }
  const titles = s.rowTitles || {};
  const rowY = [];
  let y = 0;
  for (let r = 0; r < nrows; r++) {
    if (titles[r]) {
      const [tag, line, kind] = titles[r];
      const row = box("HORIZONTAL", 22);
      row.counterAxisAlignItems = "CENTER";
      row.appendChild(
        text(tag, { size: 24, font: "bold", color: K[kind].dark, ls: 8 }),
      );
      row.appendChild(text(line, { size: 26, color: C.muted }));
      put(content, row, 0, y + (r ? 20 : 0));
      y += row.height + (r ? 60 : 40);
    }
    rowY[r] = y;
    y += rowH[r] + rowGap;
  }
  const R = {};
  for (const { n, c } of cards) {
    const rows = n.rows || 1;
    const h = rowY[n.row + rows - 1] + rowH[n.row + rows - 1] - rowY[n.row];
    c.primaryAxisSizingMode = "FIXED";
    c.resize(c.width, h);
    c.x = Math.round(n.col * (colW + gap));
    c.y = Math.round(rowY[n.row]);
    R[n.id] = { x: c.x, y: c.y, w: c.width, h };
  }
  let bottom = y - rowGap;
  for (const e of s.edges || []) {
    const pts = route(R[e.from], R[e.to], e);
    arrow(content, pts, e, st);
    bottom = Math.max(bottom, ...pts.map((p) => p[1] + 40));
  }
  return bottom;
}

const SHADOW = [
  {
    type: "DROP_SHADOW",
    color: { r: 0, g: 0, b: 0, a: 0.07 },
    offset: { x: 0, y: 14 },
    radius: 44,
    spread: 0,
    visible: true,
    blendMode: "NORMAL",
  },
];

/** One numbered panel `w` wide at (x, y) on the board. */
async function panel(board, x, y, w, s, i, st) {
  const sec = figma.createFrame();
  sec.name = `${i} · ${plain(s.title)}`;
  put(board, sec, x, y);
  sec.fills = solid(C.white);
  sec.cornerRadius = 44;
  sec.clipsContent = false;
  sec.effects = SHADOW;
  const cw = w - 2 * st.sp;
  const hdr = box("HORIZONTAL", 40);
  hdr.counterAxisAlignItems = "CENTER";
  hdr.appendChild(badge(i, C.ink, st.secBadge[0], st.secBadge[1]));
  const titles = box("VERTICAL", 12);
  hdr.appendChild(titles);
  titles.appendChild(
    text(s.title, { size: st.secTitle, font: "bold", color: C.ink, ls: -1.5 }),
  );
  if (s.sub)
    titles.appendChild(
      text(s.sub, { size: 34, color: C.muted, w: cw - 160, lh: 135 }),
    );
  put(sec, hdr, st.sp, st.sp);
  const top = st.sp + hdr.height + 90;
  const content = figma.createFrame();
  content.name = "content";
  content.fills = [];
  content.clipsContent = false;
  put(sec, content, st.sp, top);
  const h = await grid(content, s, cw, st);
  content.resize(cw, Math.max(1, h));
  sec.resize(w, top + h + st.sp);
  return sec;
}

function tileRow(parent, list, numSize, labelSize, gap) {
  const tiles = box("HORIZONTAL", gap);
  fill(parent, tiles);
  const tw = (IW - gap * (list.length - 1)) / list.length;
  for (const [num, label, kind] of list) {
    const k = K[kind];
    const t = column(tw, 10);
    t.paddingTop = t.paddingBottom = 36;
    t.paddingLeft = t.paddingRight = 40;
    t.cornerRadius = 30;
    t.fills = solid(C.white);
    t.strokes = solid(k.mid);
    t.strokeWeight = 3;
    tiles.appendChild(t);
    t.layoutSizingVertical = "FILL";
    fill(t, text(num, { size: numSize, font: "xbold", color: k.dark, ls: -2 }));
    fill(t, text(label, { size: labelSize, color: C.body, lh: 135 }));
  }
}

function headerFull(board, f) {
  const col = column(IW, 36);
  col.name = "header";
  put(board, col, PAD, PAD);
  col.appendChild(
    text("HOW IT WORKS · A MAP OF THE BUILD", {
      size: 30,
      font: "bold",
      color: K.figma.dark,
      ls: 10,
    }),
  );
  col.appendChild(
    text("FigmaCPU · CPU NATHAN", {
      size: 176,
      font: "xbold",
      color: C.ink,
      ls: -3,
    }),
  );
  col.appendChild(
    text(
      "A **5,636-gate computer** whose only program is a Figma editor, and **Figma's own prototype engine runs it**. No plugin and no code at run time: every wire is a variable, every gate is an action, every click is one clock tick.",
      { size: 48, color: C.body, w: 6000, lh: 138, boldFont: "bold" },
    ),
  );
  tileRow(col, FULL_TILES(f), 88, 26, 40);

  const legend = box("HORIZONTAL", 36);
  legend.counterAxisAlignItems = "CENTER";
  legend.appendChild(
    text("COLOURS", { size: 24, font: "bold", color: C.muted, ls: 8 }),
  );
  for (const k of Object.values(K)) {
    const chip = box("HORIZONTAL", 14);
    chip.counterAxisAlignItems = "CENTER";
    chip.paddingLeft = chip.paddingRight = 22;
    chip.paddingTop = chip.paddingBottom = 12;
    chip.cornerRadius = 999;
    chip.fills = solid(k.light);
    chip.strokes = solid(k.mid);
    chip.strokeWeight = 2;
    const dot = figma.createEllipse();
    dot.resize(20, 20);
    dot.fills = solid(k.dark);
    chip.appendChild(dot);
    chip.appendChild(text(k.label, { size: 26, font: "semi", color: k.dark }));
    legend.appendChild(chip);
  }
  col.appendChild(legend);

  const gl = box("HORIZONTAL", 40);
  fill(col, gl);
  const gw = (IW - 40 * 5) / 6;
  for (const [term, def] of GLOSSARY) {
    const g = column(gw, 10);
    g.paddingTop = g.paddingBottom = 28;
    g.paddingLeft = g.paddingRight = 30;
    g.cornerRadius = 24;
    g.fills = solid(C.white, 0.7);
    g.strokes = solid(C.rule);
    g.strokeWeight = 2;
    gl.appendChild(g);
    g.layoutSizingVertical = "FILL";
    fill(g, text(term, { size: 32, font: "bold", color: C.ink }));
    fill(g, text(def, { size: 24, color: C.body, lh: 140 }));
  }
  return col.height;
}

function headerDemo(board, f) {
  const col = column(IW, 44);
  col.name = "header";
  put(board, col, PAD, PAD);
  col.appendChild(
    text("HOW IT WORKS", {
      size: 34,
      font: "bold",
      color: K.figma.dark,
      ls: 12,
    }),
  );
  col.appendChild(
    text("FigmaCPU · CPU NATHAN", {
      size: 200,
      font: "xbold",
      color: C.ink,
      ls: -3,
    }),
  );
  col.appendChild(
    text(
      "A computer built from **5,636 logic gates** that runs a Figma editor, and **Figma itself runs the computer**. No plugin, no code: every wire is a variable, every gate is an action.",
      { size: 58, color: C.body, w: 6400, lh: 135, boldFont: "bold" },
    ),
  );
  tileRow(col, DEMO_TILES(f), 120, 38, 48);

  const tryIt = box("HORIZONTAL", 40);
  tryIt.counterAxisAlignItems = "CENTER";
  tryIt.paddingLeft = tryIt.paddingRight = 48;
  tryIt.paddingTop = tryIt.paddingBottom = 34;
  tryIt.cornerRadius = 32;
  tryIt.fills = solid(C.ink);
  fill(col, tryIt);
  tryIt.appendChild(
    text("TRY IT", { size: 34, font: "bold", color: "#FDE68A", ls: 12 }),
  );
  tryIt.appendChild(
    text(
      "▶ Present → flow “CPU NATHAN”   ·   V F R O P pick a tool   ·   click two corners to draw   ·   D duplicate, ⌫ delete, [ ] reorder   ·   “see the machine” lights up every gate",
      { size: 36, font: "med", color: C.white },
    ),
  );
  const link = linkText(["NATHAN · Figma OS"], "#C4B5FD", 34);
  if (link) tryIt.appendChild(link);
  return col.height;
}

// ---------- illustrations (full board) ----------

function artRecord(a, w) {
  const fields = [
    ["used", 1, 1, "#64748B"],
    ["vis", 1, 1, "#64748B"],
    ["kind", 2, 1, K.figma.dark],
    ["x0", 4, 2, K.hw.dark],
    ["x1", 4, 6, K.hw.dark],
    ["y0", 4, 1, K.test.dark],
    ["y1", 4, 4, K.test.dark],
    ["fill", 4, 12, "#1C8FD6"],
  ];
  const gg = 16;
  const bw = (w - gg * (fields.length - 1)) / 24;
  let x = 0;
  let bit = 0;
  for (const [name, n, v, col] of fields) {
    put(a, text(name, { size: 24, font: "bold", color: col }), x, 0);
    for (let i = n - 1; i >= 0; i--) {
      const on = (v >> i) & 1;
      const bx = x + (n - 1 - i) * bw;
      rect(a, bx + 3, 44, bw - 6, 78, on ? col : C.white, {
        stroke: col,
        sw: 2,
        radius: 10,
      });
      const t = text(String(on), {
        size: 30,
        font: "monoBold",
        color: on ? C.white : col,
      });
      put(a, t, bx + bw / 2 - t.width / 2, 83 - t.height / 2);
      const bt = text(String(bit + i), {
        size: 17,
        font: "mono",
        color: C.muted,
      });
      put(a, bt, bx + bw / 2 - bt.width / 2, 130);
    }
    const vt = text(
      name === "kind"
        ? "= 1 (rect)"
        : name === "fill"
          ? "= 12 (blue)"
          : `= ${v}`,
      { size: 22, font: "semi", color: C.body },
    );
    put(a, vt, x, 168);
    bit += n;
    x += n * bw + gg;
  }
  rect(a, x - gg - 4 * bw + 3, 205, 4 * bw - 6, 26, PICO.blue, { radius: 8 });
  return 236;
}

function artBars(a, w) {
  const groups = [
    [
      "by block",
      [
        ["LAYER ×8", 2272],
        ["GEOM", 821],
        ["PAINT", 766],
        ["HIT8", 623],
        ["READPLANE", 387],
        ["STATE", 264],
        ["LAYERCTL", 124],
        ["CONDS", 109],
        ["DISPLAY", 83],
        ["EVDEC", 61],
        ["NEWREC", 50],
        ["FREESLOT", 40],
        ["PEN", 26],
        ["clock", 10],
      ],
      [
        "#065F46",
        "#047857",
        "#059669",
        "#10B981",
        "#34D399",
        "#6EE7B7",
        "#0E7490",
        "#0891B2",
        "#22D3EE",
        "#1D4ED8",
        "#3B82F6",
        "#93C5FD",
        "#B45309",
        "#F59E0B",
      ],
    ],
    [
      "by kind",
      [
        ["AND", 3093],
        ["OR", 1797],
        ["NOT", 548],
        ["XOR", 160],
        ["BUF", 34],
        ["NOR", 4],
      ],
      ["#047857", "#10B981", "#6EE7B7", "#0E7490", "#22D3EE", "#F59E0B"],
    ],
  ];
  let y = 0;
  for (const [title, data, colors] of groups) {
    put(
      a,
      text(title.toUpperCase(), {
        size: 21,
        font: "bold",
        color: C.muted,
        ls: 8,
      }),
      0,
      y,
    );
    y += 40;
    const total = data.reduce((s, d) => s + d[1], 0);
    const bar = figma.createFrame();
    bar.fills = solid(C.white);
    bar.cornerRadius = 14;
    bar.clipsContent = true;
    put(a, bar, 0, y);
    bar.resize(w, 56);
    let x = 0;
    data.forEach(([, n], i) => {
      const bw = (n / total) * w;
      rect(bar, x, 0, Math.max(1, bw - 2), 56, colors[i]);
      x += bw;
    });
    y += 72;
    const legend = box("HORIZONTAL", 26);
    put(a, legend, 0, y);
    legend.resize(w, 10);
    legend.primaryAxisSizingMode = "FIXED";
    legend.counterAxisSizingMode = "AUTO";
    legend.layoutWrap = "WRAP";
    legend.counterAxisSpacing = 12;
    data.forEach(([name, n], i) => {
      const item = box("HORIZONTAL", 10);
      item.counterAxisAlignItems = "CENTER";
      const sq = figma.createRectangle();
      sq.resize(20, 20);
      sq.cornerRadius = 5;
      sq.fills = solid(colors[i]);
      item.appendChild(sq);
      item.appendChild(
        text(`${name} **${fmt(n)}**`, { size: 22, color: C.body }),
      );
      legend.appendChild(item);
    });
    y += legend.height + 40;
  }
  return y - 30;
}

function artSpacers(a, w) {
  const c = Math.min(104, Math.floor((w - 3 * 28) / 15));
  put(
    a,
    text("x0 = 5 = 0101 in binary → the spacers for bits 0 and 2 show", {
      size: 26,
      font: "semi",
      color: C.ink,
    }),
    0,
    0,
  );
  let x = 0;
  [1, 2, 4, 8].forEach((k, i) => {
    const on = (5 >> i) & 1;
    rect(a, x, 56, k * c, c, on ? "#FDE68A" : null, {
      stroke: on ? "#D97706" : "#A8A29E",
      sw: 3,
      dash: on ? null : [10, 8],
      radius: 8,
    });
    const t = text(`${k}`, {
      size: 28,
      font: "bold",
      color: on ? "#92400E" : "#A8A29E",
    });
    put(a, t, x + (k * c) / 2 - t.width / 2, 56 + c / 2 - t.height / 2);
    const tone = on ? "#92400E" : C.muted;
    put(
      a,
      text(`bit ${i} = ${on}`, { size: 20, font: "semi", color: tone }),
      x,
      66 + c,
    );
    put(a, text(on ? "shown" : "hidden", { size: 20, color: tone }), x, 94 + c);
    x += k * c + 28;
  });
  const gy = 56 + c + 150;
  put(
    a,
    text("Auto layout on the 14-cell canvas row: [1] [4] [body]", {
      size: 22,
      color: C.muted,
    }),
    0,
    gy - 36,
  );
  for (let i = 0; i < 14; i++)
    rect(a, i * c, gy, c - 4, c - 4, "#EEECE6", { radius: 6 });
  rect(a, 0, gy, c - 4, c - 4, "#FDE68A", {
    stroke: "#D97706",
    sw: 2,
    radius: 6,
  });
  rect(a, c, gy, 4 * c - 4, c - 4, "#FDE68A", {
    stroke: "#D97706",
    sw: 2,
    radius: 6,
  });
  rect(a, 5 * c, gy, 4 * c - 4, c - 4, PICO.blue, { radius: 6 });
  const bt = text("layer body starts at cell 5", {
    size: 22,
    font: "semi",
    color: C.white,
  });
  put(a, bt, 7 * c - 2 - bt.width / 2, gy + (c - 4) / 2 - bt.height / 2);
  put(
    a,
    text(
      "Hidden spacers take no room, so 1 + 4 pushes the body exactly 5 cells right.",
      { size: 22, color: C.body },
    ),
    0,
    gy + c + 18,
  );
  return gy + c + 60;
}

function artTree(a, w) {
  const leaves = [
    ["00", PICO.red],
    ["01", PICO.orange],
    ["10", PICO.blue],
    ["11", PICO.green],
  ];
  const shown = 2; // colour 2 = binary 10
  const bw = Math.min(260, w / 4 - 30);
  const lx = (i) => (w / 4) * i + w / 8;
  const mid = [(lx(0) + lx(1)) / 2, (lx(2) + lx(3)) / 2];
  const node = (cx, y, label, on) => {
    const b = box("HORIZONTAL");
    b.paddingLeft = b.paddingRight = 18;
    b.paddingTop = b.paddingBottom = 12;
    b.cornerRadius = 14;
    b.fills = solid(on ? "#FEF3C7" : C.white);
    b.strokes = solid(on ? "#D97706" : "#D6D3D1");
    b.strokeWeight = on ? 3 : 2;
    b.opacity = on ? 1 : 0.45;
    b.appendChild(text(label, { size: 22, font: "semi", color: C.ink }));
    put(a, b, cx - b.width / 2, y);
  };
  const link = (x1, y1, x2, y2, on) => {
    const v = poly(
      a,
      [
        [x1, y1],
        [x1, (y1 + y2) / 2],
        [x2, (y1 + y2) / 2],
        [x2, y2],
      ],
      on ? "#D97706" : "#D6D3D1",
      on ? 4 : 3,
      !on,
    );
    a.insertChild(0, v);
  };
  node(w / 2, 0, "colour bit 1 = 1", true);
  link(w / 2, 52, mid[0], 110, false);
  link(w / 2, 52, mid[1], 110, true);
  node(mid[0], 110, "child 0 · shows if ¬bit 1", false);
  node(mid[1], 110, "child 1 · shows if bit 1", true);
  node(mid[0], 190, "bit 0 = 0", false);
  node(mid[1], 190, "bit 0 = 0", true);
  leaves.forEach(([label, color], i) => {
    const on = i === shown;
    link(mid[i >> 1], 242, lx(i), 300, on);
    const r = rect(a, lx(i) - bw / 2, 300, bw, 64, color, { radius: 12 });
    r.opacity = on ? 1 : 0.18;
    const t = text(on ? `${label} · visible` : label, {
      size: 22,
      font: "bold",
      color: on ? C.white : C.ink,
    });
    t.opacity = on ? 1 : 0.4;
    put(a, t, lx(i) - t.width / 2, 332 - t.height / 2);
  });
  put(
    a,
    text("colour = 2 (10 in binary): only that leaf is visible", {
      size: 22,
      color: C.body,
    }),
    0,
    384,
  );
  return 416;
}

function artLamps(a, w, h) {
  const p = figma.createFrame();
  p.fills = solid(C.panel);
  p.cornerRadius = 20;
  put(a, p, 0, 0);
  p.resize(w, h);
  const rows = [
    ["gate/AND", "a = 1, b = 1", 1],
    ["gate/OR", "a = 0, b = 0", 0],
    ["gate/NOT", "a = 0", 1],
  ];
  rows.forEach(([name, inputs, out], i) => {
    const y = 40 + i * 125;
    const comp = COMPS[name];
    let gx = 40;
    if (comp) {
      const inst = comp.createInstance();
      put(p, inst, gx, y);
      inst.rescale(1.5);
      gx += inst.width + 30;
    } else {
      put(
        p,
        text(name.slice(5), { size: 30, font: "bold", color: "#E5E5E5" }),
        gx,
        y + 20,
      );
      gx += 140;
    }
    rect(p, gx, y + 34, 90, 4, out ? PICO.yellow : "#555555");
    const lamp = figma.createEllipse();
    lamp.resize(48, 48);
    lamp.fills = solid(out ? PICO.yellow : "#3D3D3D");
    lamp.strokes = solid(out ? "#FFF6A8" : "#5A5A5A");
    lamp.strokeWeight = 3;
    if (out)
      lamp.effects = [
        {
          type: "DROP_SHADOW",
          color: { r: 1, g: 0.92, b: 0.15, a: 0.7 },
          offset: { x: 0, y: 0 },
          radius: 26,
          spread: 4,
          visible: true,
          blendMode: "NORMAL",
        },
      ];
    put(p, lamp, gx + 100, y + 12);
    put(
      p,
      text(`${inputs}  →  ${out ? "lamp on" : "lamp off"}`, {
        size: 24,
        font: "med",
        color: out ? "#FFF6A8" : "#A3A3A3",
      }),
      gx + 180,
      y + 20,
    );
  });
  return h;
}

function artStack(a, w) {
  const names = [
    "select",
    "draw",
    "drop",
    "opposite corner",
    "pen up",
    "pen down",
  ];
  const active = 1;
  const bw = Math.min(560, w * 0.5);
  names.forEach((name, i) => {
    const x = i * 34;
    const y = i * 52;
    const on = i === active;
    const r = rect(a, x, y, bw, 120, on ? "#FEF3C7" : C.white, {
      stroke: on ? "#D97706" : "#C8C4BC",
      sw: on ? 4 : 2,
      dash: on ? null : [10, 8],
      radius: 16,
    });
    r.opacity = on ? 1 : 0.85;
    const t = text(
      on ? `click layer “${name}” · showing` : `“${name}” · hidden`,
      { size: 22, font: on ? "bold" : "reg", color: on ? "#92400E" : C.muted },
    );
    put(a, t, x + 20, y + 12);
  });
  const tx = 5 * 34 + bw + 50;
  put(
    a,
    text("hot = 1 (draw tool, nothing pending)", {
      size: 24,
      font: "semi",
      color: C.ink,
      w: Math.max(200, w - tx),
    }),
    tx,
    40,
  );
  put(
    a,
    text(
      "Only the showing layer gets the click, so the reaction that runs was built for exactly this state.",
      { size: 22, color: C.body, w: Math.max(200, w - tx), lh: 140 },
    ),
    tx,
    110,
  );
  return Math.max(5 * 52 + 120, 260);
}

function artInk(a, w, h) {
  const art = [
    "..............",
    ".#...#.###..#.",
    ".#...#..#...#.",
    ".#...#..#...#.",
    ".#####..#...#.",
    ".#...#..#...#.",
    ".#...#..#.....",
    ".#...#.###..#.",
    "..............",
    "..............",
  ];
  const c = Math.floor(Math.min((w - 20) / 14, (h - 20) / 10));
  const frame = figma.createFrame();
  frame.fills = solid(C.white);
  frame.strokes = solid(C.rule);
  frame.strokeWeight = 2;
  frame.cornerRadius = 10;
  put(a, frame, (w - 14 * c) / 2 - 8, 0);
  frame.resize(14 * c + 16, 10 * c + 16);
  art.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      rect(
        frame,
        8 + x * c + 1,
        8 + y * c + 1,
        c - 2,
        c - 2,
        ch === "#" ? C.ink : "#F1EFEA",
        { radius: 3 },
      );
    }),
  );
  return 10 * c + 16;
}

function artComponent(a, w, h, name) {
  const p = figma.createFrame();
  p.fills = solid(C.panel);
  p.cornerRadius = 18;
  put(a, p, 0, 0);
  p.resize(w, h);
  const comp = COMPS[name];
  if (!comp) {
    put(p, text(name, { size: 26, font: "mono", color: "#E5E5E5" }), 30, 30);
    return h;
  }
  const inst = comp.createInstance();
  p.appendChild(inst);
  inst.rescale(Math.min((w - 40) / inst.width, (h - 30) / inst.height, 2));
  inst.x = Math.round((w - inst.width) / 2);
  inst.y = Math.round((h - inst.height) / 2);
  return h;
}

function artGallery(a, w, h) {
  const p = figma.createFrame();
  p.fills = solid(C.panel);
  p.cornerRadius = 20;
  put(a, p, 0, 0);
  p.resize(w, h);
  const gates = [
    ["AND", "a · b"],
    ["OR", "a + b"],
    ["NAND", "¬(a · b)"],
    ["NOR", "¬(a + b)"],
    ["XOR", "a ⊕ b"],
    ["XNOR", "¬(a ⊕ b)"],
    ["NOT", "¬a"],
    ["BUF", "a"],
  ];
  const cw = w / 2;
  const ch = (h - 30) / 4;
  gates.forEach(([g, formula], i) => {
    const x = (i % 2) * cw + 30;
    const y = Math.floor(i / 2) * ch + 30;
    const comp = COMPS[`gate/${g}`];
    let tx = x;
    if (comp) {
      const inst = comp.createInstance();
      put(p, inst, x, y + 10);
      inst.rescale(Math.min(1.6, (ch - 50) / inst.height));
      tx = x + inst.width + 24;
    }
    put(p, text(g, { size: 30, font: "bold", color: "#F5F5F5" }), tx, y + 14);
    put(
      p,
      text(formula, { size: 24, font: "mono", color: "#A3E635" }),
      tx,
      y + 56,
    );
  });
  return h;
}

// ---------- build ----------

/** Opens a hidden UI that posts text or PNG bytes to the dev log server; null when unreachable. */
function openLog() {
  return new Promise((resolve) => {
    let pending = null;
    figma.showUI(
      `<script>
        onmessage = async (e) => {
          const m = e.data.pluginMessage;
          let ok = "sent";
          try {
            const r = await fetch(${JSON.stringify(LOG)} + m.path, { method: "POST", body: m.bytes ? new Blob([m.bytes]) : m.text });
            if (!r.ok) ok = "http " + r.status;
          } catch (err) { ok = String(err); }
          parent.postMessage({ pluginMessage: { ack: ok } }, "*");
        };
        parent.postMessage({ pluginMessage: "ready" }, "*");
      </script>`,
      { visible: false },
    );
    const log = {
      send(path, payload) {
        return new Promise((res) => {
          pending = res;
          figma.ui.postMessage(
            typeof payload === "string"
              ? { path, text: payload }
              : { path, bytes: payload },
          );
          setTimeout(() => res("timeout"), 10000);
        });
      },
    };
    figma.ui.onmessage = (m) => {
      if (m === "ready") resolve(log);
      else if (m && m.ack && pending) {
        const p = pending;
        pending = null;
        p(m.ack);
      }
    };
    setTimeout(() => resolve(null), 4000);
  });
}

async function facts() {
  let vars = 0;
  for (const c of await figma.variables.getLocalVariableCollectionsAsync())
    if (c.name === "NATHAN" || c.name.startsWith("NATHAN · "))
      vars += c.variableIds.length;
  const ui = figma.root.children.find((p) => p.name === "UI");
  let uiScreens = 0;
  if (ui) {
    await ui.loadAsync();
    uiScreens = ui.children.filter((n) => n.name.startsWith("os-ui · ")).length;
  }
  return { vars: vars ? fmt(vars) : "5,660", uiScreens: uiScreens || 61 };
}

async function build(kind) {
  const t0 = Date.now();
  const full = kind === "full";
  const st = STYLE[kind];
  figma.notify(`Drawing the ${full ? "full" : "demo"} flowchart…`, {
    timeout: 3000,
  });
  await loadFonts();
  const page = figma.currentPage;
  await findTargets(page);
  const f = await facts();

  // placed left of everything already on the page (other boards included), level with the frames
  // ▶ Present plays; nothing on the page is moved or removed
  const others = page.children.slice();
  const board = figma.createFrame();
  board.name = full ? NAME_FULL : NAME_DEMO;
  page.appendChild(board);
  board.fills = solid(C.paper);
  board.cornerRadius = 72;
  board.clipsContent = false;
  board.resize(W, 1000);
  try {
    let y = PAD + (full ? headerFull(board, f) : headerDemo(board, f)) + 160;
    const rows = full
      ? sections(f).map((s) => [s])
      : DEMO_LAYOUT.map((row) => row.map((key) => DEMO[key]));
    const gap = 140;
    let i = 0;
    for (const row of rows) {
      const w = (IW - gap * (row.length - 1)) / row.length;
      const secs = [];
      for (let j = 0; j < row.length; j++)
        secs.push(
          await panel(board, PAD + j * (w + gap), y, w, row[j], ++i, st),
        );
      const h = Math.max(...secs.map((s) => s.height));
      for (const s of secs) s.resize(s.width, h);
      y += h + gap;
    }
    if (full)
      put(
        board,
        text(
          "Drawn by tools/flowchart (the FigmaCPU Flowchart dev plugin) from the repo's docs and the measured netlist.",
          { size: 26, color: C.muted },
        ),
        PAD,
        y,
      );
    board.resize(W, y + (full ? 60 : -gap) + PAD);
  } catch (e) {
    board.remove(); // only the board this run was drawing
    throw e;
  }

  const minX = others.length ? Math.min(...others.map((n) => n.x)) : 0;
  const anchor = LINKS["NATHAN · Figma OS"];
  board.x = Math.round(minX - 3000 - W);
  board.y = Math.round(
    anchor && anchor.parent === page
      ? anchor.y
      : others.length
        ? Math.min(...others.map((n) => n.y))
        : 0,
  );
  figma.viewport.scrollAndZoomIntoView([board]);

  const summary = `Built "${board.name}" at (${board.x}, ${board.y}), ${Math.round(board.width)} × ${Math.round(board.height)}, ${board.findAll().length + 1} layers, ${((Date.now() - t0) / 1000).toFixed(1)} s`;
  const log = await openLog();
  if (log) {
    await log.send("build", summary);
    await log.send(
      `png/${kind}-board`,
      await board.exportAsync({
        format: "PNG",
        constraint: { type: "WIDTH", value: 2400 },
      }),
    );
  }
  figma.closePlugin(`${summary}.`);
}

// ---------- inspect (read only) ----------

async function inspect() {
  const lines = [`file "${figma.root.name}"`];
  for (const p of figma.root.children) {
    await p.loadAsync();
    lines.push(
      `page ${p.id} "${p.name}"${p === figma.currentPage ? " (current)" : ""} kids=${p.children.length}`,
    );
    for (const fl of p.flowStartingPoints)
      lines.push(`  flow "${fl.name}" → ${fl.nodeId}`);
    const comps = p.children.filter((n) => /^(cell|gate)\//.test(n.name));
    for (const n of p.children.filter((n) => !comps.includes(n)))
      lines.push(
        `  ${n.id} ${n.type} "${n.name}" x=${Math.round(n.x)} y=${Math.round(n.y)} w=${Math.round(n.width)} h=${Math.round(n.height)}`,
      );
    if (comps.length)
      lines.push(`  ${comps.length} cell/ and gate/ components`);
  }
  for (const c of await figma.variables.getLocalVariableCollectionsAsync())
    lines.push(`collection "${c.name}" vars=${c.variableIds.length}`);
  const log = await openLog();
  const r = log ? await log.send("inspect", lines.join("\n")) : "no log server";
  figma.closePlugin(`inspected: ${r}`);
}

const run =
  figma.command === "inspect"
    ? inspect
    : () => build(figma.command === "build-full" ? "full" : "demo");
run().catch((e) => {
  console.error(e);
  figma.closePlugin(
    `Flowchart failed: ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e}`,
  );
});
