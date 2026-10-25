// Exports what Figma's prototype viewer runs for the live Figma OS frame, compactly, for the
// emulator in make/os-emu.js. Run in a figma.com editor tab of FINAL CPU (the page's `figma` object
// is the Plugin API): `await osExport.run()` returns the JSON text; `osExport.send(text)` streams it
// in chunks over Supabase Realtime to tools/receive.mjs.
//
// Format (v1):
//   vars:  [[name, collection index, type B|F|S|C, initial value]]   referenced by index
//   colls: [collection name]
//   roots: [[name, w, h, timed list index | -1]]   root 0 is the frame, the rest are overlays
//   nodes: [[root, z, x, y, w, h, vis, up, reactions]]   every layer with reactions, paint order
//          x/y/w/h: its box in root coordinates, clipped by clipping ancestors
//          vis: variable indexes that must all be true for it to show (bound visibility, itself and
//          ancestors up to the root); hidden layers without a binding are left out
//          up: index of the nearest ancestor in nodes, or -1; reactions: [[trigger, list index]]
//   lists: [actions]; action = [0, var, value] set | [1, [[cond|null, actions]…]] conditional |
//          [2, root, how] navigate (O overlay, S swap, N navigate) | [3] close | [4] back | [9, type]
//   value: a number is a variable index, an array an expression [fn, …args], true/false and
//          strings are literals, {k: n} a number, {c: [r, g, b, a]} a colour
//   trigger: ["C"] click, ["D"] mouse down, ["U"] mouse up, ["E"] mouse enter, ["L"] mouse leave,
//            ["K", keyCodes], ["T", seconds], ["?", type]
window.osExport = (() => {
  const FN = {
    AND: 1,
    OR: 2,
    NOT: 3,
    EQUALS: 4,
    NOT_EQUAL: 5,
    ADDITION: 6,
    SUBTRACTION: 7,
    MULTIPLICATION: 8,
    DIVISION: 9,
    NEGATE: 10,
    LESS_THAN: 11,
    LESS_THAN_OR_EQUAL: 12,
    GREATER_THAN: 13,
    GREATER_THAN_OR_EQUAL: 14,
  };
  const breathe = () => new Promise((r) => setTimeout(r, 0));

  // withMeta: also export each node's id and osui acts (for tests, not for the Make app)
  async function run({ frameId = "152:165111", log = console.log, withMeta = false } = {}) {
    const meta = withMeta ? [] : null;
    const live = await figma.getNodeByIdAsync(frameId);
    const page = live.parent;
    const varIdx = new Map();
    const vref = (id) => {
      if (!varIdx.has(id)) varIdx.set(id, varIdx.size);
      return varIdx.get(id);
    };
    const roots = [live];
    const rootIdx = new Map([[live.id, 0]]);
    const frameById = new Map(
      page.children.filter((f) => f.type === "FRAME").map((f) => [f.id, f]),
    );
    const rref = (id) => {
      if (rootIdx.has(id)) return rootIdx.get(id);
      const f = frameById.get(id);
      if (!f) return -1;
      rootIdx.set(id, roots.length);
      roots.push(f);
      return roots.length - 1;
    };
    const val = (d) => {
      if (!d) return null;
      if (d.type === "VARIABLE_ALIAS") return vref(d.value.id);
      if (d.type === "EXPRESSION") {
        const f = FN[d.value.expressionFunction];
        if (!f) throw new Error(`expression ${d.value.expressionFunction}`);
        return [f, ...d.value.expressionArguments.map(val)];
      }
      if (d.type === "FLOAT") return { k: d.value };
      if (d.type === "COLOR")
        return { c: [d.value.r, d.value.g, d.value.b, d.value.a ?? 1] };
      return d.value; // BOOLEAN, STRING
    };
    const acts = (list) =>
      (list ?? []).map((a) => {
        switch (a.type) {
          case "SET_VARIABLE":
            return [0, vref(a.variableId), val(a.variableValue)];
          case "CONDITIONAL":
            return [
              1,
              a.conditionalBlocks.map((b) => [
                b.condition ? val(b.condition) : null,
                acts(b.actions),
              ]),
            ];
          case "NODE":
            return [
              2,
              rref(a.destinationId),
              { OVERLAY: "O", SWAP: "S", NAVIGATE: "N" }[a.navigation] ??
                a.navigation,
            ];
          case "CLOSE":
            return [3];
          case "BACK":
            return [4];
          default:
            return [9, a.type];
        }
      });
    const lists = [],
      listIdx = new Map();
    const lref = (list) => {
      const c = acts(list),
        key = JSON.stringify(c);
      if (!listIdx.has(key)) {
        listIdx.set(key, lists.length);
        lists.push(c);
      }
      return listIdx.get(key);
    };
    const trig = (t) =>
      ({
        ON_CLICK: ["C"],
        MOUSE_DOWN: ["D"],
        MOUSE_UP: ["U"],
        MOUSE_ENTER: ["E"],
        MOUSE_LEAVE: ["L"],
        ON_KEY_DOWN: ["K", t.keyCodes],
        AFTER_TIMEOUT: ["T", t.timeout],
      })[t.type] ?? ["?", t.type];

    const nodes = [];
    let z = 0,
      seen = 0;
    const box = (n, r0) => {
      const b = n.absoluteBoundingBox;
      return b ? [b.x - r0.x, b.y - r0.y, b.width, b.height] : null;
    };
    async function walk(n, r, r0, vis, clip, up) {
      if (++seen % 300 === 0) await breathe();
      const bound = n.boundVariables?.visible?.id;
      if (n !== roots[r]) {
        if (bound) vis = [...vis, vref(bound)];
        else if (!n.visible) return;
      }
      const b = box(n, r0);
      let me = up;
      if (n.reactions?.length && b) {
        const x0 = Math.max(b[0], clip[0]),
          y0 = Math.max(b[1], clip[1]);
        const x1 = Math.min(b[0] + b[2], clip[2]),
          y1 = Math.min(b[1] + b[3], clip[3]);
        me = nodes.length;
        if (meta) meta.push([n.id, n.getSharedPluginData("osui", "acts") || null]);
        nodes.push([
          r,
          z++,
          x0,
          y0,
          Math.max(0, x1 - x0),
          Math.max(0, y1 - y0),
          vis,
          up,
          n.reactions.map((x) => [trig(x.trigger), lref(x.actions)]),
        ]);
      }
      if ("clipsContent" in n && n.clipsContent && b && n !== roots[r])
        clip = [
          Math.max(clip[0], b[0]),
          Math.max(clip[1], b[1]),
          Math.min(clip[2], b[0] + b[2]),
          Math.min(clip[3], b[1] + b[3]),
        ];
      if ("children" in n)
        for (const c of n.children) await walk(c, r, r0, vis, clip, me);
    }
    // roots grow as navigations are found: walk until every one has been walked
    const rootRows = [];
    for (let r = 0; r < roots.length; r++) {
      const f = roots[r],
        r0 = f.absoluteBoundingBox;
      log(`root ${r}/${roots.length}: ${f.name}`);
      await walk(f, r, r0, [], [0, 0, f.width, f.height], -1);
      const timed = (f.reactions ?? []).find(
        (x) => x.trigger?.type === "AFTER_TIMEOUT",
      );
      rootRows.push([
        f.name,
        f.width,
        f.height,
        timed ? lref(timed.actions) : -1,
      ]);
    }
    // the timed list of a root found late is already in lists via its node row; keep the row index

    log(`variables: ${varIdx.size}`);
    const colls = [],
      collIdx = new Map();
    const vars = new Array(varIdx.size);
    let k = 0;
    for (const [id, i] of varIdx) {
      if (++k % 200 === 0) {
        await breathe();
        log(`variables ${k}/${varIdx.size}`);
      }
      const v = await figma.variables.getVariableByIdAsync(id);
      if (!v) {
        vars[i] = [id, -1, "?", null];
        continue;
      }
      const c = await figma.variables.getVariableCollectionByIdAsync(
        v.variableCollectionId,
      );
      if (!collIdx.has(c.id)) {
        collIdx.set(c.id, colls.length);
        colls.push(c.name);
      }
      let x =
        v.valuesByMode[c.defaultModeId] ?? Object.values(v.valuesByMode)[0];
      for (let hop = 0; x && x.type === "VARIABLE_ALIAS" && hop < 8; hop++) {
        const w = await figma.variables.getVariableByIdAsync(x.id);
        const wc = await figma.variables.getVariableCollectionByIdAsync(
          w.variableCollectionId,
        );
        x =
          w.valuesByMode[wc.defaultModeId] ?? Object.values(w.valuesByMode)[0];
      }
      const t =
        { BOOLEAN: "B", FLOAT: "F", STRING: "S", COLOR: "C" }[v.resolvedType] ??
        "?";
      if (t === "C" && x) x = [x.r, x.g, x.b, x.a ?? 1];
      vars[i] = [v.name, collIdx.get(c.id), t, x];
    }
    const out = {
      v: 1,
      frame: [live.id, live.name, live.width, live.height],
      colls,
      vars,
      roots: rootRows,
      nodes,
      lists,
    };
    if (meta) out.meta = meta;
    const text = JSON.stringify(out);
    log(
      `done: ${nodes.length} nodes, ${roots.length} roots, ${lists.length} lists, ${vars.length} variables, ${(text.length / 1e6).toFixed(2)} MB`,
    );
    return text;
  }

  // Streams the text over a Supabase Realtime channel in 90 kB chunks.
  async function send(
    text,
    { ref, key, channel = "figma-os-export", from = 0, only = null } = {},
  ) {
    const topic = `realtime:${channel}`;
    const ws = new WebSocket(
      `wss://${ref}.supabase.co/realtime/v1/websocket?apikey=${key}&vsn=1.0.0`,
    );
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });
    let n = 1;
    const raw = (event, payload, t = topic) =>
      ws.send(
        JSON.stringify({
          topic: t,
          event,
          payload,
          ref: String(n++),
          join_ref: "1",
        }),
      );
    raw("phx_join", {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: "" },
        private: false,
      },
      access_token: key,
    });
    await new Promise((r) => setTimeout(r, 1500));
    const size = 90000,
      count = Math.ceil(text.length / size);
    for (let i = from; i < count; i++) {
      if (only && !only.includes(i)) continue;
      raw("broadcast", {
        type: "broadcast",
        event: "chunk",
        payload: { i, count, data: text.slice(i * size, (i + 1) * size) },
      });
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 1000));
    ws.close();
    return count;
  }
  return { run, send };
})();
