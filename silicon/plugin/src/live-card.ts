// The "Live view" card: builds the FigmaCPU Live dashboard (lane L1, src/live) on the CPU's page,
// binds it to the variables Compile made, and wires its controls for Present mode with lane L2's
// wireLive (src/prototype/live.ts): Live · Main / Run A/B / Load A/B frames, Step, Run, Stop,
// Reset, the clock pad and the program disks. It reuses the Compile session (variables, plan, and
// apply()'s result, whose runtime wireLive needs), so it only works after a Compile in this
// session; a rebuild replaces the top-level `Live · *` layers and nothing else.
import { PROGRAMS } from "../../src/isa";
import { bindDashboard, buildDashboard, type BindReport, findDashboard, freeSpot, isLiveNode, listingText } from "../../src/live";
import type { FlatNetlist } from "../../src/netlist/types";
import type { ApplyResult, PrototypePlan } from "../../src/prototype";
import * as live from "../../src/prototype/live";
import type { VarRef } from "./clock";
import type { LiveStats, LogLevel } from "./messages";
import { programName } from "./program";
import { uniquePages, type Where } from "./where";

export interface LiveCardInput {
  api: PluginAPI;
  where: Where;
  net: FlatNetlist;
  plan: PrototypePlan;
  /** Net id → its variable (the Compile session's). */
  vars: Map<number, VarRef>;
  /** The program the variables hold (the `custom` disk and the listing). */
  source: string;
  /** apply()'s result from this session's Compile: wireLive needs its runtime. */
  applied?: ApplyResult;
  /** Names of the prototype's variable collections ("CPU", "CPU · 2", …). */
  isOurCollection: (name: string) => boolean;
  log: (level: LogLevel, text: string) => void;
  progress: (done: number, total: number, label: string) => void;
  breathe: () => Promise<void>;
  now: () => number;
}

export interface LiveCardResult {
  stats: LiveStats;
  dashboard: Awaited<ReturnType<typeof buildDashboard>>;
  binding: BindReport;
  /** wireLive's result (absent when the controls could not be wired; see stats.note). */
  wired?: live.LiveResult;
}

/** The `ctl/*` variables of the prototype's collections, by name. */
async function controlVariables(api: PluginAPI, ours: (name: string) => boolean): Promise<Map<string, Variable>> {
  const colls = new Set((await api.variables.getLocalVariableCollectionsAsync()).filter((c) => ours(c.name)).map((c) => c.id));
  const out = new Map<string, Variable>();
  for (const v of await api.variables.getLocalVariablesAsync()) if (colls.has(v.variableCollectionId) && v.name.startsWith("ctl/")) out.set(v.name, v);
  return out;
}

export async function buildLiveView(i: LiveCardInput): Promise<LiveCardResult> {
  const t0 = i.now();
  const steps = 4;
  const page = i.where.pages.cpu;
  for (const p of uniquePages(i.where)) await p.loadAsync();
  await i.api.setCurrentPageAsync(page);

  // 1. Replace the previous Live view (only top-level `Live · *` layers), keeping its spot.
  const old = findDashboard(page);
  const at = old ? { x: old.x, y: old.y } : freeSpot(page);
  let removed = 0;
  for (const n of [...page.children])
    if (isLiveNode(n)) {
      n.remove();
      removed++;
    }
  if (removed) i.log("info", `removed ${removed} old Live layer(s)`);

  // 2. The dashboard (magnifiers instance the cells Build hardware drew, wherever they are).
  i.progress(0, steps, "drawing the dashboard");
  await i.breathe();
  const dashboard = await buildDashboard(i.api, page, i.net, {
    at,
    programs: PROGRAMS,
    source: i.source,
    programName: programName(i.source),
    cellPages: uniquePages(i.where),
    log: (m) => i.log("info", m),
  });

  // 3. Bindings to the CPU's variables and apply's control variables (before wireLive instances the
  //    component, so its copies carry them too).
  i.progress(1, steps, "binding lamps, arrows, highlights and magnifiers");
  await i.breathe();
  const varByNet = new Map([...i.vars].map(([n, r]) => [n, r.v]));
  const binding = bindDashboard(dashboard.component, i.net, varByNet, { ctl: await controlVariables(i.api, i.isOurCollection) });
  if (binding.unbound.length) i.log("error", `${binding.unbound.length} dashboard net(s) have no variable (Compile again), e.g. ${binding.unbound.slice(0, 3).join(", ")}`);
  if (binding.unknown.length) i.log("error", `${binding.unknown.length} dashboard layer(s) name nets that are not in the circuit, e.g. ${binding.unknown.slice(0, 3).join(", ")}`);
  for (const m of binding.magnifiers)
    if (m.missing.length) i.log("info", `magnifier ${m.prefix}: ${m.missing.length} gate(s) have no lit layer in the cell instance (redraw the cells?)`);

  // 4. The Present-mode runtime (lane L2).
  i.progress(2, steps, "wiring Step / Run / Stop / Reset, the clock pad and the disks");
  await i.breathe();
  let wired: live.LiveResult | undefined;
  let note: string | undefined;
  const wireLive = (live as Partial<typeof live>).wireLive;
  const cpuPrograms = (live as Partial<typeof live>).cpuPrograms;
  if (typeof wireLive !== "function" || typeof cpuPrograms !== "function")
    note = "src/prototype/live.ts does not export wireLive / cpuPrograms (lane L2): the dashboard is built and bound, but its controls do nothing";
  else if (!i.applied) note = "this plugin session has not compiled: press Compile, then Build Live view again to wire the controls (the dashboard is built and bound)";
  else {
    const c = dashboard.component;
    wired = await wireLive(i.api, i.plan, i.applied, dashboard, cpuPrograms(i.net, PROGRAMS, listingText), {
      page,
      at: { x: Math.round(c.x), y: Math.round(c.y + c.height + 200) },
      padCell: dashboard.nodes.padCell,
      bootName: "custom",
      bootListing: listingText(i.source),
      log: (m) => i.log("info", m),
    });
    // Live's own variables (ctl/program, ctl/listing, ctl/loading) exist now: bind their layers.
    const after = bindDashboard(c, i.net, varByNet, { ctl: await controlVariables(i.api, i.isOurCollection), varsOnly: true });
    binding.texts = after.texts;
    binding.byKind.var = after.byKind.var;
    binding.missingVars = after.missingVars;
  }
  if (note) i.log("error", `Live view: ${note}`);
  if (binding.missingVars.length) i.log("info", `no variable for ${binding.missingVars.join(", ")} (its layer stays static)`);

  i.progress(steps, steps, "done");
  const stats: LiveStats = {
    layers: dashboard.stats.layers,
    bound: binding.bound,
    unbound: binding.unbound.length,
    unknown: binding.unknown.length,
    texts: binding.texts,
    magnifiers: dashboard.nodes.magnifiers.filter((m) => m.instance).length,
    magnifierGates: binding.magnifiers.reduce((n, m) => n + m.gates, 0),
    wired: !!wired,
    ...(note ? { note } : {}),
    frames: wired ? Object.values(wired.frames).map((f) => f.name) : [],
    disks: dashboard.stats.disks,
    padCells: dashboard.stats.padCells,
    ...(wired ? { eventsPerTick: wired.eventsPerTick } : {}),
    ms: i.now() - t0,
  };
  i.log(
    wired ? "ok" : "info",
    `Live view: ${stats.layers} layers, ${stats.bound} lit layers bound (${stats.magnifierGates} gates in ${stats.magnifiers} magnifiers), ${stats.texts} texts` +
      (wired ? `; ▶ Present the flow "FigmaCPU Live" (${stats.eventsPerTick} events per tick: Step, the pad or Run)` : ""),
  );
  try {
    i.api.viewport.scrollAndZoomIntoView([dashboard.component]);
  } catch {
    /* cosmetic */
  }
  return { stats, dashboard, binding, ...(wired ? { wired } : {}) };
}
