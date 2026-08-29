import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });

globalThis.window = window;
globalThis.document = window.document;

for (const name of [
  "navigator",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
  "getComputedStyle",
  "HTMLElement",
  "HTMLCanvasElement",
  "HTMLDivElement",
  "HTMLImageElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "Image",
  "Audio",
  "Path2D",
  "ImageData",
]) {
  if (name in window) {
    globalThis[name] = window[name];
  }
}
