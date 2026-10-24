import { describe, expect, it } from "vitest";
import { SCREEN_H, SCREEN_W, VRAM_START, type CPU } from "../src/cpu";
import { boot, readProgram, run } from "./helpers";

const A = 0;
const pixel = (cpu: CPU, x: number, y: number) =>
  cpu.mem[VRAM_START + y * SCREEN_W + x];
const vram = (cpu: CPU) =>
  cpu.mem.slice(VRAM_START, VRAM_START + SCREEN_W * SCREEN_H);

/** Reference painter: what the screen should look like after filling these rects in order. */
function paint(rects: [number, number, number, number, number][], bg = 0) {
  const out = new Uint8Array(SCREEN_W * SCREEN_H).fill(bg);
  for (const [x, y, w, h, c] of rects)
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) out[j * SCREEN_W + i] = c;
  return out;
}

/** Bounding box + count of pixels with colour c. */
function find(cpu: CPU, c: number) {
  let n = 0,
    x0 = 999,
    y0 = 999,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < SCREEN_H; y++)
    for (let x = 0; x < SCREEN_W; x++)
      if (pixel(cpu, x, y) === c) {
        n++;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return { n, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

describe("demo programs", () => {
  it("count.asm counts A to 10", () => {
    const cpu = boot(readProgram("count.asm"));
    run(cpu);
    expect(cpu.regs[A]).toBe(10);
  });

  it("fib.asm writes Fibonacci numbers until 8-bit overflow", () => {
    const cpu = boot(readProgram("fib.asm"));
    run(cpu);
    expect([...cpu.mem.slice(0x4000, 0x400e)]).toEqual([
      1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 0,
    ]);
  });

  it("rect.asm draws exactly the shape table", () => {
    const cpu = boot(readProgram("rect.asm"));
    const steps = run(cpu);
    expect(vram(cpu)).toEqual(
      paint([
        [8, 8, 112, 80, 1],
        [20, 20, 44, 30, 12],
        [46, 38, 50, 28, 8],
        [80, 14, 30, 50, 11],
      ]),
    );
    expect(steps).toBeLessThan(80_000);
  });

  it("bounce.asm moves the square one pixel per tick and bounces", () => {
    const cpu = boot(readProgram("bounce.asm"));
    const frame = (steps = 5000) => {
      for (let i = 0; i < steps; i++) cpu.step();
      expect(cpu.error).toBeNull();
    };
    frame(100_000); // background fill + first frame (10,10 -> 11,11), then waits for TICK
    expect(find(cpu, 10)).toEqual({ n: 64, x: 11, y: 11, w: 8, h: 8 });
    expect(find(cpu, 1).n).toBe(SCREEN_W * SCREEN_H - 64);
    for (let t = 1; t <= 5; t++) {
      cpu.io.tick = t;
      frame();
    }
    expect(find(cpu, 10)).toMatchObject({ n: 64, x: 16, y: 16 });
    // run it into the bottom edge (y max = 88) and check it comes back up
    for (let t = 6; t <= 90; t++) {
      cpu.io.tick = t;
      frame();
    }
    const after = find(cpu, 10);
    expect(after.n).toBe(64);
    expect(after.y).toBeLessThan(88);
    expect(cpu.mem[0x4013]).toBe(0xff); // DY flipped to -1
  });

  it("paint.asm paints at the mouse with the chosen colour", () => {
    const cpu = boot(readProgram("paint.asm"));
    cpu.io.key = "8".charCodeAt(0);
    for (let i = 0; i < 200; i++) cpu.step();
    expect(cpu.io.key).toBe(0);
    Object.assign(cpu.io, { mouseX: 10, mouseY: 20, mouseBtn: 1 });
    for (let i = 0; i < 200; i++) cpu.step();
    expect([
      pixel(cpu, 10, 20),
      pixel(cpu, 11, 21),
      pixel(cpu, 12, 20),
    ]).toEqual([8, 8, 0]);
    Object.assign(cpu.io, { mouseBtn: 0, mouseX: 50, mouseY: 50 });
    for (let i = 0; i < 200; i++) cpu.step();
    expect(pixel(cpu, 50, 50)).toBe(0);
  });
});
