// use_figma script (Figma MCP): builds "CPU · Live", a 1920×1080 frame that shows the whole gate-level
// CPU on one screen while it runs, plus a Present flow for it. Run after controls.js.
//   · top: an instance of cell/CPU scaled to the frame width (~4 %): every gate's `lit` layer is bound to
//     its output wire, and instances keep those bindings, so the whole machine lights up live;
//   · bottom-left: a copy of the Control frame's controls (stacked Step / Run buttons, Reset, counters,
//     front panel) with their reactions and variable bindings, scaled to 85 %;
//   · zoom windows: more cell/CPU instances, clipped and scaled onto the ALU, the register file and the
//     bus mux + IR + control unit (the opcode decoder).
// All views read the same variables, so one Step lights all of them. Nothing here adds an action per tick.
// Region coordinates are in cell/CPU's own coordinates (Build hardware's layout of the v1 CPU).
const NAME = "CPU", W = 1920, H = 1080, M = 20;
const page = figma.root.children.find((p) => p.children.some((n) => n.name === NAME + " · Control"));
await figma.setCurrentPageAsync(page);
for (const old of page.children.filter((n) => n.name === NAME + " · Live")) old.remove();
const cpu = page.findOne((n) => n.name === "cell/CPU" && n.type === "COMPONENT");
const control = page.children.find((n) => n.name === NAME + " · Control");
await figma.loadFontAsync({ family: "Inter", style: "Regular" });
await figma.loadFontAsync({ family: "Inter", style: "Bold" });
for (const t of control.findAll((n) => n.type === "TEXT")) for (const s of t.getStyledTextSegments(["fontName"])) await figma.loadFontAsync(s.fontName);

const live = figma.createFrame();
live.name = NAME + " · Live";
live.resize(W, H);
live.fills = [{ type: "SOLID", color: { r: 0.09, g: 0.09, b: 0.1 } }];
live.clipsContent = true;
page.appendChild(live);
live.x = control.x; live.y = control.y + control.height + 600;

const label = (parent, text, x, y, size, bold) => {
  const t = figma.createText();
  t.fontName = { family: "Inter", style: bold ? "Bold" : "Regular" };
  t.characters = text; t.fontSize = size;
  t.fills = [{ type: "SOLID", color: { r: 0.75, g: 0.77, b: 0.82 } }];
  parent.appendChild(t); t.x = x; t.y = y; return t;
};
// A clipped window showing region (rx, ry, rw, rh) of the CPU at the largest scale that fits w × h.
const windowOf = (name, title, x, y, w, h, rx, ry, rw, rh) => {
  const f = figma.createFrame();
  f.name = name; f.resize(w, h); f.clipsContent = true; f.cornerRadius = 10;
  f.fills = [{ type: "SOLID", color: { r: 0.118, g: 0.118, b: 0.118 } }];
  f.strokes = [{ type: "SOLID", color: { r: 0.25, g: 0.26, b: 0.3 } }]; f.strokeWeight = 1;
  live.appendChild(f); f.x = x; f.y = y;
  const s = Math.min(w / rw, (h - 28) / rh);
  const inst = cpu.createInstance();
  f.appendChild(inst);
  inst.rescale(s);
  inst.x = -rx * s + (w - rw * s) / 2; inst.y = 28 - ry * s + (h - 28 - rh * s) / 2;
  label(f, title, 10, 6, 13, true);
  return s;
};

const scales = {};
scales.full = windowOf("view/full CPU", "Whole CPU — every gate lights while its output is 1", M, M, W - 2 * M, 430, 0, 0, cpu.width, cpu.height);

// Controls: copy every Control child into a header, then copy reactions and variable bindings pairwise.
const header = figma.createFrame();
header.name = "header";
header.resize(control.width, control.height);
header.fills = control.fills;
header.cornerRadius = 16;
live.appendChild(header);
const pairs = [];
const pairUp = (a, b) => { pairs.push([a, b]); if (a.type === "INSTANCE" || !("children" in a) || !("children" in b)) return; a.children.forEach((c, i) => b.children[i] && pairUp(c, b.children[i])); };
for (const c of [...control.children]) { const k = c.clone(); header.appendChild(k); k.x = c.x; k.y = c.y; pairUp(c, k); }
let reactions = 0, bindings = 0;
for (const [o, k] of pairs) {
  if (o.reactions && o.reactions.length) { await k.setReactionsAsync(o.reactions); reactions++; }
  for (const [field, alias] of Object.entries(o.boundVariables || {})) {
    if (!alias || Array.isArray(alias) || !alias.id) continue;
    if (!(k.boundVariables && k.boundVariables[field] && k.boundVariables[field].id === alias.id)) {
      const v = await figma.variables.getVariableByIdAsync(alias.id);
      if (v) k.setBoundVariable(field, v);
    }
    bindings++;
  }
}
header.rescale(0.85);
header.x = M; header.y = 470;

const top = 470, bottom = H - 44;
scales.alu = windowOf("view/ALU", "ALU — adder/subtract, AND/OR/XOR, result mux", M, header.y + header.height + 12, header.width, bottom - (header.y + header.height + 12), 14500, 1250, 9200, 3300);
const rx = header.x + header.width + M, rw = W - rx - M, half = Math.floor((rw - M) / 2);
scales.regs = windowOf("view/registers", "Register file R0–R3 + read mux", rx, top, half, H - top - M, 8200, 0, 6300, 5900);
scales.ctl = windowOf("view/control", "Bus mux + IR + control unit (opcode decoder)", rx + half + M, top, half, H - top - M, 24000, 400, 5900, 3700);
label(live, "Step = one of 11 chunks of a clock tick · watch the gates light", M, H - 34, 13, false);

page.flowStartingPoints = [...page.flowStartingPoints.filter((f) => f.name !== live.name), { nodeId: live.id, name: live.name }];
return { live: live.id, scales, reactions, bindings, flows: page.flowStartingPoints.map((f) => f.name) };
