function setFormMessage(form, message, error = false) {
  const element = form.querySelector("[data-form-message]");
  if (!element) return;

  element.textContent = message;
  element.classList.toggle("error", error);
}

function setFormDisabled(form, disabled) {
  form.querySelectorAll("button, input, textarea, select").forEach((field) => {
    field.disabled = disabled;
  });
}

function optionalValue(formData, key) {
  const value = String(formData.get(key) || "").trim();
  return value || undefined;
}

function currentPageSlug() {
  const parts = window.location.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(parts[0] || "")) parts.shift();
  return parts.join("/") || "home";
}

async function responseError(response) {
  try {
    const payload = await response.json();
    return payload?.error?.message || "Unable to send inquiry.";
  } catch {
    return "Unable to send inquiry.";
  }
}

async function submitContactForm(form) {
  const formData = new FormData(form);
  const payload = {
    formKey: String(formData.get("formKey") || "contact").trim(),
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    phone: optionalValue(formData, "phone"),
    subject: optionalValue(formData, "subject"),
    message: String(formData.get("message") || "").trim(),
    website: optionalValue(formData, "website"),
    startedAt: optionalValue(formData, "startedAt"),
    metadata: { pageSlug: currentPageSlug() }
  };

  setFormDisabled(form, true);
  setFormMessage(form, "Sending inquiry...");

  try {
    const response = await fetch("/api/v1/cms/forms/contact", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await responseError(response));

    form.reset();
    const startedAt = form.querySelector('input[name="startedAt"]');
    if (startedAt) startedAt.value = new Date().toISOString();
    setFormMessage(form, "Your inquiry has been received. We will contact you soon.");
  } catch (error) {
    setFormMessage(form, error instanceof Error ? error.message : "Unable to send inquiry.", true);
  } finally {
    setFormDisabled(form, false);
  }
}

export async function startPublicRuntime() {
  const page = document.querySelector("[data-page]");
  let sliderRuntimePromise = document.querySelector("[data-slider]")
    ? import("./slider-runtime.js")
    : null;
  let tabsRuntimePromise = document.querySelector("[data-structured-tabs]")
    ? import("./structured-tabs.js")
    : null;
  const loadSliderRuntime = () => sliderRuntimePromise ??= import("./slider-runtime.js");
  const loadTabsRuntime = () => tabsRuntimePromise ??= import("./structured-tabs.js");

  if (document.querySelector("[data-commerce-root], [data-commerce-account-root]")) {
    const { enhanceCommerce } = await import("./public-commerce.js");
    await enhanceCommerce();
  }

  if (tabsRuntimePromise) (await tabsRuntimePromise).enhanceStructuredTabs(page);

  document.addEventListener("click", (event) => {
    if (event.target?.closest?.("[data-slider-prev], [data-slider-next]")) {
      void loadSliderRuntime().then((runtime) => runtime.handleSliderClick(event));
      return;
    }
    if (event.target?.closest?.("[data-structured-tab]")) {
      void loadTabsRuntime().then((runtime) => runtime.handleStructuredTabClick(event));
    }
  });
  document.addEventListener("keydown", (event) => {
    if (!event.target?.closest?.("[data-structured-tab]")) return;
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    void loadTabsRuntime().then((runtime) => runtime.handleStructuredTabKeydown(event));
  });
  document.addEventListener("submit", (event) => {
    const form = event.target?.closest?.("[data-contact-form]");
    if (!form) return;
    event.preventDefault();
    void submitContactForm(form);
  });
  document.addEventListener("change", (event) => {
    const select = event.target?.closest?.("[data-language-select]");
    if (select?.value) window.location.assign(select.value);
  });
}
