// Drives the real plugin main thread (src/main.ts) with a simulated UI, like a user would.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FakeFigma } from "./fake-figma";
import { program } from "./helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

it("paint: load, Turbo, mouse drag → pixels reach VRAM messages and the canvas", async () => {
  const fig = new FakeFigma(["Eric"]) as any;
  (globalThis as any).figma = fig;
  const root = join(__dirname, "..", "..");
  execFileSync("node", [join(root, "tools/draw-machine/build.mjs"), "--page", "Eric"]);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction("figma", readFileSync(join(root, "tools/draw-machine/use-figma.js"), "utf8"))(fig);

  const posted: any[] = [];
  fig.showUI = () => {};
  fig.ui = { postMessage: (m: any) => posted.push(m), onmessage: null };
  fig.on = () => {};
  fig.base64Encode = (b: Uint8Array) => Buffer.from(b).toString("base64");
  fig.base64Decode = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
  (globalThis as any).__html__ = "";
  await import("../src/main");
  await sleep(50);
  expect(posted.find((m) => m.type === "fatal")).toBeUndefined();
  const send = (m: any) => fig.ui.onmessage(m);
  // the simulated UI answers every vram message with a png, like ui.ts does
  const answer = () => {
    for (const m of posted.splice(0)) if (m.type === "vram") { send({ type: "png", bytes: new Uint8Array([137, 80, 78, 71]) }); vrams.push(m.vram); }
  };
  const vrams: Uint8Array[] = [];

  send({ type: "load", source: program("paint") });
  answer();
  send({ type: "run", mode: "turbo" });
  for (let i = 0; i < 10; i++) { await sleep(20); answer(); }
  send({ type: "mouse", samples: [[10, 20, true]] });
  for (let i = 0; i < 20; i++) { await sleep(20); answer(); }
  send({ type: "mouse", samples: [[11, 20, true]] });
  for (let i = 0; i < 20; i++) { await sleep(20); answer(); }
  send({ type: "pause" });
  answer();

  const last = vrams[vrams.length - 1];
  console.log("vram messages:", vrams.length, "pixel(10,20) =", last?.[20 * 128 + 10], "images on canvas:", fig.images.length);
  expect(last[20 * 128 + 10]).toBe(7);
  expect(last[20 * 128 + 11]).toBe(7);
});

it("a fast stroke and a quick click are queued, so the program sees every sample", async () => {
  const fig = (globalThis as any).figma;
  const posted: any[] = [];
  fig.ui.postMessage = (m: any) => posted.push(m);
  const send = (m: any) => fig.ui.onmessage(m);
  send({ type: "load", source: program("paint") });
  // While paused: a 40-pixel stroke in one burst, then a separate quick click.
  const stroke = Array.from({ length: 40 }, (_, i) => [20 + i, 50, true]);
  send({ type: "mouse", samples: [...stroke, [59, 50, false]] });
  send({ type: "mouse", samples: [[100, 10, true], [100, 10, false]] });
  let vram: Uint8Array | undefined;
  for (let i = 0; i < 3000; i++) {
    send({ type: "step-i" });
    for (const m of posted.splice(0)) if (m.type === "vram") { vram = m.vram; send({ type: "png", bytes: new Uint8Array([137]) }); }
  }
  for (let x = 20; x < 62; x++) expect(vram![50 * 128 + x], `stroke pixel x=${x}`).toBe(7);
  expect(vram![10 * 128 + 100]).toBe(7);
}, 15000);
