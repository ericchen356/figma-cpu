// Replay runtime for a gate-level machine in Figma. Every chunk the generator writes is this
// file followed by one `return await RT.<step>(<data>)`, run against the Plugin API of a
// figma.com editor tab (deploy/README.md; no plugin installed). It only builds: at prototype time
// Figma's engine does all the computing. Data is compact: wires (boolean variables) are numbered, an action is
// `<wire>:<expr>` or `?<expr>{actions}{else}`, an expression is prefix notation over wires
// (base 36), T/F and the operators ! & | = ^ (NOT AND OR EQUALS NOT_EQUAL).
const RT = (() => {
  const REG = { family: "Inter", style: "Regular" };
  const BOLD = { family: "Inter", style: "Bold" };
  const hex = (h) => {
    const n = parseInt(h.slice(1), 16);
    return {
      r: ((n >> 16) & 255) / 255,
      g: ((n >> 8) & 255) / 255,
      b: (n & 255) / 255,
    };
  };
  const solid = (h, opacity) => [
    opacity === undefined
      ? { type: "SOLID", color: hex(h) }
      : { type: "SOLID", color: hex(h), opacity },
  ];
  const fonts = async () => {
    await figma.loadFontAsync(REG);
    await figma.loadFontAsync(BOLD);
  };

  /** Every wire variable by its number (names end in /<number>). */
  async function wires(prefix) {
    const byIdx = [];
    for (const v of await figma.variables.getLocalVariablesAsync("BOOLEAN")) {
      if (!v.name.startsWith(prefix)) continue;
      const m = /\/(\d+)$/.exec(v.name);
      if (m) byIdx[Number(m[1])] = v;
    }
    return byIdx;
  }
  /** Number and text variables by name (counters and their text twins). */
  async function named() {
    const m = new Map();
    for (const v of await figma.variables.getLocalVariablesAsync())
      if (v.resolvedType !== "BOOLEAN") m.set(v.name, v);
    return m;
  }
  const aliasT = (v) => ({
    type: "VARIABLE_ALIAS",
    resolvedType: v.resolvedType,
    value: { type: "VARIABLE_ALIAS", id: v.id },
  });
  const alias = (v) => ({
    type: "VARIABLE_ALIAS",
    resolvedType: "BOOLEAN",
    value: { type: "VARIABLE_ALIAS", id: v.id },
  });
  const lit = (b) => ({ type: "BOOLEAN", resolvedType: "BOOLEAN", value: b });
  const expr = (fn, args) => ({
    type: "EXPRESSION",
    resolvedType: "BOOLEAN",
    value: { expressionFunction: fn, expressionArguments: args },
  });
  const FN = { "&": "AND", "|": "OR", "=": "EQUALS", "^": "NOT_EQUAL" };

  /** Parses an action list into Plugin API actions. */
  function parser(byIdx, byName) {
    /** `@inc:n`, `@zero:n`, `@show:text:n:prefix`, `@str:text:value`: counters and their text. */
    const special = ([op, a, b, c]) => {
      const v = (name) => {
        const x = byName && byName.get(name);
        if (!x) throw new Error(`no variable ${name}`);
        return x;
      };
      const set = (x, value) => ({
        type: "SET_VARIABLE",
        variableId: x.id,
        variableValue: value,
      });
      if (op === "inc")
        return set(v(a), {
          type: "EXPRESSION",
          resolvedType: "FLOAT",
          value: {
            expressionFunction: "ADDITION",
            expressionArguments: [
              aliasT(v(a)),
              { type: "FLOAT", resolvedType: "FLOAT", value: 1 },
            ],
          },
        });
      if (op === "zero")
        return set(v(a), { type: "FLOAT", resolvedType: "FLOAT", value: 0 });
      if (op === "show")
        return set(v(a), {
          type: "EXPRESSION",
          resolvedType: "STRING",
          value: {
            expressionFunction: "ADDITION",
            expressionArguments: [
              { type: "STRING", resolvedType: "STRING", value: c || "" },
              aliasT(v(b)),
            ],
          },
        });
      if (op === "str")
        return set(v(a), {
          type: "STRING",
          resolvedType: "STRING",
          value: b || "",
        });
      // overlays: open one, swap the open one for another, close it (a loop of timed overlays runs a machine)
      if (op === "open" || op === "swap") {
        const f = topFrame(a);
        if (!f) throw new Error(`no frame ${a}`);
        return {
          type: "NODE",
          destinationId: f.id,
          navigation: op === "open" ? "OVERLAY" : "SWAP",
          transition: null,
        };
      }
      if (op === "close") return { type: "CLOSE" };
      throw new Error(`unknown special ${op}`);
    };
    return (s) => {
      let i = 0;
      const fail = (why) => {
        throw new Error(
          `${why} at ${i}: …${s.slice(Math.max(0, i - 24), i)}⟨${s.slice(i, i + 24)}⟩`,
        );
      };
      const wire = () => {
        const j = i;
        while (i < s.length && /[0-9a-z]/.test(s[i])) i++;
        if (j === i) fail("expected a wire");
        const v = byIdx[parseInt(s.slice(j, i), 36)];
        if (!v) fail(`no wire ${s.slice(j, i)}`);
        return v;
      };
      const ex = () => {
        const c = s[i];
        if (c === "T" || c === "F") {
          i++;
          return lit(c === "T");
        }
        if (c === "!") {
          i++;
          return expr("NOT", [ex()]);
        }
        if (FN[c]) {
          i++;
          const a = ex();
          if (s[i++] !== ",") fail("expected ,");
          return expr(FN[c], [a, ex()]);
        }
        return alias(wire());
      };
      const expect = (ch) => {
        if (s[i++] !== ch) fail(`expected ${ch}`);
      };
      const list = () => {
        const out = [];
        while (i < s.length && s[i] !== "}") {
          if (s[i] === "@") {
            let end = i;
            while (end < s.length && s[end] !== ";" && s[end] !== "}") end++;
            out.push(special(s.slice(i + 1, end).split(":")));
            i = end;
          } else if (s[i] === "?") {
            i++;
            const condition = ex();
            expect("{");
            const then = list();
            expect("}");
            const blocks = [{ condition, actions: then }];
            // Figma keeps an IF and an optional ELSE: a second condition would be silently dropped
            if (s[i] === "?") fail("a second condition in one CONDITIONAL");
            if (s[i] === "{") {
              i++;
              blocks.push({ actions: list() });
              expect("}");
            }
            out.push({ type: "CONDITIONAL", conditionalBlocks: blocks });
          } else {
            const v = wire();
            expect(":");
            out.push({
              type: "SET_VARIABLE",
              variableId: v.id,
              variableValue: ex(),
            });
          }
          if (s[i] === ";") i++;
        }
        return out;
      };
      const out = list();
      if (i !== s.length) fail("trailing input");
      return out;
    };
  }

  const TRIGGER = {
    c: () => ({ type: "ON_CLICK" }),
    d: () => ({ type: "MOUSE_DOWN", delay: 0 }),
    u: () => ({ type: "MOUSE_UP", delay: 0 }),
    e: () => ({ type: "MOUSE_ENTER", delay: 0 }),
    k: (codes) => ({
      type: "ON_KEY_DOWN",
      device: "KEYBOARD",
      keyCodes: codes,
    }),
    t: (codes) => ({ type: "AFTER_TIMEOUT", timeout: codes[0] }),
  };

  const page = () => figma.currentPage;
  const topFrame = (name) => page().children.find((n) => n.name === name);

  /** Node paths below `root`: "/name" segments, "#k" for the k-th sibling of the same name. */
  function paths(root) {
    const m = new Map();
    const walk = (n, p) => {
      const seen = {};
      for (const c of n.children || []) {
        const k = (seen[c.name] =
          (seen[c.name] === undefined ? -1 : seen[c.name]) + 1);
        const q = `${p}/${c.name}${k ? `#${k}` : ""}`;
        m.set(q, c);
        if ("children" in c) walk(c, q);
      }
    };
    walk(root, "");
    return m;
  }

  // ---------- steps ----------

  /** Wires: one BOOLEAN variable per net, in collections of at most 4000. */
  async function vars(d) {
    for (const c of await figma.variables.getLocalVariableCollectionsAsync())
      if (c.name === d.coll || c.name.startsWith(`${d.coll} · `)) c.remove();
    let coll = null;
    let made = 0;
    for (let i = 0; i < d.units.length; i++) {
      if (i % 4000 === 0)
        coll = figma.variables.createVariableCollection(
          i === 0 ? d.coll : `${d.coll} · ${i / 4000 + 1}`,
        );
      const v = figma.variables.createVariable(
        `${d.prefix}${d.names[d.units[i]]}/${i}`,
        coll,
        "BOOLEAN",
      );
      v.setValueForMode(coll.defaultModeId, d.init[i] === "1");
      made++;
    }
    for (const [name, type, init] of d.extra || []) {
      const v = figma.variables.createVariable(name, coll, type);
      v.setValueForMode(coll.defaultModeId, init);
      made++;
    }
    return { made, collections: Math.ceil(made / 4000) };
  }

  /** The frame Present opens, its header, the empty editor root and the chart area. */
  async function frame(d) {
    await fonts();
    const old = topFrame(d.name);
    if (old) old.remove();
    const f = figma.createFrame();
    f.name = d.name;
    f.resize(d.w, d.h);
    f.fills = solid(d.bg);
    f.clipsContent = true;
    page().appendChild(f);
    f.x = d.x;
    f.y = d.y;
    for (const [s, x, y, size, color, bold] of d.texts) {
      const t = figma.createText();
      t.fontName = bold ? BOLD : REG;
      t.fontSize = size;
      t.characters = s;
      t.fills = solid(color);
      f.appendChild(t);
      t.x = x;
      t.y = y;
    }
    const byIdx = await wires(d.prefix);
    const root = build(d.root, f, null, byIdx, d.hover, await named());
    root.x = d.rootX;
    root.y = d.rootY;
    const chart = figma.createFrame();
    chart.name = d.chart.name;
    chart.resize(d.chart.w, d.chart.h);
    chart.fills = solid(d.chart.bg);
    f.appendChild(chart);
    chart.x = d.chart.x;
    chart.y = d.chart.y;
    // overlays: top-level frames beside this one, opened by the reactions. A previous build's
    // overlays go first, by the prefixes the generator names them with.
    for (const n of [...page().children])
      if (
        n.type === "FRAME" &&
        (d.clear || []).some((p) => n.name.startsWith(p))
      )
        n.remove();
    const overlays = [];
    for (const [i, o] of (d.overlays || []).entries()) {
      const old = topFrame(o.n);
      if (old) old.remove();
      const node = build(o, page(), null, byIdx, d.hover, await named());
      node.x = d.x + d.w + 200;
      node.y = d.y + i * (o.h + 40);
      overlays.push(node.id);
    }
    page().flowStartingPoints = [{ nodeId: f.id, name: d.flow }];
    return { frame: f.id, editor: root.id, chart: chart.id, overlays };
  }

  /** One node of the screen spec (the port of silicon/nathan/src/ui/render.ts) and its subtree. */
  function build(s, into, parentSpec, byIdx, hover, byName) {
    if (Array.isArray(s)) return cell(s, into, hover);
    const node =
      s.t === "f"
        ? figma.createFrame()
        : s.t === "r"
          ? figma.createRectangle()
          : s.t === "e"
            ? figma.createEllipse()
            : s.t === "v"
              ? figma.createVector()
              : figma.createText();
    node.name = s.n;
    if (s.t === "x") {
      node.fontName = s.tx[2] ? BOLD : REG;
      node.fontSize = s.tx[1] || 12;
      node.characters = s.tx[0];
      node.fills = solid(s.tx[3] || "#FFFFFF");
    } else if (s.t === "v") {
      // a vector is sized by its path (`p`, SVG path data from its own origin)
      node.vectorPaths = [{ windingRule: "NONZERO", data: s.p }];
      node.fills = s.f ? solid(s.f) : [];
      node.strokes = [];
    } else {
      // a size the spec leaves out keeps Figma's default 100 (a FILL axis is sized by its parent)
      if (s.w !== undefined || s.h !== undefined)
        node.resize(
          Math.max(s.w ?? node.width, 0.01),
          Math.max(s.h ?? node.height, 0.01),
        );
      node.fills = s.f ? solid(s.f) : [];
      node.strokes = s.s ? solid(s.s) : [];
      if (s.s) {
        node.strokeWeight = s.sw || 1;
        node.strokeAlign = "INSIDE";
      }
      if (s.r) node.cornerRadius = s.r;
      if (s.t === "f") {
        node.clipsContent = !!s.c;
        if (s.L) {
          node.layoutMode = s.L.d === "H" ? "HORIZONTAL" : "VERTICAL";
          node.itemSpacing = s.L.g || 0;
          const pad = s.L.p || 0;
          node.paddingLeft =
            node.paddingRight =
            node.paddingTop =
            node.paddingBottom =
              pad;
          node.primaryAxisAlignItems = s.L.m || "MIN";
          node.counterAxisAlignItems = s.L.x || "MIN";
        }
      }
    }
    if (s.hd) node.visible = false;
    into.appendChild(node);
    const inAutoLayout = !!(parentSpec && parentSpec.L);
    if (!inAutoLayout && s.x !== undefined && s.y !== undefined) {
      node.x = s.x;
      node.y = s.y;
    }
    if (inAutoLayout) {
      if (s.a) {
        node.layoutPositioning = "ABSOLUTE";
        node.x = s.x || 0;
        node.y = s.y || 0;
      } else {
        node.layoutSizingHorizontal = s.sh || "FIXED";
        node.layoutSizingVertical = s.sv || "FIXED";
      }
    } else if (s.t === "f" && s.L) {
      node.layoutSizingHorizontal = s.sh === "HUG" ? "HUG" : "FIXED";
      node.layoutSizingVertical = s.sv === "HUG" ? "HUG" : "FIXED";
    }
    if (s.v !== undefined) {
      const v = byIdx[s.v];
      if (!v) throw new Error(`no wire ${s.v} for ${s.n}`);
      node.setBoundVariable("visible", v);
    }
    if (s.vs) {
      const t = byName && byName.get(s.vs);
      if (!t) throw new Error(`no text variable ${s.vs} for ${s.n}`);
      node.setBoundVariable("characters", t);
    }
    for (const c of s.ch || []) build(c, node, s, byIdx, hover, byName);
    return node;
  }

  /** A canvas cell: hovering it stores its column (and its row, unless that is null) in the hover
   * wires; its parent takes the click. */
  function cell([c, r, x, y, w, h], into, hover) {
    const node = figma.createFrame();
    node.name = r === null ? `cell/${c}` : `cell/${c},${r}`;
    node.resize(w, h);
    node.fills = [];
    node.clipsContent = false;
    into.appendChild(node);
    node.x = x;
    node.y = y;
    pendingCells.push([node, c, r, hover]);
    return node;
  }
  const pendingCells = [];

  /** Appends screen subtrees under a parent path of the editor, in order, then wires their cells. */
  async function ui(d) {
    await fonts();
    const f = topFrame(d.name);
    if (!f) throw new Error(`no frame ${d.name}: run the frame chunk first`);
    const editor = f.children.find((n) => n.name === d.editor);
    const parent = d.parent ? paths(editor).get(d.parent) : editor;
    if (!parent) throw new Error(`no node ${d.parent}`);
    const byIdx = await wires(d.prefix);
    const byName = await named();
    let made = 0;
    for (const s of d.children) {
      build(s, parent, d.parentSpec, byIdx, d.hover, byName);
      made++;
    }
    const hx = d.hover.x.map((k) => byIdx[k]);
    const hy = d.hover.y.map((k) => byIdx[k]);
    for (const [node, c, r] of pendingCells)
      await node.setReactionsAsync([
        {
          trigger: TRIGGER.e(),
          actions: [
            ...hx.map((v, i) => ({
              type: "SET_VARIABLE",
              variableId: v.id,
              variableValue: lit(((c >> i) & 1) === 1),
            })),
            ...(r === null ? [] : hy).map((v, i) => ({
              type: "SET_VARIABLE",
              variableId: v.id,
              variableValue: lit(((r >> i) & 1) === 1),
            })),
          ],
        },
      ]);
    return { subtrees: made, cells: pendingCells.length };
  }

  /** Stores reactions: every listed node gets all its reactions in one call. */
  async function react(d) {
    const f = topFrame(d.name);
    if (!f) throw new Error(`no frame ${d.name}`);
    const editor = f.children.find((n) => n.name === d.editor);
    const at = paths(editor);
    const byIdx = await wires(d.prefix);
    const parse = parser(byIdx, await named());
    const runs = {};
    for (const k of Object.keys(d.runs)) runs[k] = parse(d.runs[k]);
    let n = 0;
    let actions = 0;
    for (const [path, list] of d.assign) {
      // "" is the frame, "@name" another top-level frame (an overlay), anything else a path in the editor
      const node =
        path === ""
          ? f
          : path[0] === "@"
            ? topFrame(path.slice(1))
            : at.get(path);
      if (!node) throw new Error(`no node ${path}`);
      const reactions = list.map(([trig, codes, run, lead]) => {
        const a = [...(lead ? parse(lead) : []), ...runs[run]];
        actions += a.length;
        return { trigger: TRIGGER[trig](codes), actions: a };
      });
      await node.setReactionsAsync(reactions);
      n++;
    }
    // Figma may start a flow at an overlay that swaps to another: Present opens only at the frame
    page().flowStartingPoints = page().flowStartingPoints.filter(
      (fl) => fl.nodeId === f.id,
    );
    return { nodes: n, actions };
  }

  /** The gate map: every gate a lamp bound to its output wire, grouped by unit. */
  async function chart(d) {
    await fonts();
    const f = topFrame(d.name);
    const c = f && f.children.find((n) => n.name === d.chart);
    if (!c) throw new Error(`no chart ${d.chart}`);
    const byIdx = await wires(d.prefix);
    let lamps = 0;
    for (const u of d.units) {
      const block = figma.createFrame();
      block.name = `unit/${u.name}`;
      block.resize(u.w, u.h);
      block.fills = solid(d.blockBg);
      block.cornerRadius = 6;
      block.clipsContent = false;
      c.appendChild(block);
      block.x = u.x;
      block.y = u.y;
      const t = figma.createText();
      t.fontName = BOLD;
      t.fontSize = 12;
      t.characters = u.title;
      t.fills = solid("#E6E6E6");
      block.appendChild(t);
      t.x = 10;
      t.y = 6;
      const gates = u.gates.split(",");
      // the unlit lamps of one colour are one vector: every layer a frame holds costs the prototype
      // time on every event, and the unlit lamps never change
      const dims = new Map();
      gates.forEach((g, i) => {
        const x = d.pad + (i % d.perRow) * d.pitch;
        const y = d.top + Math.floor(i / d.perRow) * d.pitch;
        if (!dims.has(g[0])) dims.set(g[0], []);
        dims.get(g[0]).push([x, y]);
      });
      for (const [code, at] of dims) {
        const x0 = Math.min(...at.map((p) => p[0]));
        const y0 = Math.min(...at.map((p) => p[1]));
        const v = figma.createVector();
        v.name = `dim/${code}`;
        v.vectorPaths = [
          {
            windingRule: "NONZERO",
            data: at
              .map(
                ([x, y]) =>
                  `M ${x - x0} ${y - y0} L ${x - x0 + d.size} ${y - y0} L ${x - x0 + d.size} ${y - y0 + d.size} L ${x - x0} ${y - y0 + d.size} Z`,
              )
              .join(" "),
          },
        ];
        v.fills = solid(d.colors[code], 0.22);
        v.strokes = [];
        block.appendChild(v);
        v.x = x0;
        v.y = y0;
      }
      gates.forEach((g, i) => {
        const color = d.colors[g[0]];
        const x = d.pad + (i % d.perRow) * d.pitch;
        const y = d.top + Math.floor(i / d.perRow) * d.pitch;
        const on = figma.createRectangle();
        on.name = `lit`;
        on.resize(d.size, d.size);
        on.fills = solid(color);
        block.appendChild(on);
        on.x = x;
        on.y = y;
        const v = byIdx[parseInt(g.slice(1), 36)];
        if (!v) throw new Error(`no wire ${g} in ${u.name}`);
        on.setBoundVariable("visible", v);
        lamps++;
      });
    }
    return { units: d.units.length, lamps };
  }

  /** FNV-1a over the data as JSON: a chunk copied with any character wrong is refused before it builds. */
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }
  const steps = { vars, frame, ui, react, chart };
  /** Runs one step after checking its data arrived intact. */
  async function run(step, data, hash) {
    const got = fnv(JSON.stringify(data));
    if (got !== hash)
      throw new Error(
        `checksum mismatch in ${step}: the data was not copied exactly (got ${got}, want ${hash}); resend this chunk unchanged`,
      );
    return steps[step](data);
  }
  return { run, fnv };
})();
