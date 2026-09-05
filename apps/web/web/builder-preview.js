import { handleSliderClick } from "./slider-runtime.js";
import {
  enhanceStructuredTabs,
  handleStructuredTabClick,
  handleStructuredTabKeydown
} from "./structured-tabs.js";
import { enhanceMotionWhenPresent, loadThreeRuntimeNearScene } from "./premium-visuals.js";

const page = document.querySelector("[data-page]");

if (page) {
  enhanceStructuredTabs(page);
  void enhanceMotionWhenPresent(page);
  loadThreeRuntimeNearScene(page);
  page.addEventListener("click", (event) => {
    if (handleSliderClick(event)) return;
    handleStructuredTabClick(event);
  });
  page.addEventListener("keydown", handleStructuredTabKeydown);
}
