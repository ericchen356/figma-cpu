// Clones page "Machine v2" into a SEPARATE page "Machine v2 (plugin test)" so the plugin team can run the
// engine without touching the canvas team's page. Safe to re-run: it never edits "Machine v2", and it refuses
// to overwrite an existing test page unless you re-run after renaming/deleting it by hand.
// Re-sync after the canvas team changes things: delete the test page, run this again.
(async () => {
  const SRC = "Machine v2";
  const DST = "Machine v2 (plugin test)";
  const src = figma.root.children.find((p) => p.name === SRC);
  if (!src) return figma.closePlugin(`No page named "${SRC}". Nothing done.`);
  if (figma.root.children.some((p) => p.name === DST))
    return figma.closePlugin(`"${DST}" already exists. Delete it first to re-clone. Nothing changed.`);
  await src.loadAsync();
  const copy = src.clone();
  copy.name = DST;
  let n = 0;
  copy.findAll(() => (n++, false));
  figma.closePlugin(`Cloned "${SRC}" -> "${DST}" (${n} nodes). "${SRC}" untouched.`);
})();
