// Stage 2 — reusable parts: the Lamp and Register components, labelled lamps, value blocks,
// wide registers, and bus connectors (taps).

// ---------- components ----------

function makeLamp(parent) {
  const lamp = figma.createComponent();
  lamp.name = "Lamp";
  lamp.resize(12, 12);
  lamp.cornerRadius = 6;
  lamp.fills = solid(C.lampOff);
  parent.appendChild(lamp);
  return lamp;
}

function lampInstance(Lamp, parent, name, x, y) {
  const i = Lamp.createInstance();
  i.name = name;
  i.x = x;
  i.y = y;
  parent.appendChild(i);
  return i;
}

// Register A–L: the renderer writes "value", "dec", fills "bit/0..7" and strokes the instance.
function makeRegisterSet(parent, Lamp) {
  const variants = ["idle", "active"].map((state, k) => {
    const c = figma.createComponent();
    c.name = `State=${state}`;
    c.resize(320, 200);
    c.cornerRadius = 8;
    c.fills = solid(C.cell);
    c.strokes = solid(state === "active" ? C.active : C.stroke);
    c.strokeWeight = state === "active" ? 3 : 2;
    c.x = k * 340;
    text(c, "name", "R", 16, 14, { size: 13, bold: true, color: C.dim });
    text(c, "dec", "0", 240, 14, { size: 12, mono: true, color: C.dim, width: 64, align: "RIGHT" });
    text(c, "value", "00", 16, 44, { size: 44, mono: true, bold: true });
    for (let b = 7; b >= 0; b--) lampInstance(Lamp, c, `bit/${b}`, 16 + (7 - b) * 24, 168);
    text(c, "bits-caption", "bit 7 … 0", 216, 166, { size: 10, mono: true, color: C.dim });
    return c;
  });
  const set = figma.combineAsVariants(variants, parent);
  set.name = "Register";
  set.x = 40;
  set.y = 0;
  return set;
}

// ---------- shared block shapes ----------

function lampLabel(Lamp, parent, name, label, x, y, w, labelColor) {
  const f = frame(parent, name, x, y, w, 28, { fill: C.cell, radius: 6 });
  lampInstance(Lamp, f, "lamp", 10, 8);
  text(f, "label", label, 30, 6, { size: 12, mono: true, color: labelColor || C.dim });
  return f;
}

function valueBlock(parent, name, label, sub, x, y, w, h, value) {
  const f = frame(parent, name, x, y, w, h, { fill: C.cell, strokeWeight: 2 });
  caption(f, label);
  text(f, "sub", sub, 16, 32, { size: 11, color: C.dim });
  text(f, "value", value, 16, 60, { size: 36, mono: true, bold: true });
  return f;
}

function wideRegister(Lamp, parent, name, label, sub, x, y, w, bits) {
  const f = valueBlock(parent, name, label, sub, x, y, w, 200, bits === 16 ? "0000" : "00");
  for (let b = bits - 1; b >= 0; b--) lampInstance(Lamp, f, `bit/${b}`, 16 + (bits - 1 - b) * 24, 168);
  return f;
}

// Bus taps: vertical connectors. The renderer lights every cpu/bus/tap/* when a bus is driven.
function tap(M, name, x, y0, y1) {
  return rect(M, `cpu/bus/tap/${name}`, x - 3, y0, 6, y1 - y0, C.bus, 2);
}
function tapLabel(M, chars, x, y, align) {
  const t = text(M, "tap-label", chars, x, y, { size: 10, mono: true, color: C.dim });
  if (align === "RIGHT") t.x = x - t.width;
  return t;
}
