// Integration: REAL assembler + screen Io + test oracle (independent of src/engine). Proves the demo programs
// do what the PRD says, so the engine lane only has to prove it executes the same bytes.
import { describe, it, expect } from "vitest";
import rectAsm from "../programs/rect.asm?raw";
import bounceAsm from "../programs/bounce.asm?raw";
import { assemble } from "../src/assembler/asm";
import { run } from "./helpers/oracle";
import { Io } from "../src/screen/io";
import { MEM } from "../src/contracts/spec";

const vramOf = (mem: Uint8Array) => mem.slice(MEM.vramStart, MEM.vramStart + MEM.vramW * MEM.vramH);

describe("rect.asm", () => {
  it("assembles clean and paints exactly the 80x40 rectangle at (20,20) in colour 8", () => {
    const r = assemble(rectAsm);
    expect(r.errors).toEqual([]);
    const s = run(r.bytes, { maxSteps: 100000 });
    expect(s.halted).toBe(true);
    const v = vramOf(s.mem);
    let painted = 0;
    for (let y = 0; y < MEM.vramH; y++) for (let x = 0; x < MEM.vramW; x++) {
      const inside = x >= 20 && x < 100 && y >= 20 && y < 60;
      expect(v[y * MEM.vramW + x]).toBe(inside ? 8 : 0);
      if (inside) painted++;
    }
    expect(painted).toBe(3200);
  });
});

describe("bounce.asm", () => {
  it("assembles clean", () => expect(assemble(bounceAsm).errors).toEqual([]));

  it("one 8x8 square, always on screen, moving each TICK, bouncing off all four walls", () => {
    const r = assemble(bounceAsm);
    const io = new Io();
    const FRAME = 3000; // oracle instructions per TICK (draw+erase cost ~1000)
    const seen: { x: number; y: number }[] = [];
    let bounces = { xr: false, xl: false, yb: false, yt: false }, prev: { x: number; y: number } | null = null;
    run(r.bytes, {
      maxSteps: FRAME * 400,
      ioRead: (a) => io.read(a),
      ioWrite: (a, v) => io.write(a, v),
      onStep: (step, mem) => {
        if (step % FRAME !== 0) return;
        // program is idle in its wait loop here => consistent snapshot
        if (step > FRAME) {
          const x = mem[0x4000], y = mem[0x4001], v = vramOf(mem);
          expect(x).toBeLessThanOrEqual(120);
          expect(y).toBeLessThanOrEqual(88);
          let count = 0;
          for (let i = 0; i < v.length; i++) if (v[i] === 8) {
            count++;
            const px = i % MEM.vramW, py = Math.floor(i / MEM.vramW);
            expect(px >= x && px < x + 8 && py >= y && py < y + 8).toBe(true);
          }
          expect(count).toBe(64);
          if (prev) {
            expect(Math.abs(x - prev.x)).toBeLessThanOrEqual(1);
            expect(Math.abs(y - prev.y)).toBeLessThanOrEqual(1);
            expect(x !== prev.x || y !== prev.y).toBe(true);
          }
          if (x === 120) bounces.xr = true; if (x === 0) bounces.xl = true;
          if (y === 88) bounces.yb = true; if (y === 0) bounces.yt = true;
          seen.push({ x, y }); prev = { x, y };
        }
        io.tickFrame();
      },
    });
    expect(seen.length).toBeGreaterThan(300);
    expect(bounces).toEqual({ xr: true, xl: true, yb: true, yt: true });
  });
});
