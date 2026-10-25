// Lane L1: the FigmaCPU Live dashboard (LIVE.md §2). Drawing and binding only; lane L2's
// src/prototype/live.ts attaches the reactions to the named layers.
export {
  type BindOptions,
  type BindReport,
  bindDashboard,
  buildDashboard,
  DASHBOARD_H,
  DASHBOARD_W,
  type Dashboard,
  type DashboardNodes,
  type DashboardOptions,
  type DashboardStats,
  findCellComponent,
  findDashboard,
  freeSpot,
  setListing,
} from "./dashboard";
export { DATAPATH_H, DATAPATH_W, datapathNets, drawDatapath, readSelect, signalColor, type Transfer, transfers } from "./datapath";
export { drawMicrocode, flagLineNet, type GridCell, gridNets, type GridRow, type MicrocodeTable, microcodeTable, opLineNet, short, SHORT, tLineNet } from "./grid";
export { collectPrefixed, componentPorts, DEFAULT_MAGNIFIERS, drawMagnifier, type MagnifierResult, type MagnifierSpec, type PrefixedBindings } from "./magnifier";
export * from "./names";
export { drawDisks, drawListing, drawPad, drawRamMatrix, drawSevenSeg, listingText, programBlurb } from "./panels";
export { L as LIVE_COLORS, type LiveFonts, loadLiveFonts } from "./style";
