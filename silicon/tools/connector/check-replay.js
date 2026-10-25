// use_figma script (Figma MCP), READ-ONLY: replays the Step reactions stored in the file, the way the
// prototype viewer would run them, from the power-on values: each round clicks the one visible Step button.
// Returns the OUT trace, the tick HALTED was set, and the click count. Changes nothing in the file.
// ptrout should give OUT 7, 6, … 0 (from tick 23, every 18 ticks) and HALTED at tick 165.
const NAME = "CPU", FRAME = NAME + " · Live", MAX_TICKS = 300;
const page = figma.root.children.find((p) => p.children.some((n) => n.name === NAME + " · Control"));
await figma.setCurrentPageAsync(page);
const col = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === NAME);
const vars = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === col.id);
const vals = new Map(vars.map((v) => [v.id, v.valuesByMode[col.defaultModeId]]));
const byName = new Map(vars.map((v) => [v.name, v.id]));
const ev = (d) => {
  if (d.type === "VARIABLE_ALIAS") return vals.get(d.value.id);
  if (d.type !== "EXPRESSION") return d.value;
  const a = d.value.expressionArguments.map(ev);
  switch (d.value.expressionFunction) {
    case "NOT": return !a[0];
    case "AND": return a[0] && a[1];
    case "OR": return a[0] || a[1];
    case "EQUALS": return a[0] === a[1];
    case "NOT_EQUAL": return a[0] !== a[1];
    case "ADDITION": return typeof a[0] === "string" || typeof a[1] === "string" ? String(a[0]) + String(a[1]) : a[0] + a[1];
    default: throw new Error("unsupported " + d.value.expressionFunction);
  }
};
const run = (acts) => { for (const a of acts) { if (a.type === "SET_VARIABLE") vals.set(a.variableId, ev(a.variableValue)); else if (a.type === "CONDITIONAL") { for (const b of a.conditionalBlocks) if (!b.condition || ev(b.condition)) { run(b.actions); break; } } } };
const host = page.children.find((x) => x.name === FRAME) ?? page.children.find((x) => x.name === NAME + " · Control");
const steps = host.findAll((x) => x.name === "button/Step").map((b) => ({ vis: b.boundVariables.visible && b.boundVariables.visible.id, acts: b.reactions[0].actions }));
const out = () => [0, 1, 2, 3, 4, 5, 6, 7].reduce((s, i) => s | ((vals.get(byName.get(`net/OUT[${i}]`)) ? 1 : 0) << i), 0);
const ticks = () => vals.get(byName.get("ctl/ticks"));
const trace = [];
let last = -1, clicks = 0, haltTick = null;
for (; ticks() < MAX_TICKS; clicks++) {
  const shown = steps.filter((s) => !s.vis || vals.get(s.vis) === true);
  if (shown.length !== 1) return { error: `${shown.length} Step buttons visible at click ${clicks}` };
  run(shown[0].acts);
  if (out() !== last) { trace.push(`tick ${ticks()}: OUT=${out()}`); last = out(); }
  if (vals.get(byName.get("net/halted")) && haltTick === null) haltTick = ticks();
  if (haltTick !== null && ticks() >= haltTick + 2) break;
}
return { frame: host.name, clicks, ticks: ticks(), haltTick, OUT: out(), trace };
