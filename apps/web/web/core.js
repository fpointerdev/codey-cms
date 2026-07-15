const defaultApiUrl = "/api/v1";

function storedValue(key) {
  if (typeof localStorage === "undefined") return "";

  return localStorage.getItem(key) || "";
}

export const state = {
  apiUrl: defaultApiUrl,
  token: storedValue("cms_access_token"),
  refreshToken: storedValue("cms_refresh_token"),
  user: null,
  config: null,
  menu: null,
  page: null,
  builderPage: null,
  builderPageRevisions: [],
  builderRevisionComparison: null,
  builderRevisionSlug: "",
  builderPost: null,
  shopProduct: null,
  shopCategories: [],
  activeBuilderSectionId: null,
  builderRailCollapsed: false,
  builderHistorySlug: "",
  builderUndoStack: [],
  builderRedoStack: [],
  builderPreviewDevice: "desktop",
  adminSidebarCollapsed: false,
  adminSidebarRoute: ""
};

export const elements = {
  get brand() {
    return document.querySelector("[data-brand]");
  },
  get menu() {
    return document.querySelector("[data-menu]");
  },
  get footer() {
    return document.querySelector("[data-footer]");
  },
  get page() {
    return document.querySelector("[data-page]");
  },
  get status() {
    return document.querySelector("[data-status]");
  }
};

export const adminNavItems = [
  { label: "Dashboard", href: "/dashboard", view: "dashboard" },
  {
    label: "Shop",
    href: "/dashboard/shop",
    view: "shop",
    modules: ["products", "orders"],
    permissions: [["read", "products"], ["read", "orders"]]
  },
  {
    label: "Pages",
    href: "/dashboard/pages",
    view: "pages",
    modules: ["cms"],
    permissions: [["read", "cms"]]
  },
  {
    label: "Posts",
    href: "/dashboard/posts",
    view: "posts",
    modules: ["cms"],
    permissions: [["read", "cms"]]
  },
  {
    label: "Users",
    href: "/dashboard/users",
    view: "users",
    modules: ["users", "roles"],
    permissions: [["read", "users"]]
  },
  { label: "Profile", href: "/dashboard/profile", view: "profile", modules: ["auth"] },
  {
    label: "Settings",
    href: "/dashboard/settings",
    view: "settings",
    modules: ["config"],
    permissions: [["manage", "modules"]]
  }
];

function base64Encode(value) {
  if (typeof btoa === "function") return btoa(value);
  if (typeof Buffer !== "undefined") return Buffer.from(value).toString("base64");

  return "";
}

function placeholderImage(width, height, label) {
  const safeLabel = escapeHtml(label).replaceAll("&#039;", "&apos;");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${safeLabel}">`,
    '<rect width="100%" height="100%" fill="#eef2f0"/>',
    `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="Arial, sans-serif" font-size="32">${safeLabel}</text>`,
    "</svg>"
  ].join("");

  return `data:image/svg+xml;base64,${base64Encode(svg)}`;
}

export const componentTemplates = [
  {
    id: "slider",
    label: "Slider",
    description: "Image slider or carousel for hero and project highlights.",
    blocks: [
      {
        type: "GALLERY",
        label: "Slider images",
        value: {
          slides: [
            { url: placeholderImage(1200, 700, "Slide image"), alt: "Slide image", caption: "<p>Write first slide text here.</p>" },
            { url: placeholderImage(1200, 700, "Slide image"), alt: "Slide image", caption: "<p>Write second slide text here.</p>" }
          ],
          settings: {
            slidesPerView: 1,
            overlayColor: "#000000",
            overlayOpacity: 0.25,
            caption: "<p>Write fallback slider text here.</p>",
            textPosition: "bottom-left",
            textWidth: 56,
            displayMode: "slider",
            effect: "slide",
            direction: "horizontal",
            focusMode: "standard",
            containerFade: "none",
            loop: true,
            showNavigation: true,
            navigationStyle: "pill",
            navigationPosition: "bottom-right"
          }
        }
      }
    ]
  },
  {
    id: "carousel",
    label: "Carousel",
    description: "Multi-item carousel with one focused image and neighboring previews.",
    blocks: [
      {
        type: "GALLERY",
        label: "Carousel images",
        value: {
          slides: [
            { url: placeholderImage(1000, 700, "Carousel image"), alt: "Carousel image", caption: "<p>Featured carousel item.</p>" },
            { url: placeholderImage(1000, 700, "Carousel image"), alt: "Carousel image", caption: "<p>Second carousel item.</p>" },
            { url: placeholderImage(1000, 700, "Carousel image"), alt: "Carousel image", caption: "<p>Third carousel item.</p>" }
          ],
          settings: {
            slidesPerView: 1,
            overlayColor: "#000000",
            overlayOpacity: 0.16,
            caption: "<p>Write fallback carousel text here.</p>",
            textPosition: "bottom-left",
            textWidth: 52,
            displayMode: "carousel",
            effect: "slide",
            direction: "horizontal",
            focusMode: "peek",
            containerFade: "horizontal",
            loop: true,
            showNavigation: true,
            navigationStyle: "circle",
            navigationPosition: "center-sides"
          }
        }
      }
    ]
  },
  {
    id: "gallery",
    label: "Gallery",
    description: "Static image grid for gallery, portfolio, or project pages.",
    blocks: [
      {
        type: "GALLERY",
        label: "Gallery images",
        value: {
          items: [
            { url: placeholderImage(900, 700, "Gallery image"), alt: "Gallery image", caption: "Project or image caption" },
            { url: placeholderImage(900, 700, "Gallery image"), alt: "Gallery image", caption: "Project or image caption" },
            { url: placeholderImage(900, 700, "Gallery image"), alt: "Gallery image", caption: "Project or image caption" }
          ],
          settings: {
            displayMode: "gallery",
            layoutMode: "grid",
            columnsDesktop: 3,
            columnsTablet: 2,
            columnsMobile: 1,
            gap: 16,
            imageRatio: "4 / 3",
            objectFit: "cover",
            showCaptions: true,
            lightbox: true
          }
        }
      }
    ]
  },
  {
    id: "hero-creative",
    label: "Creative Hero",
    description: "Premium hero with headline, CTA, stats, and visual direction.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Hero content",
        value: {
          variant: "hero-creative",
          eyebrow: "Built for growth",
          title: "Innovation, creativity, effect.",
          body: "Create a strong first impression with a clear message, premium visual rhythm, and focused calls to action.",
          cta: { label: "Start a project", url: "/contact" },
          stats: [
            { value: "90%", label: "Audience engagement" },
            { value: "2K", label: "Monthly interactions" },
            { value: "98%", label: "Positive feedback" }
          ]
        }
      }
    ]
  },
  {
    id: "stats-grid",
    label: "Stats Grid",
    description: "Metric cards for proof points, results, and company scale.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Stats",
        value: {
          variant: "stats-grid",
          title: "Proof points",
          stats: [
            { value: "90%", label: "Audience engagement" },
            { value: "2K", label: "Monthly interactions" },
            { value: "98%", label: "Positive feedback" },
            { value: "1MLN", label: "Processed events" }
          ]
        }
      }
    ]
  },
  {
    id: "feature-cards",
    label: "Feature Cards",
    description: "Reusable cards for services, features, process, or industries.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Cards",
        value: {
          variant: "feature-cards",
          title: "What we deliver",
          body: "Use this element for services, process steps, industries, or product capabilities.",
          items: [
            { title: "Product strategy", body: "Plan and prioritize the work that matters most.", label: "01" },
            { title: "Back-end development", body: "Build reliable systems for content, shop, and operations.", label: "02" },
            { title: "User experience", body: "Shape clear interfaces that customers understand quickly.", label: "03" }
          ]
        }
      }
    ]
  },
  {
    id: "team-section",
    label: "Team Section",
    description: "Team cards with names, roles, images, and short bios.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Team",
        value: {
          variant: "team-section",
          title: "Meet the team",
          items: [
            { title: "Stewart Hopkins", label: "CEO", image: { url: placeholderImage(500, 700, "Team member"), alt: "Team member" } },
            { title: "Kristen Walt", label: "UI Designer", image: { url: placeholderImage(500, 700, "Team member"), alt: "Team member" } },
            { title: "Thomas Collins", label: "Developer", image: { url: placeholderImage(500, 700, "Team member"), alt: "Team member" } }
          ]
        }
      }
    ]
  },
  {
    id: "logo-grid",
    label: "Logo Grid",
    description: "Partner, client, certification, or technology logo grid.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Logos",
        value: {
          variant: "logo-grid",
          title: "Trusted by",
          items: [
            { title: "Partner one", image: { url: placeholderImage(320, 160, "Partner logo"), alt: "Partner logo" } },
            { title: "Partner two", image: { url: placeholderImage(320, 160, "Partner logo"), alt: "Partner logo" } },
            { title: "Partner three", image: { url: placeholderImage(320, 160, "Partner logo"), alt: "Partner logo" } }
          ]
        }
      }
    ]
  },
  {
    id: "testimonials",
    label: "Testimonials",
    description: "Customer quote cards for trust and social proof.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Testimonials",
        value: {
          variant: "testimonials",
          title: "What customers say",
          items: [
            { title: "Reliable and clear", body: "The team delivered exactly what we needed and kept communication practical.", label: "Client review" },
            { title: "Strong execution", body: "The project moved from concept to production without confusion.", label: "Partner review" }
          ]
        }
      }
    ]
  },
  {
    id: "pricing-cards",
    label: "Pricing Cards",
    description: "Plan, package, or subscription cards.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Pricing",
        value: {
          variant: "pricing-cards",
          title: "Packages",
          items: [
            { title: "Starter", value: "0.60 EUR/mo", body: "Basic website presence.", url: "/contact" },
            { title: "Business", value: "10 EUR/mo", body: "CMS, shop, and growth tools.", url: "/contact" }
          ]
        }
      }
    ]
  },
  {
    id: "faq-accordion",
    label: "FAQ Accordion",
    description: "Question and answer layout for support and landing pages.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Questions",
        value: {
          variant: "faq-accordion",
          title: "Questions",
          items: [
            { title: "Can I edit this content later?", body: "Yes. The CMS keeps the page editable after generation." },
            { title: "Can this section be translated?", body: "Yes. Localization can be enabled per copied site." }
          ]
        }
      }
    ]
  },
  {
    id: "tabs",
    label: "Tabs",
    description: "Tabbed content for grouped services, specifications, or process details.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Tabs",
        value: {
          variant: "tabs",
          title: "Explore the details",
          body: "Organize related content into clear panels without making the page feel heavy.",
          items: [
            { title: "Overview", body: "Introduce the main idea, service, or product family." },
            { title: "Capabilities", body: "Describe what is included and how the work is delivered." },
            { title: "Requirements", body: "List useful notes, preparation steps, or technical conditions." }
          ]
        }
      }
    ]
  },
  {
    id: "accordion",
    label: "Accordion",
    description: "Expandable panels for dense content, service details, or policies.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Accordion panels",
        value: {
          variant: "accordion",
          title: "Details",
          items: [
            { title: "Planning", body: "Clarify goals, timeline, materials, and responsibilities before production starts." },
            { title: "Delivery", body: "Keep the process transparent with practical updates and defined acceptance steps." },
            { title: "Support", body: "Document the final setup so the site owner can continue editing safely." }
          ]
        }
      }
    ]
  },
  {
    id: "text-layout",
    label: "Text Layout",
    description: "Heading and rich text copy for company or service sections.",
    blocks: [
      { type: "TEXT", label: "Heading", value: "Section heading" },
      { type: "RICH_TEXT", label: "Body", value: "Write the content for this section." }
    ]
  },
  {
    id: "image-text",
    label: "Image + Text",
    description: "Image with supporting content for products, services, or story sections.",
    blocks: [
      { type: "IMAGE", label: "Image", value: { url: placeholderImage(900, 650, "Section image"), alt: "Section image" } },
      { type: "RICH_TEXT", label: "Text", value: "Explain this image or section." }
    ]
  },
  {
    id: "cta",
    label: "CTA",
    description: "Call-to-action block for inquiries, booking, or checkout.",
    blocks: [
      { type: "RICH_TEXT", label: "CTA copy", value: "Ready to start? Send us a request." },
      { type: "CTA", label: "CTA button", value: { label: "Contact us", url: "#contact" } }
    ]
  },
  {
    id: "contact-form",
    label: "Contact Form",
    description: "Public inquiry form backed by CMS contact submissions.",
    blocks: [
      {
        type: "CONTACT_FORM",
        label: "Inquiry form",
        value: {
          formKey: "contact",
          subject: "Website inquiry",
          buttonLabel: "Send inquiry"
        }
      }
    ]
  },
  {
    id: "product-list",
    label: "Product List",
    description: "Product slot controlled by the shop module.",
    modules: ["products"],
    blocks: [
      { type: "PRODUCT_LIST", label: "Products", value: { productSlugs: ["starter-product"] } }
    ]
  }
];

export const sectionPatternTemplates = [
  {
    id: "hero-proof",
    label: "Hero + proof",
    description: "Hero message with CTA, stats, and proof cards.",
    category: "Hero",
    elements: ["hero-creative", "stats-grid"],
    settings: {
      patternId: "hero-proof",
      layout: "asymmetric",
      container: "wide",
      spacing: "xl",
      gap: "xl",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: {
        preset: "premium-dark",
        backgroundColor: "#12172b",
        textColor: "#ffffff",
        accentColor: "#5b5cff",
        radius: 24,
        shadow: "glow"
      },
      decoration: {
        type: "spotlight",
        position: "center-right",
        color: "#5b5cff",
        opacity: 0.32
      }
    }
  },
  {
    id: "service-showcase",
    label: "Service showcase",
    description: "Image-led service section with capability cards.",
    category: "Content",
    elements: ["image-text", "feature-cards"],
    settings: {
      patternId: "service-showcase",
      layout: "two-column",
      container: "wide",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "two-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: {
        preset: "editorial-light",
        backgroundColor: "#f8faf7",
        textColor: "#1e2329",
        accentColor: "#0d7c68",
        radius: 0,
        shadow: "none"
      },
      decoration: {
        type: "none",
        position: "bottom-right",
        color: "#0d7c68",
        opacity: 0.2
      }
    }
  },
  {
    id: "split-hero",
    label: "Split hero",
    description: "Hero copy paired with media or proof for B2B landing pages.",
    category: "Hero",
    elements: ["hero-creative", "slider"],
    settings: {
      patternId: "split-hero",
      layout: "asymmetric",
      container: "wide",
      spacing: "xl",
      gap: "xl",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: {
        preset: "premium-dark",
        backgroundColor: "#12172b",
        textColor: "#ffffff",
        accentColor: "#5b5cff",
        radius: 24,
        shadow: "glow"
      },
      decoration: {
        type: "spotlight",
        position: "center-right",
        color: "#5b5cff",
        opacity: 0.32
      }
    }
  },
  {
    id: "media-band",
    label: "Media band",
    description: "Wide gallery or carousel band with concise context above the media.",
    category: "Trust",
    elements: ["text-layout", "carousel"],
    settings: {
      patternId: "media-band",
      layout: "full-bleed",
      container: "wide",
      spacing: "xl",
      gap: "lg",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: {
        preset: "editorial-light",
        backgroundColor: "#f8faf7",
        textColor: "#1e2329",
        accentColor: "#0d7c68",
        radius: 0,
        shadow: "none"
      },
      decoration: {
        type: "grid",
        position: "bottom-right",
        color: "#0d7c68",
        opacity: 0.14
      }
    }
  },
  {
    id: "process-tabs",
    label: "Process tabs",
    description: "Intro copy with editable tabbed details.",
    category: "Content",
    elements: ["text-layout", "tabs"],
    settings: {
      patternId: "process-tabs",
      layout: "two-column",
      container: "default",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: {
        preset: "framed-card",
        backgroundColor: "#ffffff",
        textColor: "#1e2329",
        accentColor: "#0d7c68",
        radius: 18,
        shadow: "soft"
      },
      decoration: {
        type: "frame",
        position: "bottom-right",
        color: "#0d7c68",
        opacity: 0.22
      }
    }
  },
  {
    id: "portfolio-gallery",
    label: "Portfolio gallery",
    description: "Gallery section with heading and editable media.",
    category: "Trust",
    elements: ["text-layout", "gallery"],
    settings: {
      patternId: "portfolio-gallery",
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "inherit", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: {
        preset: "editorial-light",
        backgroundColor: "#f8faf7",
        textColor: "#1e2329",
        accentColor: "#0d7c68",
        radius: 0,
        shadow: "none"
      },
      decoration: {
        type: "grid",
        position: "bottom-right",
        color: "#0d7c68",
        opacity: 0.14
      }
    }
  },
  {
    id: "pricing-trust",
    label: "Pricing + trust",
    description: "Pricing cards paired with customer proof.",
    category: "Commerce",
    elements: ["pricing-cards", "testimonials"],
    settings: {
      patternId: "pricing-trust",
      layout: "two-column",
      container: "wide",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "two-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: {
        preset: "framed-card",
        backgroundColor: "#ffffff",
        textColor: "#1e2329",
        accentColor: "#0d7c68",
        radius: 18,
        shadow: "soft"
      },
      decoration: {
        type: "frame",
        position: "bottom-right",
        color: "#0d7c68",
        opacity: 0.22
      }
    }
  },
  {
    id: "faq-contact",
    label: "FAQ + contact",
    description: "Questions with a contact form beside them.",
    category: "Contact",
    elements: ["faq-accordion", "contact-form"],
    settings: {
      patternId: "faq-contact",
      layout: "two-column",
      container: "default",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "two-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: {
        preset: "editorial-light",
        backgroundColor: "#f8faf7",
        textColor: "#1e2329",
        accentColor: "#0d7c68",
        radius: 0,
        shadow: "none"
      },
      decoration: {
        type: "none",
        position: "bottom-right",
        color: "#0d7c68",
        opacity: 0.2
      }
    }
  }
];

export const pageLayoutOptions = [
  { value: "full-width", label: "Full width" },
  { value: "grid", label: "Grid" }
];

export const defaultPage = {
  title: "Code Epsylon",
  slug: "home",
  status: "STATIC",
  excerpt: "A modular base project ready for CMS, shop, presentation, and custom client websites.",
  metaTitle: "Code Epsylon",
  metaDescription: "Modular project foundation.",
  content: {
    footerText: `© ${new Date().getFullYear()} Code Epsylon.`
  },
  sections: [
    {
      id: "fallback-intro",
      key: "fallback-intro",
      label: "Project foundation",
      blocks: [
        {
          key: "fallback-intro-copy",
          type: "RICH_TEXT",
          label: "Intro copy",
          value:
            "This project is ready for setup. Enable CMS content to edit live pages, or continue configuring users, modules, and deployment.",
          sortOrder: 0,
          editable: true
        }
      ]
    }
  ]
};

export function resetState() {
  state.apiUrl = defaultApiUrl;
  state.token = storedValue("cms_access_token");
  state.refreshToken = storedValue("cms_refresh_token");
  state.user = null;
  state.config = null;
  state.menu = null;
  state.page = null;
  state.builderPage = null;
  state.builderPageRevisions = [];
  state.builderRevisionComparison = null;
  state.builderRevisionSlug = "";
  state.builderPost = null;
  state.shopProduct = null;
  state.shopCategories = [];
  state.activeBuilderSectionId = null;
  state.builderRailCollapsed = false;
  state.builderHistorySlug = "";
  state.builderUndoStack = [];
  state.builderRedoStack = [];
  state.builderPreviewDevice = "desktop";
  state.adminSidebarCollapsed = false;
  state.adminSidebarRoute = "";
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function headers() {
  const requestHeaders = {
    "content-type": "application/json"
  };

  if (state.token) {
    requestHeaders.authorization = `Bearer ${state.token}`;
  }

  return requestHeaders;
}

function clearStoredSession() {
  state.token = "";
  state.refreshToken = "";
  state.user = null;
  localStorage.removeItem("cms_access_token");
  localStorage.removeItem("cms_refresh_token");
}

async function readApiBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

let refreshSessionPromise = null;

async function refreshSession() {
  if (!state.refreshToken) return false;
  if (refreshSessionPromise) return refreshSessionPromise;

  const pendingRefresh = (async () => {
    const response = await fetch(`${state.apiUrl}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: state.refreshToken })
    });
    const body = await readApiBody(response);

    if (!response.ok || !body?.success || !body.data?.tokens) {
      clearStoredSession();
      return false;
    }

    state.token = body.data.tokens.accessToken;
    state.refreshToken = body.data.tokens.refreshToken;
    state.user = body.data.user || state.user;
    localStorage.setItem("cms_access_token", state.token);
    localStorage.setItem("cms_refresh_token", state.refreshToken);
    return true;
  })();

  refreshSessionPromise = pendingRefresh;

  try {
    return await pendingRefresh;
  } catch {
    clearStoredSession();
    return false;
  } finally {
    if (refreshSessionPromise === pendingRefresh) refreshSessionPromise = null;
  }
}

function canRefreshRequest(path) {
  return Boolean(
    state.token &&
    state.refreshToken &&
    !["/auth/login", "/auth/refresh", "/auth/logout"].includes(path.split("?")[0])
  );
}

async function apiRequest(path, options, allowRefresh) {
  const requestAccessToken = state.token;
  const response = await fetch(`${state.apiUrl}${path}`, {
    ...options,
    headers: {
      ...headers(),
      ...options.headers
    }
  });
  const body = await readApiBody(response);

  if (response.status === 401 && allowRefresh && canRefreshRequest(path)) {
    if (requestAccessToken && requestAccessToken !== state.token) {
      return apiRequest(path, options, false);
    }
    if (await refreshSession()) return apiRequest(path, options, false);
  } else if (response.status === 401 && state.token && !state.refreshToken) {
    clearStoredSession();
  }

  if (!response.ok || !body?.success) {
    const error = new Error(body?.error?.message || `Request failed with status ${response.status}.`);
    error.status = response.status;
    error.code = body?.error?.code;
    throw error;
  }

  return body.data;
}

export async function api(path, options = {}) {
  return apiRequest(path, options, true);
}

export function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

export function hasPermission(action, subject) {
  if (!state.user?.permissions) return false;

  return state.user.permissions.some(
    (permission) =>
      (permission.action === "manage" && permission.subject === "all") ||
      (permission.action === action && permission.subject === subject)
  );
}

export function hasAnyPermission(requirements = []) {
  if (!requirements.length) return true;

  return requirements.some(([action, subject]) => hasPermission(action, subject));
}

export function setRuntimeConfig(config) {
  state.config = config || null;
  return state.config;
}

export function moduleEnabled(moduleId) {
  if (!moduleId) return true;
  if (!state.config) return true;

  const featureFlag = state.config.features?.[moduleId];
  if (featureFlag === false) return false;

  const installedModules = state.config.installedModules || [];
  const installedModule = installedModules.find((module) => module.moduleId === moduleId);

  if (installedModule) return installedModule.status === "ENABLED";
  if (typeof featureFlag === "boolean") return featureFlag;

  return Boolean(state.config.modules?.[moduleId]?.required);
}

export function modulesEnabled(moduleIds = []) {
  return moduleIds.every(moduleEnabled);
}

export function availableAdminNavItems() {
  return adminNavItems.filter((item) =>
    modulesEnabled(item.modules || []) &&
    hasAnyPermission(item.permissions || [])
  );
}

function runtimeBuilderElements() {
  return Array.isArray(state.config?.builder?.elements) ? state.config.builder.elements : [];
}

function runtimeBuilderElement(templateId) {
  return runtimeBuilderElements().find((element) => element.id === templateId);
}

function runtimeSectionPatterns() {
  return Array.isArray(state.config?.builder?.sectionPatterns) ? state.config.builder.sectionPatterns : [];
}

export function availableComponentTemplates() {
  const registryElements = runtimeBuilderElements();

  return componentTemplates.filter((template) => {
    const registeredElement = runtimeBuilderElement(template.id);

    if (registryElements.length) {
      if (!registeredElement || registeredElement.generatorSafe === false) return false;
      return modulesEnabled(registeredElement.modules || []);
    }

    return modulesEnabled(template.modules || []);
  });
}

export function availableSectionPatterns() {
  const availableTemplateIds = new Set(availableComponentTemplates().map((template) => template.id));
  const runtimePatterns = runtimeSectionPatterns();
  const runtimePatternIds = new Set(runtimePatterns.map((pattern) => pattern.id));

  return sectionPatternTemplates.filter((pattern) => {
    if (runtimePatterns.length && !runtimePatternIds.has(pattern.id)) return false;
    return pattern.elements.every((templateId) => availableTemplateIds.has(templateId));
  });
}

export function formatRoles(user) {
  const roles = user.roles || [];

  return roles
    .map((item) => item.role?.name || item)
    .filter(Boolean)
    .join(", ") || "No roles";
}

export function formatDate(value) {
  if (!value) return "Not set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function formatMoney(cents, currency = "EUR") {
  const amount = Number(cents || 0) / 100;

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function slugFromTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `item-${Date.now()}`;
}

export function normalizePageLayout(value) {
  return pageLayoutOptions.some((option) => option.value === value) ? value : "full-width";
}

function pathLocale() {
  if (typeof window === "undefined") return "";

  const params = new URLSearchParams(window.location.search || "");
  const queryLocale = params.get("locale");
  if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(queryLocale || "")) return queryLocale.toLowerCase();

  const [firstPart] = (window.location.pathname || "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);

  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(firstPart || "") ? firstPart.toLowerCase() : "";
}

export function translateString(key, fallback = "", locale = "") {
  const localization = state.config?.localization || {};
  const strings = localization.strings || {};
  const localeCode = String(locale || pathLocale() || localization.defaultLocale || "en").toLowerCase();
  const fallbackLocale = String(localization.fallbackLocale || localization.defaultLocale || "en").toLowerCase();
  const defaultLocale = String(localization.defaultLocale || "en").toLowerCase();
  const translations = strings[key] || {};

  return translations[localeCode] || translations[fallbackLocale] || translations[defaultLocale] || fallback;
}

export function layoutOptionHtml(value = "full-width") {
  const selectedValue = normalizePageLayout(value);

  return pageLayoutOptions
    .map(
      (option) => `
        <option value="${escapeHtml(option.value)}"${option.value === selectedValue ? " selected" : ""}>
          ${escapeHtml(option.label)}
        </option>
      `
    )
    .join("");
}

export function buildTemplateSection(templateId, sectionKey, sortOrder = 0) {
  const templates = availableComponentTemplates();
  const template = templates.find((item) => item.id === templateId) || templates[0] || componentTemplates[0];

  return {
    key: sectionKey,
    label: template.label,
    sortOrder,
    settings: {
      templateId: template.id,
      elementId: template.id
    },
    blocks: template.blocks.map((block, index) => ({
      key: `${sectionKey}-${block.type.toLowerCase()}-${index + 1}`,
      type: block.type,
      label: block.label,
      value: clonePlain(block.value),
      settings: {
        ...(block.settings || {}),
        elementId: template.id
      },
      sortOrder: index,
      editable: true
    }))
  };
}

function clonePlain(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function uniqueSectionKey(page, baseKey) {
  const existingKeys = new Set((page.sections || []).map((section) => section.key));
  let key = baseKey;
  let index = 2;

  while (existingKeys.has(key)) {
    key = `${baseKey}-${index}`;
    index += 1;
  }

  return key;
}

function applyRichTextToSection(section, heading, body) {
  let richTextApplied = false;
  let headingApplied = false;

  return {
    ...section,
    blocks: section.blocks.map((block) => {
      if (!headingApplied && block.type === "TEXT") {
        headingApplied = true;
        return { ...block, value: heading || block.value };
      }

      if (!richTextApplied && block.type === "RICH_TEXT") {
        richTextApplied = true;
        return { ...block, value: body || block.value };
      }

      return block;
    })
  };
}

export function sectionFromTemplate(templateId, page, body = "", heading = "Section heading") {
  const sectionKey = uniqueSectionKey(page, `${templateId}-${Date.now()}`);
  const section = buildTemplateSection(templateId, sectionKey, page.sections?.length || 0);

  return applyRichTextToSection(section, heading, body);
}

export function buildSectionPattern(patternId, page, sortOrder = 0) {
  const patterns = availableSectionPatterns();
  const pattern = patterns.find((item) => item.id === patternId) || patterns[0] || sectionPatternTemplates[0];
  const templates = availableComponentTemplates();
  const sectionKey = uniqueSectionKey(page, `${pattern.id}-${Date.now()}`);
  const blocks = [];

  for (const templateId of pattern.elements) {
    const template = templates.find((item) => item.id === templateId);
    if (!template) continue;

    for (const block of template.blocks) {
      blocks.push({
        key: `${sectionKey}-${template.id}-${block.type.toLowerCase()}-${blocks.length + 1}`,
        type: block.type,
        label: block.label,
        value: clonePlain(block.value),
        settings: {
          ...(block.settings || {}),
          elementId: template.id
        },
        sortOrder: blocks.length,
        editable: true
      });
    }
  }

  return {
    key: sectionKey,
    label: pattern.label,
    sortOrder,
    settings: {
      ...clonePlain(pattern.settings),
      template: "content",
      patternId: pattern.id,
      elementId: pattern.elements[0] || "structured-content"
    },
    blocks
  };
}
