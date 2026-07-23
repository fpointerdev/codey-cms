const apiBase = "/api/v1";
const form = document.querySelector("[data-install-form]");
const loading = document.querySelector("[data-installer-loading]");
const message = document.querySelector("[data-form-message]");
const systemStatus = document.querySelector("[data-system-status]");
const version = document.querySelector("[data-runtime-version]");
const claimTokenField = document.querySelector("[data-claim-token-field]");

const hashToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
if (hashToken) {
  form.elements.claimToken.value = hashToken;
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
}

void loadStatus();

async function loadStatus() {
  try {
    const body = await request("/install/status");
    const status = body.data;

    if (status.installed) {
      window.location.replace("/cy-admin");
      return;
    }

    version.textContent = `Version ${status.runtimeVersion} | ${status.channel}`;
    systemStatus.classList.add("is-ready");
    systemStatus.querySelector("span:last-child").textContent =
      `${status.requirements.database} | ${formatStorage(status.requirements.storage)}`;
    claimTokenField.hidden = !status.claimTokenRequired || Boolean(hashToken);
    form.elements.claimToken.required = status.claimTokenRequired;
    selectProfile(status.defaultProfile);
    loading.hidden = true;
    form.hidden = false;
    setProgress("site");
  } catch (error) {
    systemStatus.classList.add("is-error");
    systemStatus.querySelector("span:last-child").textContent = error.message;
    loading.querySelector("p").textContent = "Setup is not available";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const password = String(data.get("adminPassword") || "");
  const confirmPassword = String(data.get("confirmPassword") || "");

  if (password !== confirmPassword) {
    setMessage("Passwords do not match.", true);
    form.elements.confirmPassword.focus();
    return;
  }

  setProgress("account");
  setDisabled(true);
  setMessage("Creating your website...");

  try {
    await request("/install/complete", {
      method: "POST",
      body: JSON.stringify({
        claimToken: String(data.get("claimToken") || ""),
        siteName: String(data.get("siteName") || "").trim(),
        profile: String(data.get("profile") || "cms"),
        searchIndexing: data.get("searchIndexing") === "on",
        admin: {
          name: String(data.get("adminName") || "").trim(),
          email: String(data.get("adminEmail") || "").trim(),
          password
        }
      })
    });
    const login = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: String(data.get("adminEmail") || "").trim(),
        password
      })
    });

    if (login.data?.tokens?.accessToken) {
      localStorage.setItem("cms_session_hint", "1");
    }
    setProgress("complete");
    setMessage("Installation complete. Opening your dashboard...");
    window.location.replace("/dashboard");
  } catch (error) {
    setMessage(error.message || "Installation could not be completed.", true);
    setDisabled(false);
  }
});

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "content-type": "application/json",
      ...options.headers
    }
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request failed with status ${response.status}.`);
  }

  return body;
}

function selectProfile(profile) {
  const option = form.querySelector(`input[name="profile"][value="${profile}"]`);
  if (option) option.checked = true;
}

function formatStorage(storage) {
  if (storage === "s3") return "Object storage connected";
  if (storage === "local") return "Local media storage";
  return "Media storage disabled";
}

function setDisabled(disabled) {
  for (const control of form.elements) control.disabled = disabled;
}

function setMessage(value, isError = false) {
  message.textContent = value;
  message.classList.toggle("is-error", isError);
}

function setProgress(current) {
  const order = ["system", "site", "account"];
  const currentIndex = current === "complete" ? order.length : order.indexOf(current);

  document.querySelectorAll("[data-step]").forEach((item) => {
    const index = order.indexOf(item.dataset.step);
    item.classList.toggle("is-current", index === currentIndex);
    item.classList.toggle("is-complete", index < currentIndex);
  });
}
