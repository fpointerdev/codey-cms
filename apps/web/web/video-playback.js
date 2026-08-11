function reducedMotion(environment) {
  return environment.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function hoverVideoPlaybackEnabled(environment, pointerType = "mouse") {
  if (reducedMotion(environment) || pointerType === "touch") return false;

  return environment.matchMedia?.("(hover: hover) and (pointer: fine)").matches === true;
}

function interactiveVideo(target) {
  const video = target?.closest?.('video[data-video-playback="hover-focus"]');
  if (video) return video;

  return target
    ?.closest?.("[data-video-frame]")
    ?.querySelector?.('video[data-video-playback="hover-focus"]') || null;
}

function videoFrame(video) {
  return video?.closest?.(".structured-block-video[data-video-frame], .shop-catalog-hero[data-video-frame]")
    || video?.closest?.("[data-video-frame]")
    || video;
}

function remainsInside(video, target) {
  return Boolean(target && videoFrame(video)?.contains?.(target));
}

function playVideo(video) {
  const playback = video?.play?.();
  playback?.catch?.(() => undefined);
}

export function bindHoverVideoPlayback(root, environment = window) {
  const onPointerOver = (event) => {
    const video = interactiveVideo(event.target);
    if (!video || remainsInside(video, event.relatedTarget)) return;
    if (!hoverVideoPlaybackEnabled(environment, event.pointerType)) return;

    playVideo(video);
  };
  const onPointerOut = (event) => {
    const video = interactiveVideo(event.target);
    if (!video || remainsInside(video, event.relatedTarget)) return;
    if (!hoverVideoPlaybackEnabled(environment, event.pointerType)) return;

    video.pause?.();
  };
  const onFocusIn = (event) => {
    const video = interactiveVideo(event.target);
    if (!video || reducedMotion(environment)) return;

    playVideo(video);
  };
  const onFocusOut = (event) => {
    const video = interactiveVideo(event.target);
    if (!video || remainsInside(video, event.relatedTarget)) return;

    video.pause?.();
  };

  root.addEventListener("pointerover", onPointerOver);
  root.addEventListener("pointerout", onPointerOut);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);

  return () => {
    root.removeEventListener("pointerover", onPointerOver);
    root.removeEventListener("pointerout", onPointerOut);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
  };
}
