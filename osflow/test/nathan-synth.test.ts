// What the generator does with reactions too long for one event, checked against silicon's
// synthesizer directly. The default build needs none of it, so the deploy test cannot see a slip
// here: a reaction may be torn (its register writes cut across events) only when none of its
// syntheses (the catalog's own, Q = D, Q = D with the logic kept out of the register blocks) has
// a commit tail that fits one event, and the alternatives must bring every reaction the catalog
// makes too long under a generous latch budget back to one event.
import { describe, expect, it } from "vitest";
import { generate } from "../deploy/nathan";
import { FakeFigma } from "../../silicon/test/fake-figma";
import { nathanLibrary, nathanNetlist } from "../../silicon/nathan/src/hw";
import {
  buildCatalog,
  reactionSpecs,
} from "../../silicon/nathan/src/react/catalog";
import {
  staticSize,
  synthesize,
  type Reaction,
} from "../../silicon/nathan/src/react/synth";

const net = nathanNetlist(nathanLibrary());
const LEAD = 4; // a click reaction first copies the hover column into PX

/** How many reactions no synthesis keeps whole at `part` actions an event. */
function mustTear(part: number, budget?: number): number {
  const catalog = buildCatalog(net, reactionSpecs(), {
    latch: "auto",
    budget: budget ?? part,
    alias: true,
  });
  let n = 0;
  for (const [name, e] of catalog) {
    const first = name.startsWith("click/") ? LEAD : 0;
    const fits = (r: Reaction) =>
      first + staticSize(r.actions) <= part ||
      staticSize(r.actions.slice(r.commitAt)) + 1 <= part;
    const syntheses = [
      e.reaction,
      ...([{ latch: "direct" }, { latch: "direct", inside: false }] as const).map(
        (alt) =>
          synthesize(net, e.spec.ties, {
            ...alt,
            alias: true,
            given: e.spec.given,
          }),
      ),
    ];
    if (!syntheses.some(fits)) n++;
  }
  return n;
}

describe("long reactions", () => {
  it("a latch budget above the part still leaves nothing continued or torn at the default part", () => {
    const { stats } = generate({ budget: 1600 });
    expect({ continued: stats.continued, torn: stats.torn }).toEqual({
      continued: 0,
      torn: 0,
    });
  }, 120000);

  for (const [part, budget] of [
    [300, undefined],
    [175, undefined],
    [300, 1600],
    [700, 1600],
  ] as const)
    it(`part ${part}, budget ${budget ?? "= part"}: tears only what no synthesis keeps whole`, () => {
      expect(generate({ part, budget }).stats.torn).toBe(mustTear(part, budget));
    }, 300000);

  it("a rebuild on the page of an older build with chains leaves only the new build", async () => {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const fake = new FakeFigma(["Page 1"]);
    fake.autoFlows = true;
    (globalThis as { figma?: unknown }).figma = fake;
    const chained = generate({ part: 400 });
    expect(chained.stats.continued).toBeGreaterThan(0);
    for (const c of chained.chunks) await new AsyncFunction("figma", c.code)(fake);
    expect(fake.currentPage.children.length).toBeGreaterThan(1);
    const plain = generate();
    for (const c of plain.chunks) await new AsyncFunction("figma", c.code)(fake);
    const page = fake.currentPage;
    expect(page.children.map((n) => n.name)).toEqual([
      plain.names.frame,
      plain.names.machine,
    ]);
    expect(page.flowStartingPoints.map((f) => f.nodeId)).toEqual([
      page.children[0].id,
    ]);
  }, 300000);
});
