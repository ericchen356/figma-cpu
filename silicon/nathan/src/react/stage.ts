// Splitting one heavy reaction across the three triggers of ONE click.
//
// The viewer's per-event limit is unknown (501 actions ran, 2,001 crashed), and a physical click
// is three separate events on the same layer: MOUSE_DOWN, MOUSE_UP, ON_CLICK, each with its own
// reaction and its own stack. Variables persist between events, so a reaction cut at top-level
// action boundaries and run piece by piece in that order does exactly what the whole did, with no
// timer hop and about a third of the actions per event. Two rules keep it exact:
//   · the screen refresh stays in the LAST piece, so the click layers do not change (and vanish)
//     before the final trigger fires;
//   · the pieces never reorder or skip: the cuts only choose where one event ends.
import type { PlanAction } from "../../../src/prototype/types";
import { staticSize } from "./synth";

/** Cuts `actions` into `parts` consecutive lists of about equal static size. Cuts fall only on
 * top-level boundaries at or before `screenAt`, and every list gets at least one action. */
export function splitStages(
  actions: PlanAction[],
  screenAt: number,
  parts = 3,
): PlanAction[][] {
  const n = actions.length;
  if (parts < 2 || n < parts) return [actions];
  const cost = actions.map((a) => staticSize([a]));
  const prefix = [0];
  for (const c of cost) prefix.push(prefix[prefix.length - 1] + c);
  const limit = Math.min(screenAt, n - 1);
  const seg = (a: number, b: number) => prefix[b] - prefix[a];
  if (parts === 2) {
    let best = 1;
    for (let i = 1; i <= limit; i++)
      if (Math.max(seg(0, i), seg(i, n)) < Math.max(seg(0, best), seg(best, n)))
        best = i;
    return [actions.slice(0, best), actions.slice(best)];
  }
  if (parts !== 3) throw new Error("splitStages supports 2 or 3 parts");
  let best: [number, number] = [1, 2];
  let bestMax = Infinity;
  for (let i = 1; i < limit; i++)
    for (let j = i + 1; j <= limit; j++) {
      const m = Math.max(seg(0, i), seg(i, j), seg(j, n));
      if (m < bestMax) {
        bestMax = m;
        best = [i, j];
      }
    }
  return [
    actions.slice(0, best[0]),
    actions.slice(best[0], best[1]),
    actions.slice(best[1]),
  ];
}
