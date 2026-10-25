// Builds the live Figma OS into a page: the chip's wires as variables, the reactions of every control
// (catalog.ts), the overlays that continue long reactions and draw the slots' displays, and the screen
// (screen.ts, render.ts). Build time only: in Present, Figma's prototype engine does all the work.
//
// How an event runs in the viewer:
//   · a control's trigger runs its reaction (logic, register commits, the shared screen lines) and
//     sets `dirty` for each layer slot whose registers loaded; a reaction longer than one event of
//     the budget runs in timed overlays instead, one part per event;
//   · then the display tail of each dirty slot runs in its own timed overlay: the slot's decimal
//     digits, placement bits and colour lines, once for the whole file rather than inside every
//     reaction;
//   · a canvas press only records its cell; the release records its own and opens the gesture
//     dispatch, which picks the gesture (tool, layer count, click or drag) and swaps in its run.
import { varName } from "../../../src/prototype";
import {
  createVariables,
  removeCollections,
  setFlows,
  type VariableSpec,
} from "../../../src/prototype/draw";
import {
  afterTimeout,
  aliasData,
  boolData,
  conditional,
  exprData,
  figmaActions,
  floatData,
  keyDown,
  mouseDown,
  mouseEnter,
  mouseUp,
  navigateWith,
  onClick,
  setVariable,
} from "../../../src/prototype/figma-actions";
import type { PlanAction } from "../../../src/prototype/types";
import type { FlatNetlist } from "../../../src/netlist/types";
import { buildEditor } from "../../../../osflow/src/editor";
import { osuiChip, osuiNetlist, osuiPowerOn, type OsuiChip } from "../cpu/chip";
import { SLOTS, type Line } from "../cpu/disp";
import { Fonts, textStyles, type Layer } from "../layers";
import {
  CORNERS,
  compileRun,
  cut,
  displayTails,
  liveRuns,
  planIds,
  slotOfNet,
  type CompiledRun,
  type PlanIds,
  type Run,
  type UiVar,
} from "./catalog";
import { liveMenus, MENU_PREFIX } from "./menus";
import { renderLive } from "./render";
import { romValue, slotRom, type RomTable, type RomValue } from "./rom";
import {
  LIVE,
  liveScreen,
  type Act,
  type CaptureData,
  type LiveNode,
} from "./screen";

export const COLLECTION = "Figma OS · CPU";
/** Prefix of every overlay frame the build makes (chains, display tails, the gesture dispatch). */
export const OVERLAY_PREFIX = "os-ui · overlay · ";
export const FLOW = "Figma OS (gate-level CPU)";
/** Plugin data key under which a layer records its acts (screen.ts Act[]). */
/** Shared plugin data (namespace, key) under which a layer records its acts: shared, so a build run
 * from a page script (which has no plugin id) can write it and any plugin can read it. */
export const ACTS_NS = "osui";
export const ACTS_KEY = "acts";

export interface LiveOptions {
  /** Most actions one event may run (the viewer's stack: 700 is safe on a cold page). */
  budget: number;
  breathe?: () => Promise<void>;
  log?: (m: string) => void;
  progress?: (done: number, total: number, label: string) => void;
}

export interface LiveStats {
  gates: number;
  variables: number;
  runs: number;
  storedActions: number;
  overlays: number;
  layers: number;
  bound: number;
  longestEvent: number;
  problems: string[];
}

const nameOfRun = (r: Run, chip: OsuiChip) =>
  JSON.stringify(
    r.steps.map((s) => [
      chip.syn.codes.get(s.event),
      s.given ?? {},
      s.pointer ?? "",
    ]),
  );

/** Removes a previous live build's frames from the page (and, with `variables`, its variables). */
export async function removeLive(
  api: PluginAPI,
  page: PageNode,
  breathe: () => Promise<void> = async () => {},
  variables = false,
): Promise<number> {
  let n = 0;
  for (const c of [...page.children])
    if (
      c.name === LIVE ||
      c.name.startsWith(OVERLAY_PREFIX) ||
      c.name.startsWith(MENU_PREFIX)
    ) {
      c.remove();
      if (++n % 50 === 0) await breathe();
    }
  if (!variables) return n;
  // variables a few hundred at a time: removing thousands at once can drop the server connection
  const colls = (await api.variables.getLocalVariableCollectionsAsync()).filter(
    isOurs,
  );
  const ids = new Set(colls.map((c) => c.id));
  const vars = (await api.variables.getLocalVariablesAsync()).filter((v) =>
    ids.has(v.variableCollectionId),
  );
  for (let i = 0; i < vars.length; i++) {
    vars[i].remove();
    if (i % 250 === 249) await breathe();
  }
  n += await removeCollections(api, COLLECTION);
  return n;
}

const isOurs = (c: { name: string }) =>
  c.name === COLLECTION || c.name.startsWith(`${COLLECTION} · `);
const PER_COLLECTION = 4000;

/** The variables of `specs`, in order: a previous build's variable of the same name and type is
 * kept (its value set again), the rest are created, the ones no longer named are removed. Creating
 * thousands of variables is the slowest part of a build, and a rebuild mostly needs the same. */
async function syncVariables(
  api: PluginAPI,
  specs: VariableSpec[],
  breathe: () => Promise<void>,
  log: (m: string) => void,
): Promise<Variable[]> {
  const colls = (await api.variables.getLocalVariableCollectionsAsync()).filter(
    isOurs,
  );
  const ids = new Set(colls.map((c) => c.id));
  const existing = new Map<string, Variable>();
  for (const v of await api.variables.getLocalVariablesAsync())
    if (ids.has(v.variableCollectionId)) existing.set(v.name, v);
  const want = new Map(specs.map((sp) => [sp.name, sp.type]));
  let k = 0;
  for (const [name, v] of [...existing])
    if (want.get(name) !== v.resolvedType) {
      v.remove();
      existing.delete(name);
      if (++k % 250 === 0) await breathe();
    }
  const size = new Map<string, number>(colls.map((c) => [c.id, 0]));
  for (const v of existing.values())
    size.set(
      v.variableCollectionId,
      (size.get(v.variableCollectionId) ?? 0) + 1,
    );
  const all = [...colls];
  const roomy = () => {
    let c = all.find((x) => (size.get(x.id) ?? 0) < PER_COLLECTION);
    if (!c) {
      c = api.variables.createVariableCollection(
        all.length ? `${COLLECTION} · ${all.length + 1}` : COLLECTION,
      );
      all.push(c);
      size.set(c.id, 0);
    }
    return c;
  };
  const out: Variable[] = [];
  let made = 0;
  for (let i = 0; i < specs.length; i++) {
    const sp = specs[i];
    let v = existing.get(sp.name);
    if (!v) {
      const c = roomy();
      v = api.variables.createVariable(sp.name, c, sp.type);
      size.set(c.id, (size.get(c.id) ?? 0) + 1);
      made++;
    }
    const coll = all.find((c) => c.id === v!.variableCollectionId)!;
    v.setValueForMode(coll.defaultModeId, sp.init);
    out.push(v);
    if (i % 250 === 249) {
      log(`  variables: ${i + 1}/${specs.length} (${made} new)`);
      await breathe();
    }
  }
  // collections a previous build filled and this one emptied
  for (const c of all) if ((size.get(c.id) ?? 0) === 0) c.remove();
  return out;
}

export async function buildLive(
  api: PluginAPI,
  page: PageNode,
  data: CaptureData,
  o: LiveOptions,
): Promise<{
  frame: FrameNode;
  stats: LiveStats;
  acts: Map<string, Act[]>;
  varOfNet: Map<number, Variable>;
}> {
  const breathe = o.breathe ?? (async () => {});
  const log = o.log ?? (() => {});
  const progress = o.progress ?? (() => {});
  const steps = 7;

  progress(0, steps, "the chip");
  const chip = osuiChip();
  const net: FlatNetlist = osuiNetlist(chip);
  const init = osuiPowerOn(net, chip);
  const ids: PlanIds = planIds(net);
  const slotOf = slotOfNet(net);
  await breathe();

  // ---------- reactions ----------
  progress(1, steps, "one reaction per control");
  const runs = liveRuns(chip);
  const compiled = new Map<string, CompiledRun>();
  const bySig = new Map<string, CompiledRun>();
  let k = 0;
  for (const r of runs.values()) {
    const sig = nameOfRun(r, chip);
    let c = bySig.get(sig);
    if (!c) {
      c = compileRun(chip, ids, r, slotOf);
      bySig.set(sig, c);
    }
    compiled.set(r.name, c);
    if (++k % 10 === 0) {
      progress(1, steps, `reactions ${k}/${runs.size}`);
      await breathe();
    }
  }
  const tails = displayTails(chip, ids, slotOf);
  await breathe();

  // ---------- variables ----------
  progress(2, steps, "variables");
  const screenData = liveScreen(data, chip.display, keyCodes(chip));
  const used = new Set<number>();
  const walkPlan = (l: PlanAction[]) => {
    for (const a of l) {
      if ("set" in a) {
        used.add(a.set);
        walkExpr(a.to);
      } else {
        walkExpr(a.if);
        walkPlan(a.then);
        walkPlan(a.else ?? []);
      }
    }
  };
  const walkExpr = (e: unknown): void => {
    if (!e || typeof e !== "object") return;
    const o2 = e as Record<string, unknown>;
    if (typeof o2.var === "number") used.add(o2.var);
    for (const v of Object.values(o2)) if (typeof v === "object") walkExpr(v);
  };
  for (const c of bySig.values()) walkPlan(c.actions);
  for (const t of tails) {
    walkPlan(t.blocks);
    walkPlan(t.clear);
  }
  // the display's look-up tables, and the lines their cases read
  const roms = chip.display.slots.map((sl, i) => slotRom(sl, i));
  const lineNets = new Set<string>();
  const walkLines = (n: LiveNode) => {
    if (n.visible && "net" in n.visible) lineNets.add(n.visible.net);
    n.children?.forEach(walkLines);
  };
  walkLines(screenData.root);
  const menus = liveMenus(data, chip.display);
  for (const m of menus) walkLines(m.root);
  const walkDisplay = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walkDisplay);
    else if (x && typeof x === "object") {
      if ("net" in x) lineNets.add((x as { net: string }).net);
      else Object.values(x).forEach(walkDisplay);
    }
  };
  // the gesture dispatch and the look-up tables read register and display lines too
  walkDisplay(chip.display);
  const netOf = (name: string) => {
    const id = net.aliases.get(name);
    if (id === undefined) throw new Error(`no net ${name}`);
    return id;
  };
  for (const name of lineNets) used.add(netOf(name));
  for (const name of [
    "g_tCreate",
    "g_tSelect",
    ...[0, 1, 2, 3].map((i) => `g_n[${i}]`),
    ...[0, 1, 2, 3].map((i) => `g_sel[${i}]`),
  ])
    used.add(netOf(name));
  for (const e of ids.extra) used.add(e.id);
  const extraName = new Map(ids.extra.map((e) => [e.id, e.name]));
  const order = [...used].filter((id) => id > 1).sort((a, b) => a - b);
  await removeLive(api, page, breathe);
  const specs: VariableSpec[] = order.map((id) => ({
    name: extraName.get(id) ?? varName(net.netNames[id]),
    type: "BOOLEAN",
    init: id < net.netNames.length ? init[id] === 1 : false,
  }));
  // the look-up tables' outputs, at what the power-on lines select
  const powerLine = (l: Line) =>
    "k" in l ? l.k === 1 : init[netOf(l.net)] === 1;
  const romSpecs = roms.flat().map((t): VariableSpec => {
    const v = romValue(t, powerLine);
    const blank =
      t.type === "STRING"
        ? ""
        : t.type === "FLOAT"
          ? 0
          : { r: 0, g: 0, b: 0, a: 1 };
    return {
      name: t.name,
      type: t.type as VariableSpec["type"],
      init: (v ?? blank) as VariableSpec["init"],
    };
  });
  specs.push(...romSpecs);
  const vars = await syncVariables(api, specs, breathe, log);
  const varIds = new Map<number, string>(
    order.map((id, i) => [id, vars[i].id]),
  );
  const romVars = new Map(
    romSpecs.map((r, k) => [r.name, vars[order.length + k]]),
  );
  const variableOfNet = new Map(order.map((id, i) => [id, vars[i]]));
  const vid = (id: number) => {
    const v = varIds.get(id);
    if (v === undefined)
      throw new Error(
        `no variable for ${extraName.get(id) ?? net.netNames[id]}`,
      );
    return v;
  };
  const isTrue = (id: number) =>
    exprData("EQUALS", [aliasData(vid(id)), boolData(true)]);
  const isFalse = (id: number) =>
    exprData("EQUALS", [aliasData(vid(id)), boolData(false)]);
  const and = (xs: VariableData[]): VariableData =>
    xs.length === 1
      ? xs[0]
      : exprData("AND", [
          and(xs.slice(0, xs.length >> 1)),
          and(xs.slice(xs.length >> 1)),
        ]);
  const lineIs = (l: Line, on: boolean): VariableData =>
    "k" in l
      ? boolData((l.k === 1) === on)
      : on
        ? isTrue(netOf(l.net))
        : isFalse(netOf(l.net));
  const ui = (v: UiVar) => ids.ui[v];
  const convert = (a: PlanAction[]) => figmaActions(a, varIds);
  await breathe();

  // ---------- overlays ----------
  progress(3, steps, "overlays");
  const frames: FrameNode[] = [];
  const overlay = (name: string) => {
    const f = api.createFrame();
    f.name = `${OVERLAY_PREFIX}${name}`;
    f.resize(1, 1);
    f.fills = [];
    page.appendChild(f);
    frames.push(f);
    return f;
  };
  const pending: Array<[FrameNode, Action[]]> = [];
  let longest = 0;
  const event = (acts: Action[]) => {
    longest = Math.max(longest, worst(acts));
    return acts;
  };
  const BUDGET = o.budget;
  const RESERVE = 2 * SLOTS + 4;

  // display tails: per slot, its gate blocks, its look-up tables (each behind the load enables of
  // the fields it shows), the enables cleared; the last part goes on to the next dirty slot (or
  // closes)
  const romValueData = (t: RomTable, v: RomValue): VariableData =>
    t.type === "STRING"
      ? ({
          type: "STRING",
          resolvedType: "STRING",
          value: v as string,
        } as VariableData)
      : t.type === "FLOAT"
        ? floatData(v as number)
        : ({
            type: "COLOR",
            resolvedType: "COLOR",
            value: v,
          } as unknown as VariableData);
  const tailActions = tails.map((t, s): Action[] => {
    const lookups: Action[] = [];
    for (const table of roms[s]) {
      const enables = table.fields
        .map((f) => t.men.get(f))
        .filter((m): m is number => m !== undefined);
      if (!enables.length) continue;
      const loaded =
        enables.length === 1
          ? isTrue(enables[0])
          : enables
              .map((m) => isTrue(m))
              .reduce((a, b) => exprData("OR", [a, b]));
      for (const c of table.cases)
        lookups.push(
          conditional(and([loaded, ...c.when.map(([l, v]) => lineIs(l, v))]), [
            setVariable(
              romVars.get(table.name)!.id,
              romValueData(table, c.value),
            ),
          ]),
        );
    }
    return [...convert(t.blocks), ...lookups, ...convert(t.clear)];
  });
  const tailParts = tailActions.map((a) =>
    cutActions(a, BUDGET - 3 * SLOTS - 30),
  );
  const tailFirst: FrameNode[] = [];
  const tailFrames = tailParts.map((parts, s) =>
    parts.map((_, p) => overlay(`display ${s}.${p + 1}`)),
  );
  tailFrames.forEach((fs) => tailFirst.push(fs[0]));
  /** Swaps in the first dirty slot's tail among `slots` (in order), else closes. */
  const toTails = (slots: number[], nav: "OVERLAY" | "SWAP"): Action[] => {
    const out: Action[] = [];
    slots.forEach((s, k2) =>
      out.push(
        conditional(
          and([
            isTrue(ids.dirty[s]),
            ...slots.slice(0, k2).map((j) => isFalse(ids.dirty[j])),
          ]),
          [navigateWith(tailFirst[s].id, nav)],
        ),
      ),
    );
    if (nav === "SWAP")
      out.push(
        slots.length
          ? conditional(and(slots.map((j) => isFalse(ids.dirty[j]))), [
              { type: "CLOSE" } as Action,
            ])
          : ({ type: "CLOSE" } as Action),
      );
    return out;
  };
  tailParts.forEach((parts, s) =>
    parts.forEach((part, p) => {
      const last = p === parts.length - 1;
      pending.push([
        tailFrames[s][p],
        event([
          ...part,
          ...(last
            ? toTails(
                Array.from({ length: SLOTS - s - 1 }, (_, j) => s + 1 + j),
                "SWAP",
              )
            : [navigateWith(tailFrames[s][p + 1].id, "SWAP")]),
        ]),
      ]);
    }),
  );

  // runs: inline in their trigger when they fit one event, else every part in an overlay
  const chainOf = new Map<CompiledRun, FrameNode>();
  const triggerOf = new Map<CompiledRun, Action[]>();
  const chained = (c: CompiledRun): FrameNode => {
    let first = chainOf.get(c);
    if (first) return first;
    const parts = cut(c.actions, BUDGET - RESERVE, 1);
    const fs = parts.map((_, p) => overlay(`${c.name} ${p + 1}`));
    parts.forEach((part, p) =>
      pending.push([
        fs[p],
        event([
          ...convert(part),
          ...(p < parts.length - 1
            ? [navigateWith(fs[p + 1].id, "SWAP")]
            : toTails(c.touched, "SWAP")),
        ]),
      ]),
    );
    first = fs[0];
    chainOf.set(c, first);
    return first;
  };
  const fromMenu = new Map<CompiledRun, Action[]>();
  /** A run's trigger actions: on the screen it opens overlays; in an open menu it swaps the menu
   * out for them, or closes it when nothing follows. */
  const trigger = (run: string, inOverlay = false): Action[] => {
    const c = compiled.get(run);
    if (!c)
      throw new Error(
        `the screen runs ${run}, which the catalogue does not have`,
      );
    const memo = inOverlay ? fromMenu : triggerOf;
    let t = memo.get(c);
    if (t) return t;
    const nav = inOverlay ? "SWAP" : "OVERLAY";
    t =
      c.size + RESERVE <= BUDGET
        ? event([...convert(c.actions), ...toTails(c.touched, nav)])
        : [navigateWith(chained(c).id, nav)];
    memo.set(c, t);
    return t;
  };

  // the gesture dispatch: which gesture the release ends, by the tool, the layer count, the press
  const dispatch = overlay("gesture");
  const reg = (name: string, value: number, bits: number) =>
    Array.from({ length: bits }, (_, i) =>
      (value >> i) & 1
        ? isTrue(netOf(`${name}[${i}]`))
        : isFalse(netOf(`${name}[${i}]`)),
    );
  const pressed = isTrue(ui("pressed"));
  const onCell = isFalse(ui("pHandle"));
  const variants: Array<[VariableData[], string]> = [];
  for (let n = 0; n < SLOTS; n++)
    for (const [same, kind] of [
      [true, "click"],
      [false, "drag"],
    ] as const)
      variants.push([
        [
          onCell,
          isTrue(netOf("g_tCreate")),
          ...reg("g_n", n, 4),
          same ? isTrue(ui("same")) : isFalse(ui("same")),
        ],
        `gesture/create/${n}/${kind}`,
      ]);
  variants.push([
    [onCell, isTrue(netOf("g_tCreate")), ...reg("g_n", SLOTS, 4)],
    "gesture/create/full",
  ]);
  variants.push([
    [onCell, isTrue(netOf("g_tSelect")), isTrue(ui("same"))],
    "gesture/select/click",
  ]);
  variants.push([
    [onCell, isTrue(netOf("g_tSelect")), isFalse(ui("same"))],
    "gesture/select/drag",
  ]);
  CORNERS.forEach((c, k2) => {
    const corner = [
      k2 & 1 ? isTrue(ui("pC0")) : isFalse(ui("pC0")),
      k2 & 2 ? isTrue(ui("pC1")) : isFalse(ui("pC1")),
    ];
    variants.push([
      [isTrue(ui("pHandle")), ...corner, isTrue(ui("same"))],
      `gesture/handle/${c}/click`,
    ]);
    variants.push([
      [isTrue(ui("pHandle")), ...corner, isFalse(ui("same"))],
      `gesture/handle/${c}/drag`,
    ]);
  });
  const clearPress = setVariable(vid(ui("pressed")), boolData(false));
  pending.push([
    dispatch,
    event([
      ...variants.map(([cond, run]) =>
        conditional(and([pressed, ...cond]), [
          clearPress,
          navigateWith(chained(compiled.get(run)!).id, "SWAP"),
        ]),
      ),
      conditional(pressed, [clearPress, { type: "CLOSE" } as Action]),
    ]),
  ]);

  // ---------- the screen ----------
  progress(4, steps, "the screen");
  const fonts = new Fonts(api);
  const captured: Layer[] = [];
  const collect = (n: LiveNode) => {
    if (n.layer) captured.push(n.layer);
    n.children?.forEach(collect);
  };
  collect(screenData.root);
  for (const m of menus) collect(m.root);
  const { families, weights } = textStyles(captured);
  families.add("Inter");
  for (const w of [400, 450, 500, 550]) weights.add(w);
  await fonts.load(families, weights);
  const problems: string[] = [];
  /** Every layer that does something, and what (for the self-test). */
  const registry = new Map<string, Act[]>();
  const setBits = (prefix: "pX" | "pY" | "rX" | "rY", v: number) =>
    [0, 1, 2, 3].map((i) =>
      setVariable(
        vid(ui(`${prefix}${i}` as UiVar)),
        boolData(((v >> i) & 1) === 1),
      ),
    );
  // a layer over the canvas cells takes the press itself (else the cell under it does and its
  // click never fires) and acts on the release; either way no canvas gesture is pending after it
  const tap = (over: boolean | undefined, actions: Action[]): Reaction[] =>
    over
      ? [
          { trigger: mouseDown(), actions: [clearPress] },
          { trigger: mouseUp(), actions: [clearPress, ...actions] },
        ]
      : [{ trigger: onClick(), actions }];
  const reactionsOf = (acts: Act[]): Reaction[] =>
    acts.flatMap((a): Reaction | Reaction[] => {
      switch (a.on) {
        case "click":
          return tap(a.over, trigger(a.run));
        case "block":
          return { trigger: mouseDown(), actions: [clearPress] };
        case "key":
          return { trigger: keyDown(a.codes), actions: trigger(a.run) };
        case "press":
          return {
            trigger: mouseDown(),
            actions: [
              ...setBits("pX", a.cell[0]),
              ...setBits("pY", a.cell[1]),
              setVariable(vid(ui("pressed")), boolData(true)),
              setVariable(vid(ui("pHandle")), boolData(false)),
            ],
          };
        case "release": {
          // released where it was pressed (a press on a handle is never a cell's)
          const same = and([
            isFalse(ui("pHandle")),
            ...[0, 1, 2, 3].flatMap((i) =>
              (["pX", "pY"] as const).map((p) => {
                const bit = ((a.cell[p === "pX" ? 0 : 1] >> i) & 1) === 1;
                return bit
                  ? isTrue(ui(`${p}${i}` as UiVar))
                  : isFalse(ui(`${p}${i}` as UiVar));
              }),
            ),
          ]);
          return {
            trigger: mouseUp(),
            actions: [
              ...setBits("rX", a.cell[0]),
              ...setBits("rY", a.cell[1]),
              setVariable(vid(ui("same")), same),
              conditional(pressed, [navigateWith(dispatch.id, "OVERLAY")]),
            ],
          };
        }
        case "handle":
          return {
            trigger: mouseDown(),
            actions: [
              setVariable(vid(ui("pressed")), boolData(true)),
              setVariable(vid(ui("pHandle")), boolData(true)),
              setVariable(vid(ui("pC0")), boolData((a.corner & 1) === 1)),
              setVariable(vid(ui("pC1")), boolData((a.corner & 2) === 2)),
            ],
          };
        case "handleUp":
          return {
            trigger: mouseUp(),
            actions: [
              setVariable(vid(ui("same")), boolData(true)),
              conditional(pressed, [navigateWith(dispatch.id, "OVERLAY")]),
            ],
          };
        case "open":
          return tap(a.over, [navigateWith(menuFrame(a.menu).id, "OVERLAY")]);
        case "item":
          return { trigger: onClick(), actions: trigger(a.run, true) };
        case "sub":
          return {
            trigger: a.click ? onClick() : mouseEnter(),
            actions: [navigateWith(menuFrame(a.menu).id, "SWAP")],
          };
        case "dismiss":
          return { trigger: onClick(), actions: [{ type: "CLOSE" } as Action] };
      }
    });
  const menuFrames = new Map<string, FrameNode>();
  const menuFrame = (id: string) => {
    const f = menuFrames.get(id);
    if (!f) throw new Error(`no menu ${id}`);
    return f;
  };
  const ctx = {
    api,
    fonts,
    problems,
    line: (l: Line): Variable | boolean =>
      "k" in l ? l.k === 1 : variableOfNet.get(netOf(l.net))!,
    variable: (name: string) => romVars.get(name),
    reactions: (acts: Act[], node: SceneNode) => {
      registry.set(node.id, acts);
      // what the layer does, for the self-test (which reads the document, not this build)
      try {
        node.setSharedPluginData(ACTS_NS, ACTS_KEY, JSON.stringify(acts));
      } catch (e) {
        problems.push(
          `${node.name} — acts: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      return reactionsOf(acts);
    },
    breathe,
  };
  // the menus first: the screen's openers navigate to them. A menu's frame takes a frame in the
  // render; its reactions are set when every menu exists (they swap to one another)
  const deferred: Array<[SceneNode, Act[]]> = [];
  let menuLayers = 0;
  for (const m of menus) {
    const mr = await renderLive(
      {
        ...ctx,
        reactions: (acts: Act[], node: SceneNode) => (
          deferred.push([node, acts]),
          []
        ),
      },
      page,
      m.root,
    );
    menuFrames.set(m.id, mr.root as FrameNode);
    menuLayers += mr.created;
  }
  for (const [node, acts] of deferred) {
    registry.set(node.id, acts);
    try {
      node.setSharedPluginData(ACTS_NS, ACTS_KEY, JSON.stringify(acts));
    } catch (e) {
      problems.push(
        `${node.name} — acts: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    await (node as SceneNode & ReactionMixin).setReactionsAsync(
      reactionsOf(acts),
    );
  }
  // Escape closes a menu
  for (const f of menuFrames.values())
    await f.setReactionsAsync([
      ...(f.reactions ?? []),
      { trigger: keyDown([27]), actions: [{ type: "CLOSE" } as Action] },
    ]);
  const r = await renderLive(ctx, page, screenData.root);
  const frame = r.root as FrameNode;
  frame.x = 0;
  frame.y = -(frame.height + 480);
  [...menuFrames.values()].forEach((f, i) => {
    f.x = frame.x + (i % 6) * (frame.width + 120);
    f.y = frame.y - (Math.floor(i / 6) + 1) * (frame.height + 240);
  });
  frames.forEach((f, i) => {
    f.x = frame.x + frame.width + 120 + Math.floor(i / 100) * 24;
    f.y = frame.y + (i % 100) * 8;
  });

  // ---------- reactions on the overlays, the keys, the warm-up ----------
  // the keys' reactions first: a long one adds overlays whose timers are set below
  const keyReactions: Reaction[] = reactionsOf(
    screenData.keys.map((kk) => ({ on: "key", codes: kk.codes, run: kk.run })),
  );
  progress(5, steps, "overlay reactions");
  for (let i = 0; i < pending.length; i++) {
    const [f, acts] = pending[i];
    await f.setReactionsAsync([
      { trigger: afterTimeout(0.001), actions: acts },
    ]);
    if (i % 25 === 24) await breathe();
  }
  progress(6, steps, "keys and the flow");
  // a fresh viewer is slow at its first long reaction and its first overlay: run a few hundred
  // throwaway actions and open and close an empty overlay before the first click
  const warm = overlay("warm-up");
  await warm.setReactionsAsync([
    { trigger: afterTimeout(0.001), actions: [{ type: "CLOSE" } as Action] },
  ]);
  await frame.setReactionsAsync([
    ...keyReactions,
    {
      trigger: keyDown([91, 75]),
      actions: [navigateWith(menuFrame("palette").id, "OVERLAY")],
    },
    {
      trigger: afterTimeout(0.001),
      actions: [
        conditional(isFalse(ui("warm")), [
          setVariable(vid(ui("warm")), boolData(true)),
          ...Array.from({ length: 300 }, () =>
            setVariable(
              vid(ui("scratch")),
              exprData("NOT", [aliasData(vid(ui("scratch")))]),
            ),
          ),
          navigateWith(warm.id, "OVERLAY"),
        ]),
      ],
    },
  ]);
  setFlows(page, [{ nodeId: frame.id, name: FLOW }]);
  const overlayIds = new Set(
    [...frames, ...menuFrames.values()].map((f) => f.id),
  );
  page.flowStartingPoints = page.flowStartingPoints.filter(
    (f) => !overlayIds.has(f.nodeId),
  );

  let stored = 0;
  for (const [, acts] of pending) stored += worst(acts, true);
  for (const t of triggerOf.values()) stored += worst(t, true);
  progress(7, steps, "done");
  return {
    frame,
    acts: registry,
    varOfNet: variableOfNet,
    stats: {
      gates: net.gates.length,
      variables: specs.length,
      runs: compiled.size,
      storedActions: stored,
      overlays: frames.length,
      layers: r.created + menuLayers,
      bound: r.bound,
      longestEvent: longest,
      problems,
    },
  };
}

/** Cuts Figma actions into events of at most `budget` actions run in the worst case, between
 * top-level actions (one action for the control that continues each event is kept free). */
function cutActions(actions: Action[], budget: number): Action[][] {
  const parts: Action[][] = [[]];
  let size = 0;
  for (const a of actions) {
    const n = worst([a]);
    if (n + 1 > budget)
      throw new Error(
        `one action of ${n} actions does not fit an event of ${budget}`,
      );
    if (parts[parts.length - 1].length && size + n + 1 > budget) {
      parts.push([]);
      size = 0;
    }
    parts[parts.length - 1].push(a);
    size += n;
  }
  return parts;
}

/** Executed actions in the worst case (every branch taken the costliest way), or the stored size. */
function worst(actions: readonly Action[], all = false): number {
  let n = 0;
  for (const a of actions)
    n +=
      a.type === "CONDITIONAL"
        ? 1 +
          (all
            ? a.conditionalBlocks.reduce(
                (m, b) => m + worst(b.actions, true),
                0,
              )
            : Math.max(0, ...a.conditionalBlocks.map((b) => worst(b.actions))))
        : 1;
  return n;
}

/** The editor's key events: run name → the chord of key codes (osflow's editor, which the chip is). */
function keyCodes(chip: OsuiChip): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const e of buildEditor({ target: "hardware" }).events)
    if (e.trigger.type === "key" && chip.syn.codes.has(e.id))
      out.set(
        e.id.slice(0, -"#key".length),
        (e.trigger as { keyCodes: number[] }).keyCodes,
      );
  return out;
}
