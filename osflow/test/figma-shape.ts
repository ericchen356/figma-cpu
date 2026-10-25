// What Figma's prototype engine keeps of a reaction, and what it refuses or ignores, as measured in
// the editor: a CONDITIONAL is an IF with an optional ELSE (setReactionsAsync accepts more blocks,
// then silently keeps the first and turns the second into the ELSE), a CONDITIONAL inside another
// is rejected, a condition is an expression (EQUALS(var, true) works, nothing else was measured), a
// trigger carrying `deprecatedVersion` is rejected, an ON_CLICK next to MOUSE_DOWN / MOUSE_UP on one
// layer never fires, and a list of key codes is a chord (all held at once). The fake Plugin API
// stores whatever it is given, so the deploy tests check every stored reaction here.
import type { FakeNode } from "../../silicon/test/fake-figma";
import {
  runFigmaActions,
  type FigmaValue,
} from "../../silicon/src/prototype/emulate";
import { navigateWith } from "../../silicon/src/prototype/figma-actions";

export function figmaShapeErrors(nodes: Iterable<FakeNode>): string[] {
  const errors: string[] = [];
  const check = (where: string, acts: readonly Action[], nested: boolean) => {
    for (const a of acts) {
      if (a.type !== "CONDITIONAL") continue;
      const blocks = a.conditionalBlocks;
      if (nested) errors.push(`${where}: a CONDITIONAL inside a CONDITIONAL`);
      if (
        blocks.length < 1 ||
        blocks.length > 2 ||
        !blocks[0].condition ||
        (blocks.length === 2 && blocks[1].condition)
      )
        errors.push(
          `${where}: a CONDITIONAL of ${blocks.length} blocks (${blocks.map((b) => (b.condition ? "if" : "else")).join(", ")}): Figma keeps an IF and an ELSE`,
        );
      for (const b of blocks) {
        if (b.condition && b.condition.type !== "EXPRESSION")
          errors.push(
            `${where}: a condition of type ${b.condition.type}, not an expression`,
          );
        check(where, b.actions, true);
      }
    }
  };
  for (const n of nodes) {
    const types = n.reactions.map((r) => r.trigger?.type);
    if (
      types.includes("ON_CLICK") &&
      (types.includes("MOUSE_DOWN") || types.includes("MOUSE_UP"))
    )
      errors.push(
        `${n.name}: an ON_CLICK next to MOUSE_DOWN / MOUSE_UP never fires`,
      );
    n.reactions.forEach((r, i) => {
      const where = `${n.name} reaction ${i} (${r.trigger?.type})`;
      const t = r.trigger as { keyCodes?: readonly number[] } | null;
      if (t && "deprecatedVersion" in t)
        errors.push(`${where}: setReactionsAsync rejects deprecatedVersion`);
      if (t?.keyCodes && t.keyCodes.length !== 1)
        errors.push(
          `${where}: keys [${t.keyCodes}] are a chord (all held at once)`,
        );
      check(where, r.actions ?? [], false);
    });
  }
  return errors;
}

/** The emulator knows NODE but not CLOSE: CLOSE becomes a NODE to "close" so one hook sees both. */
export function withClose(acts: readonly Action[]): Action[] {
  return acts.map((a): Action => {
    if (a.type === "CLOSE") return navigateWith("close", "OVERLAY");
    if (a.type === "CONDITIONAL")
      return {
        ...a,
        conditionalBlocks: a.conditionalBlocks.map((b) => ({
          ...b,
          actions: withClose(b.actions),
        })),
      };
    return a;
  });
}

/** Like withClose, and the hook also sees how a NODE navigates: "OVERLAY <id>", "SWAP <id>", "CLOSE". */
const tagged = (acts: readonly Action[]): Action[] =>
  acts.map((a): Action => {
    if (a.type === "NODE")
      return { ...a, destinationId: `${a.navigation} ${a.destinationId}` };
    if (a.type === "CLOSE") return navigateWith("CLOSE", "OVERLAY");
    if (a.type === "CONDITIONAL")
      return {
        ...a,
        conditionalBlocks: a.conditionalBlocks.map((b) => ({
          ...b,
          actions: tagged(b.actions),
        })),
      };
    return a;
  });

const navigates = (a: Action): boolean =>
  a.type === "NODE" ||
  a.type === "CLOSE" ||
  (a.type === "CONDITIONAL" &&
    a.conditionalBlocks.some((b) => b.actions.some(navigates)));
/** A navigation is the last action of its event (or the last of a block of a CONDITIONAL that is). */
const lastOnly = (acts: readonly Action[]): boolean =>
  acts.every((a, i) =>
    i < acts.length - 1
      ? !navigates(a)
      : a.type !== "CONDITIONAL" ||
        a.conditionalBlocks.every((b) => lastOnly(b.actions)),
  );

/** An overlay a reaction continues through: a 1×1 frame without fills, whose one reaction is its
 * timer (AFTER_TIMEOUT 0.001 s). Returns what the timer runs. */
function timerOf(o: FakeNode): readonly Action[] {
  const [r, ...more] = o.reactions;
  const t = r?.trigger;
  if (
    o.width !== 1 ||
    o.height !== 1 ||
    (o.fills as unknown[]).length ||
    more.length ||
    t?.type !== "AFTER_TIMEOUT" ||
    t.timeout !== 0.001
  )
    throw new Error(
      `overlay ${o.name} is not a 1×1 empty frame whose one reaction is a 0.001 s timer`,
    );
  return r.actions ?? [];
}

/** Runs `actions` as one user event, the way the viewer runs a reaction that continues through
 * overlays: an event may end by opening one (NODE OVERLAY), whose timer runs the next part on a
 * fresh stack and ends by swapping in the next overlay (SWAP) or closing (CLOSE). Open overlays are
 * a stack (OVERLAY pushes, SWAP replaces the top, CLOSE pops), a timer fires when its overlay is
 * opened or swapped in, and nothing may be open when the user event is over. A navigation is only
 * ever the last action of its event. Returns the most actions one of those events ran (its
 * navigation included) and how many events it took. */
export function runEvent(
  actions: readonly Action[],
  values: Map<string, FigmaValue>,
  nodeById: (id: string) => FakeNode | null,
  maxEvents = 64,
): { worst: number; events: number } {
  const open: FakeNode[] = [];
  let worst = 0;
  let events = 0;
  /** One event; returns the overlay whose timer fires next, if any. */
  const run = (acts: readonly Action[]): FakeNode | null => {
    if (++events > maxEvents)
      throw new Error(`still continuing after ${maxEvents} events`);
    if (!lastOnly(acts))
      throw new Error("a navigation that is not the last action of its event");
    let due: FakeNode | null = null;
    const navigate = (to: string | null) => {
      const [how, id] = (to ?? "").split(" ");
      const o = id ? nodeById(id) : null;
      if (how === "CLOSE" && open.pop()) return;
      // to another top-level frame (the gate map): the event ends there, not a chain
      if (how === "NAVIGATE" && o && !open.length) return;
      if (how === "OVERLAY" && o) open.push(o);
      else if (how === "SWAP" && o && open.length) open[open.length - 1] = o;
      else
        throw new Error(
          `${how} ${o?.name ?? ""} with ${open.length} overlay(s) open: not a step of a chain`,
        );
      due = o;
    };
    worst = Math.max(
      worst,
      runFigmaActions(tagged(acts), values, { navigate }),
    );
    return due;
  };
  for (let o = run(actions); o;) o = run(timerOf(o));
  if (open.length)
    throw new Error(
      `${open.map((o) => o.name).join(", ")} still open after the event`,
    );
  return { worst, events };
}
