// The frame stores every KEYS list unchanged, one reaction each (Figma reads a list as a chord).
// silicon's KEYS hold one code each today, so splitting a list and passing it through build the
// same file; a two-key list without a modifier (E+L) tells them apart.
import { expect, it, vi } from "vitest";

vi.mock("../../silicon/nathan/src/ui/spec", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("../../silicon/nathan/src/ui/spec")>();
  return { ...orig, KEYS: [...orig.KEYS, { codes: [69, 76], run: "esc" }] };
});

import { KEYS } from "../../silicon/nathan/src/ui/spec";
import { build } from "./nathan-checks";

it("stores every KEYS list on the frame unchanged, one reaction each", async () => {
  expect(KEYS[KEYS.length - 1]).toEqual({ codes: [69, 76], run: "esc" });
  const b = await build();
  const lists = b.present.reactions.flatMap((r) =>
    r.trigger?.type === "ON_KEY_DOWN" ? [[...r.trigger.keyCodes]] : [],
  );
  expect(lists).toEqual(KEYS.map((k) => k.codes));
}, 120000);
