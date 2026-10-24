// The one icon set for the whole UI: Lucide (ISC license, see node_modules/lucide/LICENSE). Every
// glyph shares the same 24x24 grid, stroke and corner style, so no icon looks heavier or larger
// than its neighbours. CSS sizes them per context (24px in the toolbar and rail, 16px in panels,
// 12px in carets); nothing in the UI is drawn from a text character or an emoji.
import * as L from "lucide";
import type { IconNode } from "lucide";

export const svg = (inner: string) => `<svg viewBox="0 0 24 24">${inner}</svg>`;

const icon = (node: IconNode) =>
  svg(
    node
      .map(
        ([tag, a]) =>
          `<${tag} ${Object.entries(a)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${k}="${v}"`)
            .join(" ")}/>`,
      )
      .join(""),
  );

// The toolbar glyphs, drawn to match the Figma toolbar reference: thin round-joined outlines on the
// same 24px grid and 1.5px stroke as the rest of the set (the pen nib is one upright shape turned 45deg).
const draw = {
  move: svg('<path d="M5.5 4.5 19.5 10.2l-6.9 2.2-2.4 7z"/>'),
  frame: svg('<path d="M8.5 3.5v17M15.5 3.5v17M3.5 8.5h17M3.5 15.5h17"/>'),
  rect: svg('<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>'),
  pen: svg(
    '<g transform="rotate(45 12 12)"><path d="M12 21 7.6 12.6c-.7-1.5-.5-3.4.5-4.7L12 3l3.9 4.9c1 1.3 1.2 3.2.5 4.7z"/><circle cx="12" cy="10.6" r="1.6"/><path d="M12 12.2V21"/></g>',
  ),
  text: svg('<path d="M5.5 8V5h13v3M12 5v14M9 19h6"/>'),
  comment: svg('<path d="M12 3.8a8.2 8.2 0 1 1-4 15.4l-3.8.8 1-3.9A8.2 8.2 0 0 1 12 3.8Z"/>'),
  actions: svg(
    '<path d="M8 3.6 12.4 8 8 12.4 3.6 8z"/><circle cx="16.8" cy="8" r="3.9"/><rect x="4.4" y="13.6" width="7.2" height="7.2" rx="1.8"/><path d="M16.8 13v7.4M13.1 16.7h7.4"/>',
  ),
  // mode switcher (Draw, Design, Motion, Dev Mode)
  modeDraw: svg('<path d="M4.5 16.5C6 9.5 8.2 7 10 10.2s1.2 6.6 3.4 4.6c1.9-1.7 2.4-4.3 4.1-6.3"/>'),
  modeDesign: svg(
    '<path d="M4.5 4.5h10M4.5 4.5v11M4.5 9.5h6M9.5 9.5v6M12.5 12.5l7 2.4-3 1.3-1.3 3z"/>',
  ),
  modeMotion: svg(
    '<path d="M12 3.5 20.5 12 12 20.5 3.5 12z"/><path d="m9.2 9.8 2.2 2.2-2.2 2.2M12.6 9.8l2.2 2.2-2.2 2.2"/>',
  ),
  modeDev: svg('<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 6.5l-3 11"/>'),
};

export const I = {
  // rail
  file: icon(L.File),
  assets: icon(L.LayoutGrid),
  tools: icon(L.Wrench),
  // UI
  chevDown: icon(L.ChevronDown),
  chevRight: icon(L.ChevronRight),
  chevLeft: icon(L.ChevronLeft),
  copy: icon(L.Copy),
  search: icon(L.Search),
  plus: icon(L.Plus),
  minus: icon(L.Minus),
  check: icon(L.Check),
  sidebar: icon(L.PanelLeft),
  lock: icon(L.Lock),
  sliders: icon(L.SlidersHorizontal),
  play: icon(L.Play),
  workflow: icon(L.Workflow),
  rotate: icon(L.RotateCw),
  // toolbar
  move: draw.move,
  hand: icon(L.Hand),
  scale: icon(L.Scaling),
  frame: draw.frame,
  section: icon(L.SquareDashed),
  slice: icon(L.Slice),
  rect: draw.rect,
  line: icon(L.Slash),
  arrow: icon(L.ArrowUpRight),
  ellipse: icon(L.Circle),
  polygon: icon(L.Pentagon),
  star: icon(L.Star),
  image: icon(L.Image),
  paint: icon(L.Paintbrush),
  erase: icon(L.Eraser),
  pen: draw.pen,
  pencil: icon(L.Pencil),
  text: draw.text,
  comment: draw.comment,
  actions: draw.actions,
  clear: icon(L.X),
  eye: icon(L.Eye),
  eyeOff: icon(L.EyeOff),
  // alignment
  alignLeft: icon(L.AlignStartVertical),
  alignHCenter: icon(L.AlignCenterVertical),
  alignRight: icon(L.AlignEndVertical),
  alignTop: icon(L.AlignStartHorizontal),
  alignVCenter: icon(L.AlignCenterHorizontal),
  alignBottom: icon(L.AlignEndHorizontal),
  // mode switcher
  modeDraw: draw.modeDraw,
  modeDesign: draw.modeDesign,
  modeMotion: draw.modeMotion,
  modeDev: draw.modeDev,
} as const;
