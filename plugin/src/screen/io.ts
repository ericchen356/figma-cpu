// LANE: screen. Memory-mapped IO. The engine delegates any address in 0xF000..0xF005 here:
//   read(addr) -> number | undefined (undefined = not an IO address, use RAM)
//   write(addr, v) -> boolean (false = not handled, use RAM)
import { MEM } from "../contracts/spec";

const A = MEM.io;

export class Io {
  private mx = 0; private my = 0; private btn = 0; private key = 0; private tick = 0;
  private seed: number;
  constructor(seed = 0x1234abcd) { this.seed = seed >>> 0 || 1; }

  setMouse(x: number, y: number, btn: 0 | 1 | boolean = 0) {
    this.mx = Math.max(0, Math.min(MEM.vramW - 1, Math.floor(x)));
    this.my = Math.max(0, Math.min(MEM.vramH - 1, Math.floor(y)));
    this.btn = btn ? 1 : 0;
  }
  setKey(code: number) { this.key = code & 255; }
  /** Call once per rendered frame (the TICK register counts frames). */
  tickFrame() { this.tick = (this.tick + 1) & 255; }

  private nextRand(): number {
    let x = this.seed;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    this.seed = x || 1;
    return this.seed & 255;
  }

  read(addr: number): number | undefined {
    switch (addr) {
      case A.MOUSE_X: return this.mx;
      case A.MOUSE_Y: return this.my;
      case A.MOUSE_BTN: return this.btn;
      case A.KEY: return this.key;
      case A.TICK: return this.tick;
      case A.RAND: return this.nextRand();
      default: return undefined;
    }
  }

  /** Only KEY is CPU-writable (writing ack clears it); TICK may be reset. Other IO registers ignore writes (still "handled"). */
  write(addr: number, v: number): boolean {
    switch (addr) {
      case A.KEY: if ((v & 255) === 0) this.key = 0; return true;
      case A.TICK: this.tick = v & 255; return true;
      case A.MOUSE_X: case A.MOUSE_Y: case A.MOUSE_BTN: case A.RAND: return true;
      default: return false;
    }
  }
}
