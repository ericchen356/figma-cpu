// Binder: finds the drawn machine once and maps contract names (cpu/…, mem/…, dev/…) to node
// handles, so the renderer never searches the tree while the CPU runs.

const MACHINE_FRAME = "Machine v2";

function findMachine(page) {
  return (page || figma.currentPage).children.find((n) => n.type === "FRAME" && n.name === MACHINE_FRAME) || null;
}

function child(node, name) {
  if (!node || !("findOne" in node)) return undefined;
  return node.findOne((n) => n.name === name) || undefined;
}

function childText(node, name) {
  if (!node || !("findOne" in node)) return undefined;
  return node.findOne((n) => n.name === name && n.type === "TEXT") || undefined;
}

function requiredNames() {
  const names = CORE.REGISTERS.map((r) => `cpu/reg/${r}`).concat([
    "cpu/reg/PC", "cpu/reg/SP", "cpu/reg/IR", "cpu/reg/HL", "cpu/reg/MAR", "cpu/reg/MDR",
    "cpu/latch/OPR", "cpu/latch/T", "cpu/latch/W", "cpu/flag/Z", "cpu/flag/C", "cpu/flag/N",
    "cpu/alu/op", "cpu/alu/in1", "cpu/alu/in2", "cpu/alu/out", "cpu/bus/addr", "cpu/bus/data",
    "cpu/phase/FETCH", "cpu/phase/DECODE", "cpu/phase/EXEC", "cpu/clock", "cpu/cycles",
    "cpu/decoder/table", "cpu/tstate", "mem/ram/base", "mem/pin/base", "dev/screen",
  ]);
  for (let i = 0; i < 256; i++) names.push(`mem/ram/cell/${CORE.hex(i, 2)}`);
  for (let i = 0; i < 64; i++) names.push(`mem/pin/cell/${CORE.hex(i, 2)}`);
  for (const k of Object.keys(CORE.IO)) names.push(`mem/io/${k}`);
  for (let t = 0; t < CORE.MAX_TSTATES; t++) names.push(`cpu/tstate/T${t}`);
  for (const s of CORE.SIGNALS) names.push(`cpu/sig/${s.name}`);
  return names;
}

function bindRows(table) {
  if (!table || !("children" in table)) return [];
  const rows = [];
  for (const n of table.children) {
    if (n.name.indexOf("row/") !== 0 || n.type !== "FRAME") continue;
    const op = childText(n, "op");
    const mnem = childText(n, "mnem");
    const fmt = childText(n, "fmt");
    const micro = childText(n, "micro");
    if (op && mnem && fmt && micro) rows.push({ frame: n, op, mnem, fmt, micro });
  }
  return rows;
}

/** Loads every font used inside the machine so any text can be rewritten. */
async function loadMachineFonts(root) {
  const seen = new Map();
  for (const t of root.findAllWithCriteria({ types: ["TEXT"] })) {
    const fonts = t.fontName === figma.mixed ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName];
    for (const f of fonts) seen.set(`${f.family}/${f.style}`, f);
  }
  await Promise.all(Array.from(seen.values()).map((f) => figma.loadFontAsync(f)));
}

async function bindMachine(root) {
  const byName = new Map();
  for (const n of root.findAll((x) => /^(cpu|mem|dev)\//.test(x.name))) if (!byName.has(n.name)) byName.set(n.name, n);
  await loadMachineFonts(root);
  const missing = requiredNames().filter((n) => !byName.has(n));
  return { root, byName, rows: bindRows(byName.get("cpu/decoder/table")), missing };
}

/** Reads the opcode table straight off the canvas (re-binding rows if some were added or removed). */
function readRows(b) {
  const table = b.byName.get("cpu/decoder/table");
  if (table && table.children.filter((n) => n.name.indexOf("row/") === 0).length !== b.rows.length) b.rows = bindRows(table);
  return b.rows
    .filter((r) => !r.frame.removed)
    .map((r) => ({ op: r.op.characters, mnem: r.mnem.characters, fmt: r.fmt.characters, micro: r.micro.characters }));
}
