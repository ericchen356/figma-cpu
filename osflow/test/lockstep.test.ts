// The flow against the reducer it was written from. Random sequences of editor actions run on
// os-ui's `reduce` and, as the UI events that cause them, on the flow's interpreter. After every
// single action the flow's variables must read back as exactly the reducer's state, and every
// value the flow writes must fit its variable's declared width.
//
// os-ui is still changing, so this suite is also the alarm that the flow is out of date: when the
// reducer's behaviour moves, the first failing run names the actions that expose it.
// test/hardware.test.ts runs the same checks on the hardware target.
import { describe, expect, it } from "vitest";
import { decode, viewOf } from "../src/codec";
import { buildEditor } from "../src/editor";
import { initialState } from "../../os-ui/src/model";
import { replay, Runner, SCRIPTS, Session } from "./support";

describe("lockstep with the os-ui reducer", () => {
  it("starts in the reducer's initial state", () => {
    const flow = new Runner(buildEditor());
    expect(decode(flow.vars, 40)).toEqual(viewOf(initialState()));
  });

  for (const K of [40, 3]) {
    it(`matches after every action of 40 random sessions (K = ${K})`, () => {
      let events = 0;
      for (let seed = 1; seed <= 40; seed++)
        events += replay(seed, 120, { K }).events;
      expect(events).toBeGreaterThan(8000);
    });
  }

  for (const [name, script] of Object.entries(SCRIPTS))
    it(name, () => script(new Session()));
});
