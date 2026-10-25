// The editor's icons, the same set as os-ui's (os-ui/src/icons.ts): Lucide (ISC license) glyphs on
// a 24 × 24 grid, drawn as 1.5 px round-joined outlines, and os-ui's own toolbar glyphs drawn to
// match Figma's toolbar. Each is the inner markup of an <svg viewBox="0 0 24 24">; `svgIcon` makes
// the document that Figma's createNodeFromSvg turns into a frame of vectors.
export const ICON = {
  // the toolbar (os-ui's drawings)
  move: '<path d="M5.5 4.5 19.5 10.2l-6.9 2.2-2.4 7z"/>',
  frame: '<path d="M8.5 3.5v17M15.5 3.5v17M3.5 8.5h17M3.5 15.5h17"/>',
  rect: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>',
  ellipse: '<circle cx="12" cy="12" r="8"/>',
  pen: '<g transform="rotate(45 12 12)"><path d="M12 21 7.6 12.6c-.7-1.5-.5-3.4.5-4.7L12 3l3.9 4.9c1 1.3 1.2 3.2.5 4.7z"/><circle cx="12" cy="10.6" r="1.6"/><path d="M12 12.2V21"/></g>',
  // Lucide
  erase:
    '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>',
  clear: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  trash:
    '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  file: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/>',
  assets:
    '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  cpu: '<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  sidebar: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  // the Figma mark, in outline: two half-pills, a half-pill and a circle, a drop
  logo: '<path d="M12 2.5H9a3 3 0 0 0 0 6h3z"/><path d="M12 2.5h3a3 3 0 0 1 0 6h-3z"/><path d="M12 8.5H9a3 3 0 0 0 0 6h3z"/><circle cx="15" cy="11.5" r="3"/><path d="M12 14.5H9a3 3 0 1 0 3 3z"/>',
} as const;

export type IconName = keyof typeof ICON;

/** The SVG document of icon `name` at `size` px, in `color`. */
export function svgIcon(name: IconName, size: number, color: string, weight = 1.5): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
}
