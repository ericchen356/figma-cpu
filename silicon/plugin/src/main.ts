// Plugin entry (Figma's sandbox): opens the panel and routes its messages to SiliconApp.
// Nothing here runs at prototype time; in Present mode Figma's engine does the computing.
import { SiliconApp } from "./app";
import type { ToMain, ToUi } from "./messages";

figma.showUI(__html__, { width: 400, height: 760, title: "FigmaCPU Silicon" });

const post = (m: ToUi) => {
  if (m.type === "log") console.log(`[silicon] ${m.level}: ${m.text}`);
  figma.ui.postMessage(m);
};
const app = new SiliconApp(figma, post);

figma.ui.onmessage = (msg: ToMain) => {
  void app.handle(msg);
};
figma.on("close", () => app.dispose());
