import assert from "node:assert/strict";
import test from "node:test";
import {
  bindHoverVideoPlayback,
  hoverVideoPlaybackEnabled
} from "../apps/web/web/video-playback.js";

function playbackEnvironment({ reducedMotion = false, hover = true } = {}) {
  return {
    matchMedia(query: string) {
      return {
        matches: query.includes("prefers-reduced-motion") ? reducedMotion : hover
      };
    }
  };
}

test("hover video playback respects input type and reduced-motion preferences", () => {
  assert.equal(hoverVideoPlaybackEnabled(playbackEnvironment(), "mouse"), true);
  assert.equal(hoverVideoPlaybackEnabled(playbackEnvironment(), "touch"), false);
  assert.equal(hoverVideoPlaybackEnabled(playbackEnvironment({ hover: false }), "mouse"), false);
  assert.equal(hoverVideoPlaybackEnabled(playbackEnvironment({ reducedMotion: true }), "mouse"), false);
});

test("delegated video playback starts and pauses without binding each video", async () => {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const root = {
    addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    }
  };
  let playCount = 0;
  let pauseCount = 0;
  const frame = {
    contains(target: unknown) {
      return target === frame || target === video;
    }
  };
  const video = {
    closest(selector: string) {
      return selector.startsWith("video") ? video : frame;
    },
    play() {
      playCount += 1;
      return Promise.resolve();
    },
    pause() {
      pauseCount += 1;
    }
  };
  const unbind = bindHoverVideoPlayback(root, playbackEnvironment());

  listeners.get("pointerover")?.({ target: video, relatedTarget: null, pointerType: "mouse" });
  await Promise.resolve();
  assert.equal(playCount, 1);

  listeners.get("pointerout")?.({ target: video, relatedTarget: null, pointerType: "mouse" });
  assert.equal(pauseCount, 1);

  listeners.get("pointerover")?.({ target: video, relatedTarget: null, pointerType: "touch" });
  assert.equal(playCount, 1);

  listeners.get("focusin")?.({ target: video, relatedTarget: null });
  await Promise.resolve();
  assert.equal(playCount, 2);

  unbind();
  assert.equal(listeners.size, 0);
});
