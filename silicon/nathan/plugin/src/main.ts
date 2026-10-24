// Plugin entry (Figma's sandbox): opens the panel and routes its messages to NathanApp.
// Nothing here runs at prototype time; in Present mode Figma's engine does the computing.
import { NathanApp } from "./app";
import type { ToMain, ToUi } from "./messages";

figma.showUI(__html__, { width: 420, height: 720, title: "CPU NATHAN" });

const post = (m: ToUi) => {
  if (m.type === "log") console.log(`[nathan] ${m.level}: ${m.text}`);
  figma.ui.postMessage(m);
};
const app = new NathanApp(figma, post);

figma.ui.onmessage = (msg: ToMain) => {
  void app.handle(msg);
};
