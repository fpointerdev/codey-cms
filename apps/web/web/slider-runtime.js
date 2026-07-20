export function updateSlider(slider, nextIndex) {
  const track = slider.querySelector("[data-slider-track]");
  const slides = slider.querySelectorAll(".slider-slide");
  const visibleStyle = typeof getComputedStyle === "function" ? getComputedStyle(slider).getPropertyValue("--slider-visible") : "";
  const perView = Math.max(1, Number(visibleStyle || slider.dataset.sliderPerView || 1));
  const effect = slider.dataset.sliderEffect || "slide";
  const direction = slider.dataset.sliderDirection || "horizontal";
  const focus = slider.dataset.sliderFocus || "standard";
  const singleStep = effect === "fade" || effect === "zoom" || focus === "peek";
  const maxIndex = Math.max(0, slides.length - (singleStep ? 1 : perView));
  const loop = slider.dataset.sliderLoop === "true";
  let index = nextIndex;

  if (loop && slides.length > perView) {
    if (index < 0) index = maxIndex;
    if (index > maxIndex) index = 0;
  } else {
    index = Math.min(maxIndex, Math.max(0, index));
  }

  slider.dataset.sliderIndex = String(index);
  slides.forEach((slide, slideIndex) => {
    slide.classList.toggle("active", slideIndex === index);
    slide.classList.toggle("is-before", slideIndex < index);
    slide.classList.toggle("is-after", slideIndex > index);
  });

  if (track && (effect === "fade" || effect === "zoom")) {
    track.style.transform = "";
  } else if (track && focus === "peek") {
    const activeSlide = slides[index];
    const stage = slider.querySelector(".slider-stage");
    const offset = direction === "vertical"
      ? Math.max(0, activeSlide.offsetTop - ((stage?.clientHeight || activeSlide.clientHeight) - activeSlide.clientHeight) / 2)
      : Math.max(0, activeSlide.offsetLeft - ((stage?.clientWidth || activeSlide.clientWidth) - activeSlide.clientWidth) / 2);
    track.style.transform = direction === "vertical" ? `translateY(-${offset}px)` : `translateX(-${offset}px)`;
  } else if (track) {
    const amount = index * (100 / perView);
    track.style.transform = direction === "vertical" ? `translateY(-${amount}%)` : `translateX(-${amount}%)`;
  }

  const count = slider.querySelector("[data-slider-count]");
  if (count) count.textContent = `${index + 1} / ${Math.max(1, maxIndex + 1)}`;

  slider.querySelectorAll("[data-slider-caption]").forEach((caption) => {
    caption.classList.toggle("active", Number(caption.dataset.sliderCaption) === index);
  });

  const previous = slider.querySelector("[data-slider-prev]");
  const next = slider.querySelector("[data-slider-next]");
  if (previous) previous.disabled = maxIndex === 0 || !loop && index <= 0;
  if (next) next.disabled = maxIndex === 0 || !loop && index >= maxIndex;
}

export function handleSliderClick(event) {
  const direction = event.target.closest("[data-slider-prev]") ? -1 : event.target.closest("[data-slider-next]") ? 1 : 0;
  if (!direction) return false;

  const slider = event.target.closest("[data-slider]");
  if (!slider) return false;

  event.preventDefault();
  updateSlider(slider, Number(slider.dataset.sliderIndex || 0) + direction);
  return true;
}
