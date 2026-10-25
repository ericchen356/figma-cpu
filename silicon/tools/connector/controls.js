// use_figma script (Figma MCP), run once after every chunk is wired (wire-chunk.mjs):
//   · the stacked Run buttons (one per phase): running := true, NAVIGATE to Run frame k+1;
//   · every Stop button: running := false;
//   · Reset: a chain of "CPU · Reset n" frames, each restoring ≤ 380 variables to their power-on
//     (default-mode) value on AFTER_TIMEOUT, the last one returning to Control. One event that restores
//     all ~2,300 variables would be past the ~500–2,000 actions at which the viewer dies;
//   · the Present flow "CPU" starting at Control (and no stray auto-created flows).
// Paste the whole file as the use_figma code. Safe to run again (it replaces what it made).
const NAME = "CPU", PER_RESET = 380;
const page = figma.root.children.find((p) => p.children.some((n) => n.name === NAME + " · Control"));
await figma.setCurrentPageAsync(page);
const col = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === NAME);
const allVars = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === col.id);
const running = allVars.find((v) => v.name === "ctl/running");
const B = (value) => ({ type: "BOOLEAN", resolvedType: "BOOLEAN", value });
const F = (value) => ({ type: "FLOAT", resolvedType: "FLOAT", value });
const S = (value) => ({ type: "STRING", resolvedType: "STRING", value });
const set = (vid, value) => ({ type: "SET_VARIABLE", variableId: vid, variableValue: value });
const nav = (dest) => ({ type: "NODE", destinationId: dest, navigation: "NAVIGATE", transition: null });
const control = page.children.find((n) => n.name === NAME + " · Control");
const runs = page.children.filter((n) => /^CPU · Run \d+$/.test(n.name)).sort((a, b) => Number(a.name.split(" ").pop()) - Number(b.name.split(" ").pop()));
const n = (rs) => { let c = 0; const w = (l) => { for (const a of l || []) { c++; if (a.type === "CONDITIONAL") for (const b of a.conditionalBlocks) w(b.actions); } }; for (const r of rs) w(r.actions); return c; };

const runBtns = control.findAll((x) => x.name === "button/Run");
if (runBtns.length !== runs.length) throw new Error(`${runBtns.length} Run buttons but ${runs.length} Run frames`);
for (const [i, b] of runBtns.entries()) await b.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: [set(running.id, B(true)), nav(runs[i].id)] }]);
for (const r of runs) for (const s of r.findAll((x) => x.name === "button/Stop")) await s.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: [set(running.id, B(false))] }]);

const mode = col.defaultModeId;
const value = (v) => { const x = v.valuesByMode[mode]; return v.resolvedType === "BOOLEAN" ? B(x) : v.resolvedType === "FLOAT" ? F(x) : S(x); };
const restorable = allVars.filter((v) => typeof v.valuesByMode[mode] !== "object");
for (const old of page.children.filter((x) => /^CPU · Reset \d+$/.test(x.name))) old.remove();
const groups = [];
for (let i = 0; i < restorable.length; i += PER_RESET) groups.push(restorable.slice(i, i + PER_RESET));
const last = runs[runs.length - 1];
const frames = groups.map((g, i) => {
  const f = figma.createFrame();
  f.name = `${NAME} · Reset ${i + 1}`;
  f.resize(200, 120);
  f.fills = [{ type: "SOLID", color: { r: 0.08, g: 0.08, b: 0.1 } }];
  page.appendChild(f);
  f.x = last.x + last.width + 80 + i * 280;
  f.y = last.y;
  return f;
});
for (const [i, f] of frames.entries()) {
  const tail = i + 1 < frames.length ? [nav(frames[i + 1].id)] : [nav(control.id)];
  await f.setReactionsAsync([{ trigger: { type: "AFTER_TIMEOUT", timeout: 0.001 }, actions: [...groups[i].map((v) => set(v.id, value(v))), ...tail] }]);
}
const reset = control.findAll((x) => x.name === "button/Reset")[0];
await reset.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: [set(running.id, B(false)), nav(frames[0].id)] }]);

const others = page.flowStartingPoints.filter((f) => f.nodeId !== control.id && f.name !== NAME && !f.name.startsWith("Flow "));
page.flowStartingPoints = [...others, { nodeId: control.id, name: NAME }];
return { runButtons: runBtns.map((b) => n(b.reactions)), resetFrames: frames.map((f) => n(f.reactions)), restored: restorable.length, flows: page.flowStartingPoints.map((f) => f.name) };
