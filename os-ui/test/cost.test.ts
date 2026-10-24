import { describe, expect, it } from "vitest";
import { BUDGET, CHUNK_TARGET, HANDLER_COST, REDRAW, eventCost, worstEventCost } from "../src/cost";
import { dirtyCells, dirtyRedraw } from "../src/cost";
import { initialState, reduce, Action, State } from "../src/model";

const run = (s: State, ...as: Action[]) => as.reduce(reduce, s);

describe("prototype action budget", () => {
  it("every handler plus a full redraw fits in the budget", () => {
    for (const [name, cost] of Object.entries(HANDLER_COST)) {
      expect(cost + REDRAW, name).toBeLessThan(BUDGET);
    }
  });
  it("the worst single event stays under the budget with headroom", () => {
    expect(worstEventCost()).toBeLessThan(BUDGET);
    expect(worstEventCost()).toBeLessThan(CHUNK_TARGET);
  });
  it("estimates a cost for an event", () => {
    const s = initialState();
    expect(eventCost(s, { t: "tool", tool: "rect" })).toBeLessThan(100);
  });
});

describe("dirty-rect redraw", () => {
  const withRect = () =>
    run(
      initialState(),
      { t: "tool", tool: "rect" },
      { t: "down", x: 2, y: 2 },
      { t: "move", x: 4, y: 3 },
      { t: "up" },
    ); // 3x2 rect at (2,2)

  it("a one-cell nudge dirties only the old and new footprint", () => {
    const s = withRect();
    const next = reduce(s, { t: "key", key: "ArrowRight" });
    expect(dirtyCells(s, next).size).toBe(8); // 3x2 shifted by 1 = 8 distinct cells
  });
  it("a nudge costs a fraction of a full redraw", () => {
    const s = withRect();
    const c = eventCost(s, { t: "key", key: "ArrowRight" });
    expect(c).toBeLessThan(REDRAW / 8);
  });
  it("an event that changes nothing on the canvas dirties nothing", () => {
    const s = withRect();
    expect(dirtyCells(s, reduce(s, { t: "tool", tool: "frame" })).size).toBe(0);
  });
  it("load and new still pay for a full redraw", () => {
    expect(eventCost(withRect(), { t: "new" })).toBeGreaterThanOrEqual(REDRAW);
  });
  it("a worst-case dirty set equals a full redraw", () => {
    expect(dirtyRedraw(14 * 10)).toBeGreaterThanOrEqual(REDRAW);
  });
});
