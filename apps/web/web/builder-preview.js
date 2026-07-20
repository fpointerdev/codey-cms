import { handleSliderClick } from "./slider-runtime.js";
import {
  enhanceStructuredTabs,
  handleStructuredTabClick,
  handleStructuredTabKeydown
} from "./structured-tabs.js";

const page = document.querySelector("[data-page]");

if (page) {
  enhanceStructuredTabs(page);
  page.addEventListener("click", (event) => {
    if (handleSliderClick(event)) return;
    handleStructuredTabClick(event);
  });
  page.addEventListener("keydown", handleStructuredTabKeydown);
}
