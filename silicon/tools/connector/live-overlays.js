// use_figma script (Figma MCP): makes "CPU · Live" run in place. Run after live-view.js.
//   · Run: 11 small overlay frames "CPU · Live Run k" (a "Running · phase k/11" bar with Stop). Each one,
//     on AFTER_TIMEOUT, runs chunk k (the same gate actions the "CPU · Run k" frames hold) and SWAPs to the
//     next overlay, or sets running := false and CLOSEs. The CPU view stays underneath and lights up live
//     (a NAVIGATE loop would replace the view with the Run frames).
//   · Reset: overlay frames "CPU · Live Reset n" with the "CPU · Reset n" restore actions, SWAP … CLOSE.
//   · The Live view's Run / Reset buttons open these overlays.
//   · Brighter highlights: the `lit` layer of every gate component gets a solid yellow fill and a 4 px
//     outline (the 22 % amber fill was invisible at the Live view's 4 % scale).
// Overlay position can't be set from the Plugin API (overlayPositionType is read-only): Figma centres them.
const NAME = "CPU";
const page = figma.root.children.find((p) => p.children.some((n) => n.name === NAME + " · Live"));
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: "Inter", style: "Bold" });
await figma.loadFontAsync({ family: "Inter", style: "Regular" });
const col = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === NAME);
const running = (await figma.variables.getLocalVariablesAsync()).find((v) => v.variableCollectionId === col.id && v.name === "ctl/running");
const B = (value) => ({ type: "BOOLEAN", resolvedType: "BOOLEAN", value });
const setRun = (x) => ({ type: "SET_VARIABLE", variableId: running.id, variableValue: B(x) });
const go = (dest, navigation) => ({ type: "NODE", destinationId: dest, navigation, transition: null });
const byNumber = (re) => page.children.filter((n) => re.test(n.name)).sort((a, b) => Number(a.name.split(" ").pop()) - Number(b.name.split(" ").pop()));

let brightened = 0;
for (const g of page.children.filter((n) => n.type === "COMPONENT" && n.name.startsWith("gate/"))) {
  const l = g.children.find((c) => c.name === "lit");
  l.fills = [{ type: "SOLID", color: { r: 1, g: 0.86, b: 0.2 }, opacity: 0.85 }];
  l.strokes = [{ type: "SOLID", color: { r: 1, g: 0.92, b: 0.35 } }];
  l.strokeWeight = 4;
  brightened++;
}

for (const old of page.children.filter((n) => n.name.startsWith(NAME + " · Live Run ") || n.name.startsWith(NAME + " · Live Reset "))) old.remove();
const live = page.children.find((n) => n.name === NAME + " · Live");
const text = (parent, s, x, y, size, color) => { const t = figma.createText(); t.fontName = { family: "Inter", style: "Bold" }; t.characters = s; t.fontSize = size; t.fills = [{ type: "SOLID", color }]; parent.appendChild(t); t.x = x; t.y = y; return t; };
const pill = (name, label, i, withStop) => {
  const f = figma.createFrame();
  f.name = name; f.resize(300, 56); f.cornerRadius = 12;
  f.fills = [{ type: "SOLID", color: { r: 0.12, g: 0.13, b: 0.16 } }];
  f.strokes = [{ type: "SOLID", color: { r: 0.3, g: 0.32, b: 0.38 } }];
  page.appendChild(f); f.x = live.x + live.width + 120 + (i % 6) * 340; f.y = live.y + Math.floor(i / 6) * 90 + (withStop ? 0 : 220);
  text(f, label, 16, 18, 15, { r: 0.9, g: 0.92, b: 0.96 });
  let stop = null;
  if (withStop) {
    stop = figma.createFrame(); stop.name = "button/Stop"; stop.resize(80, 36); stop.cornerRadius = 8;
    stop.fills = [{ type: "SOLID", color: { r: 0.86, g: 0.25, b: 0.25 } }];
    f.appendChild(stop); stop.x = 204; stop.y = 10;
    text(stop, "Stop", 22, 9, 14, { r: 1, g: 1, b: 1 });
  }
  return { f, stop };
};

const runFrames = byNumber(/^CPU · Run \d+$/);
const K = runFrames.length;
const runOv = runFrames.map((_, k) => pill(`${NAME} · Live Run ${k + 1}`, `Running · phase ${k + 1}/${K}`, k, true));
for (let k = 0; k < K; k++) {
  const blk = runFrames[k].reactions[0].actions[0].conditionalBlocks[0];
  const acts = blk.actions.filter((a) => a.type !== "NODE");
  if (acts.length !== blk.actions.length - 1) throw new Error("unexpected Run frame shape at " + k);
  await runOv[k].f.setReactionsAsync([{ trigger: { type: "AFTER_TIMEOUT", timeout: 1 }, actions: [{ type: "CONDITIONAL", conditionalBlocks: [
    { condition: blk.condition, actions: [...acts, go(runOv[(k + 1) % K].f.id, "SWAP")] },
    { actions: [setRun(false), { type: "CLOSE" }] },
  ] }] }]);
  await runOv[k].stop.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: [setRun(false)] }]);
}

const resetFrames = byNumber(/^CPU · Reset \d+$/);
const resetOv = resetFrames.map((_, i) => pill(`${NAME} · Live Reset ${i + 1}`, `Resetting… ${i + 1}/${resetFrames.length}`, i, false));
for (const [i, rf] of resetFrames.entries()) {
  const acts = rf.reactions[0].actions.filter((a) => a.type !== "NODE");
  const tail = i + 1 < resetOv.length ? [go(resetOv[i + 1].f.id, "SWAP")] : [{ type: "CLOSE" }];
  await resetOv[i].f.setReactionsAsync([{ trigger: { type: "AFTER_TIMEOUT", timeout: 1 }, actions: [...acts, ...tail] }]);
}

const runBtns = live.findAll((n) => n.name === "button/Run");
for (const [k, b] of runBtns.entries()) await b.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: [setRun(true), go(runOv[k].f.id, "OVERLAY")] }]);
const resetBtn = live.findOne((n) => n.name === "button/Reset");
await resetBtn.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: [setRun(false), go(resetOv[0].f.id, "OVERLAY")] }]);

page.flowStartingPoints = page.flowStartingPoints.filter((f) => !f.name.startsWith("Flow "));
const n = (rs) => { let c = 0; const w = (l) => { for (const a of l || []) { c++; if (a.type === "CONDITIONAL") for (const b of a.conditionalBlocks) w(b.actions); } }; for (const r of rs) w(r.actions); return c; };
return { brightened, runOverlays: runOv.map((o) => n(o.f.reactions)), resetOverlays: resetOv.map((o) => n(o.f.reactions)), runButtons: runBtns.length, flows: page.flowStartingPoints.map((f) => f.name) };
