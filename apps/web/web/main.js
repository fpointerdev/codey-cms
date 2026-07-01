import { bootstrap } from "./controller.js";
import { bindEvents } from "./events.js";

export function startApp() {
  bindEvents();
  void bootstrap();
}
