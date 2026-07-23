function needsEditorRuntime() {
  const path = window.location.pathname || "/";
  const adminPath = path === "/cy-admin" || path.startsWith("/dashboard") || path.startsWith("/auth/");
  const editMode = new URLSearchParams(window.location.search || "").get("edit") === "1";
  const sessionHint = localStorage.getItem("cms_session_hint") === "1";

  return adminPath || editMode || sessionHint;
}

function loadAdminStyles() {
  if (document.querySelector("[data-admin-styles]")) return Promise.resolve();

  return new Promise((resolve) => {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/admin.css";
    stylesheet.dataset.adminStyles = "";
    stylesheet.addEventListener("load", resolve, { once: true });
    stylesheet.addEventListener("error", resolve, { once: true });
    document.head.append(stylesheet);
  });
}

export async function startApp() {
  if (!needsEditorRuntime()) {
    const { startPublicRuntime } = await import("./public-runtime.js");
    await startPublicRuntime();
    return;
  }

  await loadAdminStyles();
  const [{ bootstrap }, { bindEvents }] = await Promise.all([
    import("./controller.js"),
    import("./events.js")
  ]);
  bindEvents();
  await bootstrap();
}
