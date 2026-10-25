// Canvas contract of the Live dashboard (LIVE.md §2). Layers are found by name, so lane L2
// (src/prototype/live.ts) can attach reactions and bindDashboard can (re)bind lights without
// any id bookkeeping; renaming a layer on the canvas retargets it, like the front panel.
//
//   Live · Dashboard           the component (instanced by lane L2 into Live · Main / Run / Load frames)
//   ctl/step ctl/run ctl/stop ctl/reset      control buttons (frames; L2 attaches reactions)
//   ctl/pad  ctl/pad/<i>                     the clock pad and its cells (MOUSE_ENTER = one chunk)
//   disk/<program>                           one button per program (+ disk/custom)
//   <kind>/<net> with a child `lit`          `lit`.visible ← the net's variable
//       kind: lamp | seg | arrow | row | col | tag     (net = any hierarchical name of the CPU)
//   var/<variable> with a child `lit`        `lit`.visible ← a BOOLEAN control variable (e.g. ctl/running)
//   var/<variable> (a TEXT)                  characters ← a STRING control variable (ctl/tickText, ctl/phaseText)
//   mag/<prefix> holding an INSTANCE         every gate `lit` / `wire/<net>/lit` inside the instance ← net <prefix>/<path>
//   var/ctl/listing, var/ctl/program          listing / program name texts (STRING ctl/listing, ctl/program from
//                                            lane L2, set by a disk load; setListing writes the static fallback)
//   Live · Pad cell                          the component every ctl/pad/<i> is an instance of, so lane L2 can
//                                            store the pad's reaction once (wireLive's `padCell` option)

export const LIVE_PREFIX = "Live · ";
export const DASHBOARD_NAME = `${LIVE_PREFIX}Dashboard`;

export const CTL_STEP = "ctl/step";
export const CTL_RUN = "ctl/run";
export const CTL_STOP = "ctl/stop";
export const CTL_RESET = "ctl/reset";
export const CTL_PAD = "ctl/pad";
export const padCellName = (i: number) => `${CTL_PAD}/${i}`;
export const DISK_PREFIX = "disk/";
export const diskName = (program: string) => `${DISK_PREFIX}${program}`;
export const CUSTOM_DISK = "custom";
export const PAD_CELL_NAME = `${LIVE_PREFIX}Pad cell`;
export const LISTING = "var/ctl/listing";
export const PROGRAM_NAME = "var/ctl/program";

/** Kinds of net-bound containers. */
export const NET_KINDS = ["lamp", "seg", "arrow", "row", "col", "tag"] as const;
export type NetKind = (typeof NET_KINDS)[number];
const NET_RE = new RegExp(`^(${NET_KINDS.join("|")})\\/(.+)$`);
const VAR_RE = /^var\/(.+)$/;
const MAG_RE = /^mag\/(.+)$/;

export const bound = (kind: NetKind, net: string) => `${kind}/${net}`;
export const varBound = (variable: string) => `var/${variable}`;
export const magName = (prefix: string) => `mag/${prefix.replace(/\/+$/, "")}`;

/** "lamp/pc[2]" → { kind: "lamp", net: "pc[2]" }; null for other names. */
export function parseBound(name: string): { kind: NetKind; net: string } | null {
  const m = NET_RE.exec(name);
  return m ? { kind: m[1] as NetKind, net: m[2] } : null;
}

/** "var/ctl/running" → "ctl/running". */
export function parseVar(name: string): string | null {
  return VAR_RE.exec(name)?.[1] ?? null;
}

/** "mag/alu/add/fa3" → "alu/add/fa3/" (the flat-path prefix of the instance's gates). */
export function parseMag(name: string): string | null {
  const m = MAG_RE.exec(name);
  return m ? `${m[1]}/` : null;
}

/** Top-level layers that belong to the Live view (the only ones a rebuild may replace). */
export const isLiveNode = (n: BaseNode) => n.name.startsWith(LIVE_PREFIX);
