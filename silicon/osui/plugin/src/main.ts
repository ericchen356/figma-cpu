// Plugin entry (Figma's sandbox): opens the panel and routes its messages to OsuiApp.
// Nothing here runs at prototype time; in Present mode Figma's engine does the computing.
import { OsuiApp } from "./app";
import type { ToMain, ToUi } from "./messages";

figma.showUI(__html__, { width: 380, height: 520, title: "Figma OS (gate level)" });

const post = (m: ToUi) => {
  if (m.type === "log") console.log(`[osui] ${m.level}: ${m.text}`);
  figma.ui.postMessage(m);
};
const app = new OsuiApp(figma, post);

figma.ui.onmessage = (msg: ToMain) => {
  void app.handle(msg);
};
