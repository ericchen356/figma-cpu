// use_figma script (Figma MCP): render test for the gate highlights. Temporarily sets every net/*
// variable's power-on value to true, screenshots "CPU · Live" (every bound gate should light), then puts
// every value back exactly (`same: true` in the result confirms it). Use it when "nothing lights up".
const NAME = "CPU";
const page = figma.root.children.find((p) => p.children.some((n) => n.name === NAME + " · Live"));
await figma.setCurrentPageAsync(page);
const col = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === NAME);
const mode = col.defaultModeId;
const nets = (await figma.variables.getLocalVariablesAsync("BOOLEAN")).filter((v) => v.variableCollectionId === col.id && v.name.startsWith("net/"));
const saved = nets.map((v) => [v, v.valuesByMode[mode]]);
const live = page.children.find((n) => n.name === NAME + " · Live");
try {
  for (const v of nets) v.setValueForMode(mode, true);
  await live.screenshot({ scale: 1 });
} finally {
  for (const [v, x] of saved) v.setValueForMode(mode, x);
}
return { nets: nets.length, same: saved.every(([v, x]) => v.valuesByMode[mode] === x) };
