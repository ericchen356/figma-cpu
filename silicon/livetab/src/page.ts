// The extension for a figma.com editor tab, where the page's `figma` object is the Plugin API: the
// same patch as the plugin, loaded as a script and called as leilaCpu.add() / .remove().
import { addLiveTab, removeLiveTab, type LiveTabOptions } from "./patch";

declare const figma: PluginAPI;
(globalThis as unknown as { leilaCpu: unknown }).leilaCpu = {
  add: (o: LiveTabOptions = {}) => addLiveTab(figma, o),
  remove: () => removeLiveTab(figma),
};
