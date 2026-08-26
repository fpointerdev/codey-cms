import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const palettes = {
  dark: { background: "#11151b", foreground: "#eef6f3" },
  light: { background: "#edf3f1", foreground: "#172426" },
  brand: { background: "#13312d", foreground: "#f4f8e9" }
};

function scenePalette(stage) {
  const tone = palettes[stage.dataset.threeTone] || palettes.dark;
  const accent = /^#[0-9a-f]{6}$/i.test(stage.dataset.threeAccent || "")
    ? stage.dataset.threeAccent
    : "#c9ff67";

  return { ...tone, accent };
}

function addPedestal(group, palette) {
  const material = new THREE.MeshStandardMaterial({
    color: palette.foreground,
    metalness: 0.08,
    roughness: 0.62
  });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.5, 0.22, 64), material);
  base.position.y = -1.32;
  base.receiveShadow = true;
  group.add(base);
}

function visualMaterial(palette, finish, defaults = {}) {
  if (finish === "clay") {
    return new THREE.MeshStandardMaterial({ color: "#d7d2c8", metalness: 0, roughness: 0.9 });
  }
  if (finish === "chrome") {
    return new THREE.MeshStandardMaterial({ color: "#dce5e6", metalness: 0.96, roughness: 0.12 });
  }

  return new THREE.MeshPhysicalMaterial({
    color: palette.accent,
    clearcoat: 0.9,
    clearcoatRoughness: 0.16,
    metalness: 0.18,
    roughness: 0.24,
    ...defaults
  });
}

function addProductStage(group, palette, finish) {
  addPedestal(group, palette);
  const material = visualMaterial(palette, finish);
  const sculpture = new THREE.Mesh(new THREE.TorusKnotGeometry(0.78, 0.23, 180, 28, 2, 3), material);
  sculpture.castShadow = true;
  sculpture.position.y = -0.08;
  group.add(sculpture);
}

function addCrystal(group, palette, finish) {
  addPedestal(group, palette);
  const crystal = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.08, 2),
    visualMaterial(palette, finish, { clearcoat: 1, clearcoatRoughness: 0.08, metalness: 0.32, roughness: 0.18, flatShading: true })
  );
  crystal.castShadow = true;
  crystal.position.y = -0.02;
  crystal.rotation.z = 0.2;
  group.add(crystal);
}

function addWave(group, palette, finish) {
  const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const material = finish === "clay" || finish === "chrome"
    ? visualMaterial(palette, finish)
    : new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.2, roughness: 0.42 });
  const columns = 13;
  const rows = 8;
  const mesh = new THREE.InstancedMesh(geometry, material, columns * rows);
  const transform = new THREE.Object3D();
  let index = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const distance = Math.hypot(column - (columns - 1) / 2, row - (rows - 1) / 2);
      const height = 0.45 + Math.max(0, 1.8 - distance * 0.22);
      transform.position.set((column - 6) * 0.28, height * 0.5 - 0.9, (row - 3.5) * 0.3);
      transform.scale.set(1, height / 0.2, 1);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      index += 1;
    }
  }

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addProceduralScene(group, preset, palette, finish) {
  if (preset === "crystal") addCrystal(group, palette, finish);
  else if (preset === "wave") addWave(group, palette, finish);
  else addProductStage(group, palette, finish);
}

function disposeMaterial(material) {
  Object.values(material).forEach((value) => value?.isTexture && value.dispose());
  material.dispose?.();
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach(disposeMaterial);
  });
}

function applyModelFinish(model, palette, finish) {
  if (finish === "original") return;

  const replacedMaterials = new Set();
  model.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => replacedMaterials.add(material));
    child.material = Array.isArray(child.material)
      ? child.material.map(() => visualMaterial(palette, finish))
      : visualMaterial(palette, finish);
  });
  replacedMaterials.forEach(disposeMaterial);
}

async function loadModel(stage, group, palette, finish) {
  const source = stage.dataset.threeModel;
  if (!source) return null;

  const gltf = await new GLTFLoader().loadAsync(source);
  const model = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const largestSide = Math.max(size.x, size.y, size.z) || 1;
  const scale = 2.4 / largestSide;
  const center = bounds.getCenter(new THREE.Vector3());

  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -center.y * scale - 0.05, -center.z * scale);
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  applyModelFinish(model, palette, finish);
  [...group.children].forEach(disposeObject);
  group.clear();
  group.add(model);

  return gltf;
}

async function loadPanorama(stage, group, renderer) {
  const source = stage.dataset.threePanorama;
  if (!source) return null;

  const texture = await new THREE.TextureLoader().loadAsync(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const geometry = new THREE.SphereGeometry(5, 64, 40);
  geometry.scale(-1, 1, 1);
  const panorama = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture }));
  group.add(panorama);

  return texture;
}

function bindSceneInteraction(stage, group, render) {
  if (stage.dataset.threeInteractive !== "true") return () => undefined;

  stage.tabIndex = 0;
  stage.setAttribute("role", "img");
  stage.setAttribute(
    "aria-label",
    stage.dataset.threePanorama
      ? "Interactive 360-degree scene. Use the arrow keys or drag to look around."
      : "Interactive 3D scene. Use the arrow keys or drag to rotate it."
  );
  let dragging = false;
  let pointerX = 0;
  let pointerY = 0;

  const pointerDown = (event) => {
    dragging = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    stage.setPointerCapture?.(event.pointerId);
  };
  const pointerMove = (event) => {
    if (!dragging) return;
    group.rotation.y += (event.clientX - pointerX) * 0.008;
    group.rotation.x = THREE.MathUtils.clamp(group.rotation.x + (event.clientY - pointerY) * 0.005, -0.45, 0.45);
    pointerX = event.clientX;
    pointerY = event.clientY;
    render();
  };
  const pointerUp = () => { dragging = false; };
  const keydown = (event) => {
    const movement = { ArrowLeft: -0.12, ArrowRight: 0.12 }[event.key];
    const vertical = { ArrowUp: -0.08, ArrowDown: 0.08 }[event.key];
    if (movement === undefined && vertical === undefined) return;
    event.preventDefault();
    group.rotation.y += movement || 0;
    group.rotation.x = THREE.MathUtils.clamp(group.rotation.x + (vertical || 0), -0.45, 0.45);
    render();
  };

  stage.addEventListener("pointerdown", pointerDown);
  stage.addEventListener("pointermove", pointerMove);
  stage.addEventListener("pointerup", pointerUp);
  stage.addEventListener("pointercancel", pointerUp);
  stage.addEventListener("keydown", keydown);

  return () => {
    stage.removeEventListener("pointerdown", pointerDown);
    stage.removeEventListener("pointermove", pointerMove);
    stage.removeEventListener("pointerup", pointerUp);
    stage.removeEventListener("pointercancel", pointerUp);
    stage.removeEventListener("keydown", keydown);
  };
}

function configureCamera(camera, mode, panorama) {
  if (panorama) {
    camera.fov = 64;
    camera.position.set(0, 0, 0.01);
    camera.lookAt(0, 0, -1);
  } else if (mode === "front") {
    camera.position.set(0, 0.15, 5.6);
  } else if (mode === "close") {
    camera.position.set(0.25, 0.2, 4.25);
  } else {
    camera.position.set(0.7, 0.32, 5.2);
  }
  if (!panorama) camera.lookAt(0, -0.05, 0);
  camera.updateProjectionMatrix();
}

function addSceneLights(scene, palette, preset) {
  const settings = {
    soft: { hemisphere: 2.8, key: 2.1, accent: 9 },
    studio: { hemisphere: 2.1, key: 3.4, accent: 24 },
    dramatic: { hemisphere: 0.9, key: 5.2, accent: 38 }
  }[preset] || { hemisphere: 2.1, key: 3.4, accent: 24 };

  scene.add(new THREE.HemisphereLight(palette.foreground, palette.background, settings.hemisphere));
  const keyLight = new THREE.DirectionalLight("#ffffff", settings.key);
  keyLight.position.set(3.5, 5, 4);
  keyLight.castShadow = true;
  scene.add(keyLight);
  const accentLight = new THREE.PointLight(palette.accent, settings.accent, 8, 2);
  accentLight.position.set(-2.8, 0.8, 2.6);
  scene.add(accentLight);
}

async function initializeScene(stage) {
  if (stage.dataset.threeStatus) return;
  stage.dataset.threeStatus = "loading";

  const palette = scenePalette(stage);
  const panorama = Boolean(stage.dataset.threePanorama);
  const finish = ["original", "brand", "clay", "chrome"].includes(stage.dataset.threeFinish)
    ? stage.dataset.threeFinish
    : "brand";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motion = reducedMotion ? "none" : stage.dataset.threeMotion || "gentle";
  const toggle = stage.closest(".structured-three-visual")?.querySelector("[data-three-toggle]");
  if (reducedMotion && toggle) toggle.hidden = true;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.threeCanvas = "";

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch {
    stage.dataset.threeStatus = "fallback";
    if (toggle) toggle.hidden = true;
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(palette.background, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  configureCamera(camera, stage.dataset.threeCamera || "angled", panorama);
  const group = new THREE.Group();
  scene.add(group);
  if (panorama) {
    group.rotation.y = { left: -0.72, right: 0.72 }[stage.dataset.threeStartView] || 0;
  } else {
    addProceduralScene(group, stage.dataset.threePreset || "product-stage", palette, finish);
    addSceneLights(scene, palette, stage.dataset.threeLighting || "studio");
  }

  let width = 0;
  let height = 0;
  let active = true;
  let paused = false;
  let ready = false;
  let frame = 0;
  let previousTime = performance.now();
  let mixer = null;

  const resize = () => {
    const bounds = stage.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(bounds.width));
    const nextHeight = Math.max(1, Math.round(bounds.height));
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const render = () => {
    resize();
    renderer.render(scene, camera);
  };
  const tick = (time) => {
    if (!active || paused || motion === "none" || !ready) {
      frame = 0;
      return;
    }
    const delta = Math.min((time - previousTime) / 1000, 0.05);
    previousTime = time;
    group.rotation.y += delta * (motion === "dynamic" ? 0.48 : 0.2);
    mixer?.update(delta);
    render();
    frame = requestAnimationFrame(tick);
  };
  const stopAnimation = () => {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const startAnimation = () => {
    if (frame || !active || paused || motion === "none" || !ready) return;
    previousTime = performance.now();
    frame = requestAnimationFrame(tick);
  };

  const resizeObserver = new ResizeObserver(render);
  resizeObserver.observe(stage);
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    active = entry.isIntersecting;
    if (active) startAnimation();
    else stopAnimation();
  }, { rootMargin: "120px" });
  visibilityObserver.observe(stage);
  const unbindInteraction = bindSceneInteraction(stage, group, render);
  const toggleMotion = () => {
    paused = !paused;
    toggle?.setAttribute("aria-pressed", String(paused));
    if (toggle) toggle.textContent = paused ? "Play motion" : "Pause motion";
    if (paused) stopAnimation();
    else startAnimation();
  };
  toggle?.addEventListener("click", toggleMotion);

  const showMotionToggle = () => {
    if (toggle && motion !== "none" && !reducedMotion) toggle.hidden = false;
  };

  render();

  if (panorama) {
    try {
      const texture = await loadPanorama(stage, group, renderer);
      if (!texture) throw new Error("Missing panorama image.");
      stage.dataset.threePanoramaStatus = "ready";
      stage.dataset.threeStatus = "ready";
      ready = true;
      render();
      showMotionToggle();
    } catch {
      stage.dataset.threeStatus = "asset-error";
      stage.dataset.threePanoramaStatus = "error";
      if (toggle) toggle.hidden = true;
      const status = stage.querySelector(".structured-three-status");
      if (status) status.textContent = "360 image unavailable";
    }
  } else {
    stage.dataset.threeStatus = "ready";
    ready = true;
    try {
      const gltf = await loadModel(stage, group, palette, finish);
      stage.dataset.threeModelStatus = gltf ? "ready" : "none";
      if (gltf?.animations?.length && motion !== "none") {
        mixer = new THREE.AnimationMixer(gltf.scene);
        gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
      }
      render();
      showMotionToggle();
    } catch {
      ready = false;
      stopAnimation();
      stage.dataset.threeStatus = "model-error";
      stage.dataset.threeModelStatus = "error";
      if (toggle) toggle.hidden = true;
      const status = stage.querySelector(".structured-three-status");
      if (status) status.textContent = "3D model unavailable";
    }
  }

  startAnimation();

  window.addEventListener("pagehide", () => {
    stopAnimation();
    toggle?.removeEventListener("click", toggleMotion);
    unbindInteraction();
    visibilityObserver.disconnect();
    resizeObserver.disconnect();
    disposeObject(scene);
    renderer.dispose();
  }, { once: true });
}

export function enhanceThreeScenes(root = document) {
  const stages = root.querySelectorAll("[data-three-scene]:not([data-three-status])");
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      void initializeScene(entry.target);
    });
  }, { rootMargin: "320px" });

  stages.forEach((stage) => observer.observe(stage));
}
