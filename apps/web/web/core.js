import { recordPageChange } from "./editor-sync.js";

const defaultApiUrl = "/api/v1";

function storedValue(key) {
  if (typeof localStorage === "undefined") return "";

  return localStorage.getItem(key) || "";
}

function removeLegacyTokens() {
  if (typeof localStorage === "undefined") return;

  localStorage.removeItem("cms_access_token");
  localStorage.removeItem("cms_refresh_token");
}

removeLegacyTokens();

export const state = {
  apiUrl: defaultApiUrl,
  token: "",
  hasSession: storedValue("cms_session_hint") === "1",
  user: null,
  config: null,
  publicRenderLocale: "",
  menu: null,
  page: null,
  builderPage: null,
  builderPageChangeToken: "",
  builderPageRevisions: [],
  builderRevisionComparison: null,
  builderRevisionSlug: "",
  builderPost: null,
  shopProduct: null,
  shopCategories: [],
  activeBuilderSectionId: null,
  activeBuilderBlockKey: "",
  builderClipboard: null,
  builderRailCollapsed: false,
  builderRailView: "library",
  builderHistorySlug: "",
  builderUndoStack: [],
  builderRedoStack: [],
  builderCanvasView: "edit",
  builderPreviewDevice: "desktop",
  cmsTemplates: [],
  contentCollections: [],
  visualEditorActive: false,
  visualEditorSelection: null,
  visualEditorEditingBlockKey: "",
  visualEditorHistoryKey: "",
  visualEditorUndoStack: [],
  visualEditorRedoStack: [],
  visualEditorDevice: "desktop",
  visualEditorLibraryOpen: false,
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
    label: "Collections",
    href: "/dashboard/collections",
    view: "collections",
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
  if (globalThis.Buffer) return globalThis.Buffer.from(value).toString("base64");

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
    id: "heading",
    label: "Heading",
    description: "Add a clear heading without a prebuilt layout.",
    blocks: [
      { type: "TEXT", label: "Heading", value: "Section heading" }
    ]
  },
  {
    id: "rich-text",
    label: "Rich Text",
    description: "Add formatted paragraphs, lists, and links.",
    blocks: [
      { type: "RICH_TEXT", label: "Content", value: "<p>Write your content here.</p>" }
    ]
  },
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
            { url: placeholderImage(1200, 700, "Slide image"), alt: "Slide image", width: 1200, height: 700, caption: "<p>Write first slide text here.</p>" },
            { url: placeholderImage(1200, 700, "Slide image"), alt: "Slide image", width: 1200, height: 700, caption: "<p>Write second slide text here.</p>" }
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
    id: "image-comparison",
    label: "Image Comparison",
    description: "Accessible before-and-after or option comparison with two clearly labelled images.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Image comparison",
        value: {
          variant: "image-comparison",
          title: "See the difference",
          body: "Compare the two views side by side.",
          items: [
            {
              title: "Before",
              image: { url: placeholderImage(1000, 750, "Before image"), alt: "Before view" }
            },
            {
              title: "After",
              image: { url: placeholderImage(1000, 750, "After image"), alt: "After view" }
            }
          ],
          display: { alignment: "left", density: "comfortable", surface: "plain", presentation: "split" }
        }
      }
    ]
  },
  {
    id: "image",
    label: "Image",
    description: "Add one image with accessible alternative text.",
    blocks: [
      {
        type: "IMAGE",
        label: "Image",
        value: {
          url: placeholderImage(1200, 800, "Content image"),
          alt: "Content image",
          width: 1200,
          height: 800
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
          ],
          display: { alignment: "left", density: "comfortable", surface: "outline", columns: 3, presentation: "cards" }
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
          ],
          display: { alignment: "left", density: "comfortable", surface: "outline", columns: 2, presentation: "cards" }
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
          ],
          display: { alignment: "left", density: "comfortable", surface: "outline", columns: 2, presentation: "cards" }
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
    id: "process-steps",
    label: "Process Steps",
    description: "Ordered steps for services, onboarding, delivery, or customer journeys.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Process steps",
        value: {
          variant: "process-steps",
          title: "How it works",
          body: "Make the next steps clear and easy to scan.",
          items: [
            { title: "Discover", body: "Clarify the goal, audience, scope, and success criteria.", label: "Step 1" },
            { title: "Create", body: "Build the solution and review the important decisions together.", label: "Step 2" },
            { title: "Launch", body: "Publish, verify, and hand over a setup that stays easy to manage.", label: "Step 3" }
          ],
          display: { alignment: "left", density: "comfortable", surface: "outline", columns: 3, showNumbers: true }
        }
      }
    ]
  },
  {
    id: "comparison-table",
    label: "Comparison Table",
    description: "Accessible comparison for plans, services, products, or capabilities.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Comparison",
        value: {
          variant: "comparison-table",
          title: "Compare options",
          body: "Help visitors understand the differences without reading several pages.",
          firstColumnTitle: "Standard",
          secondColumnTitle: "Advanced",
          items: [
            { title: "Core features", firstValue: "Included", secondValue: "Included" },
            { title: "Custom configuration", firstValue: "Optional", secondValue: "Included" },
            { title: "Priority support", firstValue: "No", secondValue: "Included" }
          ],
          display: { alignment: "left", density: "comfortable", surface: "outline", striped: true }
        }
      }
    ]
  },
  {
    id: "video",
    label: "Video",
    description: "Self-hosted MP4 or WebM video with accessible supporting content.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Video",
        value: {
          variant: "video",
          title: "Video title",
          body: "Add context so visitors and search engines understand the video.",
          url: "",
          display: { alignment: "left", presentation: "inline", ratio: "16 / 9", preload: "metadata", loop: false, playback: "controls" }
        }
      }
    ]
  },
  {
    id: "image-hotspots",
    label: "Interactive Image",
    description: "Position linked products, objects, locations, or details over an image scene.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Interactive image",
        value: {
          variant: "image-hotspots",
          title: "Explore the scene",
          body: "Select a placement to view more information.",
          image: {
            url: placeholderImage(1600, 1000, "Interactive scene"),
            alt: "Interactive scene"
          },
          hotspots: [
            {
              title: "Featured item",
              body: "Add a short description for this placement.",
              x: 34,
              y: 58,
              width: 10,
              productSlug: "starter-product",
              image: {
                url: placeholderImage(260, 420, "Placed item"),
                alt: "Placed item"
              }
            },
            {
              title: "Second item",
              x: 68,
              y: 42,
              productSlug: "starter-product"
            }
          ],
          display: { ratio: "16 / 10" }
        }
      }
    ]
  },
  {
    id: "timeline",
    label: "Timeline",
    description: "Chronological milestones for company history, projects, roadmaps, or launch plans.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Timeline",
        value: {
          variant: "timeline",
          title: "Our journey",
          body: "Show the milestones that explain how the work developed.",
          items: [
            { title: "Foundation", body: "Set the direction and define the first practical goal.", label: "2022" },
            { title: "Growth", body: "Expand the work based on customer needs and proven results.", label: "2024" },
            { title: "Today", body: "Keep improving the experience with a clear next milestone.", label: "2026" }
          ],
          display: { alignment: "left", density: "comfortable", surface: "plain", presentation: "line" }
        }
      }
    ]
  },
  {
    id: "checklist",
    label: "Checklist",
    description: "Scannable benefits, requirements, inclusions, or readiness points.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Checklist",
        value: {
          variant: "checklist",
          title: "What is included",
          body: "Keep the most important points easy to scan.",
          items: [
            { title: "Clear scope", body: "Everyone understands the expected outcome." },
            { title: "Practical delivery", body: "The process stays focused on usable results." },
            { title: "Easy handover", body: "The final setup remains simple to manage." },
            { title: "Documented support", body: "Important decisions and next steps stay visible." }
          ],
          display: { alignment: "left", density: "comfortable", surface: "soft", columns: 2 }
        }
      }
    ]
  },
  {
    id: "resource-list",
    label: "Resource List",
    description: "Accessible links to guides, documents, downloads, policies, or related pages.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Resources",
        value: {
          variant: "resource-list",
          title: "Resources",
          body: "Give visitors a clear path to useful supporting material.",
          items: [
            { title: "Getting started", body: "The first steps and information visitors need.", label: "Guide", url: "/getting-started" },
            { title: "Service details", body: "A concise overview of scope and delivery.", label: "Overview", url: "/services" },
            { title: "Frequently asked questions", body: "Answers to common practical questions.", label: "Support", url: "/faq" }
          ],
          display: { alignment: "left", density: "comfortable", surface: "outline", presentation: "rows" }
        }
      }
    ]
  },
  {
    id: "location-cards",
    label: "Location Cards",
    description: "Addresses, service areas, opening hours, and contact links for one or more locations.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Locations",
        value: {
          variant: "location-cards",
          title: "Visit us",
          body: "Help visitors find the right location and contact details.",
          items: [
            { title: "Main office", body: "Add the street, city, postal code, and contact details.", label: "Monday to Friday, 09:00-17:00", url: "/contact" },
            { title: "Service area", body: "Describe the regions or communities this location serves.", label: "Appointments available", url: "/contact" }
          ],
          display: { alignment: "left", density: "comfortable", surface: "soft", columns: 2 }
        }
      }
    ]
  },
  {
    id: "quote-highlight",
    label: "Quote Highlight",
    description: "Focused testimonial, founder statement, editorial pull quote, or customer insight.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Quote",
        value: {
          variant: "quote-highlight",
          title: "Customer perspective",
          body: "A clear process makes complex work feel simple and gives people confidence in every decision.",
          attribution: "Name, role or source",
          display: { alignment: "left", density: "comfortable", surface: "plain", presentation: "editorial" }
        }
      }
    ]
  },
  {
    id: "bento-grid",
    label: "Bento Grid",
    description: "A premium capability grid with one featured item and compact supporting cards.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Bento grid",
        value: {
          variant: "bento-grid",
          title: "Designed around what matters",
          body: "Lead with the strongest benefit, then make the supporting details easy to scan.",
          items: [
            { title: "Flagship capability", body: "Explain the strongest reason to choose this offer.", label: "Featured", featured: true },
            { title: "Fast decisions", body: "Keep choices clear and the next step obvious.", label: "Simple" },
            { title: "Built to scale", body: "Show how the solution grows with the customer.", label: "Reliable" },
            { title: "Easy handover", body: "Make ownership and day-to-day management straightforward.", label: "Clear" }
          ],
          display: { alignment: "left", density: "comfortable", surface: "soft", columns: 4, presentation: "spotlight" }
        }
      }
    ]
  },
  {
    id: "navigation-cards",
    label: "Navigation Cards",
    description: "Clear, linked cards that guide visitors to services, categories, resources, or next steps.",
    blocks: [
      {
        type: "CUSTOM",
        label: "Navigation cards",
        value: {
          variant: "navigation-cards",
          title: "Where would you like to go?",
          body: "Give visitors a small set of clear paths instead of making them search through menus.",
          items: [
            { title: "Explore services", body: "Find the right solution for your goal.", label: "Services", url: "/services" },
            { title: "See our work", body: "Review relevant projects and outcomes.", label: "Case studies", url: "/work" },
            { title: "Start a conversation", body: "Tell us what you need and get a clear next step.", label: "Contact", url: "/contact" }
          ],
          display: { alignment: "left", density: "comfortable", surface: "outline", columns: 3, presentation: "cards" }
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
    id: "button",
    label: "Button",
    description: "Add a focused link or action without extra copy.",
    blocks: [
      { type: "BUTTON", label: "Button", value: { label: "Learn more", url: "#" } }
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
      {
        type: "PRODUCT_LIST",
        label: "Products",
        value: {
          title: "Featured products",
          body: "Choose a focused selection from the live catalog.",
          productSlugs: ["starter-product"],
          layout: "grid",
          columns: 3,
          showDescription: true
        }
      }
    ]
  },
  {
    id: "product-showcase",
    label: "Product Showcase",
    description: "Focused product feature with live image, price, availability, and purchase action.",
    modules: ["products"],
    blocks: [
      {
        type: "PRODUCT_LIST",
        label: "Featured product",
        value: {
          title: "Featured product",
          body: "Give one important product more room to stand out.",
          productSlugs: ["starter-product"],
          layout: "spotlight",
          columns: 2,
          showDescription: true
        }
      }
    ]
  },
  {
    id: "custom-code",
    label: "Custom Code",
    description: "Sandboxed HTML, CSS, JavaScript, and external libraries for custom widgets.",
    blocks: [
      {
        type: "EMBED",
        label: "Custom code",
        value: {
          html: '<div class="codey-widget">Custom widget</div>',
          css: ".codey-widget { padding: 24px; font: 600 16px/1.5 system-ui, sans-serif; }",
          javascript: "",
          libraries: [],
          height: 320
        }
      }
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
    id: "glass-interface-banner",
    label: "Glass interface banner",
    description: "Dark interactive banner with focused copy and a translucent media surface.",
    category: "Hero",
    elements: ["hero-creative", "image"],
    settings: {
      patternId: "glass-interface-banner",
      bannerVariant: "glass-interface",
      layout: "asymmetric",
      container: "wide",
      spacing: "xl",
      gap: "xl",
      align: "start",
      verticalAlign: "center",
      minHeight: 680,
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "premium-dark", backgroundColor: "#0d1117", textColor: "#ffffff", accentColor: "#c9ff67", radius: 28, shadow: "glow" },
      decoration: { type: "spotlight", position: "center-right", color: "#8b73ff", opacity: 0.3 },
      animation: { effect: "fade-up", durationMs: 700, delayMs: 0 }
    }
  },
  {
    id: "kinetic-product-banner",
    label: "Kinetic product banner",
    description: "Editorial product banner with oversized type and overlapping product media.",
    category: "Hero",
    elements: ["hero-creative", "image"],
    settings: {
      patternId: "kinetic-product-banner",
      bannerVariant: "kinetic-product",
      layout: "asymmetric",
      container: "wide",
      spacing: "xl",
      gap: "lg",
      align: "start",
      verticalAlign: "center",
      minHeight: 680,
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "editorial-light", backgroundColor: "#f2c94c", textColor: "#17140f", accentColor: "#17140f", radius: 24, shadow: "strong" },
      decoration: { type: "split", position: "center-right", color: "#ffffff", opacity: 0.24 },
      animation: { effect: "reveal-up", durationMs: 700, delayMs: 0 }
    }
  },
  {
    id: "floating-product-banner",
    label: "Floating product banner",
    description: "Premium dark banner with quiet copy and a floating product or fashion visual.",
    category: "Hero",
    elements: ["hero-creative", "image"],
    settings: {
      patternId: "floating-product-banner",
      bannerVariant: "floating-product",
      layout: "asymmetric",
      container: "wide",
      spacing: "xl",
      gap: "xl",
      align: "start",
      verticalAlign: "center",
      minHeight: 680,
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "premium-dark", backgroundColor: "#171a1f", textColor: "#ffffff", accentColor: "#d7ff4f", radius: 28, shadow: "strong" },
      decoration: { type: "frame", position: "bottom-right", color: "#ff8066", opacity: 0.22 },
      animation: { effect: "fade-up", durationMs: 800, delayMs: 0 }
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
        preset: "quiet",
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
        preset: "quiet",
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
        preset: "carded",
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
        preset: "quiet",
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
        preset: "carded",
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
        preset: "quiet",
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
    id: "story-timeline",
    label: "Story timeline",
    description: "Editorial introduction followed by chronological milestones.",
    category: "Content",
    elements: ["text-layout", "timeline"],
    settings: {
      patternId: "story-timeline",
      layout: "one-column",
      container: "default",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "quiet", backgroundColor: "#f8faf7", textColor: "#1e2329", accentColor: "#0d7c68", radius: 0, shadow: "none" },
      decoration: { type: "none", position: "bottom-right", color: "#0d7c68", opacity: 0.2 }
    }
  },
  {
    id: "benefit-checklist",
    label: "Benefits checklist",
    description: "Image-led introduction with a concise checklist of benefits or inclusions.",
    category: "Content",
    elements: ["image-text", "checklist"],
    settings: {
      patternId: "benefit-checklist",
      layout: "asymmetric",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "two-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "quiet", backgroundColor: "#f8faf7", textColor: "#1e2329", accentColor: "#0d7c68", radius: 0, shadow: "none" },
      decoration: { type: "none", position: "bottom-right", color: "#0d7c68", opacity: 0.2 }
    }
  },
  {
    id: "resource-center",
    label: "Resource center",
    description: "Supporting introduction with clear links to guides, policies, or downloads.",
    category: "Content",
    elements: ["text-layout", "resource-list"],
    settings: {
      patternId: "resource-center",
      layout: "two-column",
      container: "default",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "carded", backgroundColor: "#ffffff", textColor: "#1e2329", accentColor: "#0d7c68", radius: 18, shadow: "soft" },
      decoration: { type: "frame", position: "bottom-right", color: "#0d7c68", opacity: 0.22 }
    }
  },
  {
    id: "quote-story",
    label: "Quote + story",
    description: "Prominent attributable quote paired with supporting imagery and context.",
    category: "Trust",
    elements: ["quote-highlight", "image-text"],
    settings: {
      patternId: "quote-story",
      layout: "asymmetric",
      container: "wide",
      spacing: "xl",
      gap: "xl",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "premium-dark", backgroundColor: "#12172b", textColor: "#ffffff", accentColor: "#5b5cff", radius: 24, shadow: "glow" },
      decoration: { type: "spotlight", position: "center-right", color: "#5b5cff", opacity: 0.32 }
    }
  },
  {
    id: "locations-contact",
    label: "Locations + contact",
    description: "Location details beside the standard CMS inquiry form.",
    category: "Contact",
    elements: ["location-cards", "contact-form"],
    settings: {
      patternId: "locations-contact",
      layout: "two-column",
      container: "wide",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "two-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "quiet", backgroundColor: "#f8faf7", textColor: "#1e2329", accentColor: "#0d7c68", radius: 0, shadow: "none" },
      decoration: { type: "none", position: "bottom-right", color: "#0d7c68", opacity: 0.2 }
    }
  },
  {
    id: "comparison-pricing",
    label: "Comparison + pricing",
    description: "Accessible option comparison followed by editable pricing cards.",
    category: "Commerce",
    elements: ["comparison-table", "pricing-cards"],
    settings: {
      patternId: "comparison-pricing",
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "carded", backgroundColor: "#ffffff", textColor: "#1e2329", accentColor: "#0d7c68", radius: 18, shadow: "soft" },
      decoration: { type: "frame", position: "bottom-right", color: "#0d7c68", opacity: 0.22 }
    }
  },
  {
    id: "team-values",
    label: "Team + values",
    description: "People cards followed by the principles or capabilities behind the team.",
    category: "Trust",
    elements: ["team-section", "feature-cards"],
    settings: {
      patternId: "team-values",
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "quiet", backgroundColor: "#f8faf7", textColor: "#1e2329", accentColor: "#0d7c68", radius: 0, shadow: "none" },
      decoration: { type: "none", position: "bottom-right", color: "#0d7c68", opacity: 0.2 }
    }
  },
  {
    id: "shop-confidence",
    label: "Products + confidence",
    description: "Product selection with practical buying, delivery, or support questions.",
    category: "Commerce",
    elements: ["product-list", "faq-accordion"],
    settings: {
      patternId: "shop-confidence",
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "quiet", backgroundColor: "#f8faf7", textColor: "#1e2329", accentColor: "#0d7c68", radius: 0, shadow: "none" },
      decoration: { type: "none", position: "bottom-right", color: "#0d7c68", opacity: 0.2 }
    }
  },
  {
    id: "capability-bento",
    label: "Capability bento",
    description: "Editorial introduction with a premium, scannable capability grid.",
    category: "Content",
    elements: ["text-layout", "bento-grid"],
    settings: {
      patternId: "capability-bento",
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "quiet", backgroundColor: "#f8faf7", textColor: "#1e2329", accentColor: "#0d7c68", radius: 0, shadow: "none" },
      decoration: { type: "none", position: "bottom-right", color: "#0d7c68", opacity: 0.2 }
    }
  },
  {
    id: "guided-navigation",
    label: "Guided navigation",
    description: "A concise introduction followed by clear paths to the next useful pages.",
    category: "Content",
    elements: ["text-layout", "navigation-cards"],
    settings: {
      patternId: "guided-navigation",
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "quiet", backgroundColor: "#f8faf7", textColor: "#1e2329", accentColor: "#0d7c68", radius: 0, shadow: "none" },
      decoration: { type: "none", position: "bottom-right", color: "#0d7c68", opacity: 0.2 }
    }
  },
  {
    id: "transformation-story",
    label: "Transformation story",
    description: "A clear image comparison supported by an attributable result.",
    category: "Trust",
    elements: ["image-comparison", "quote-highlight"],
    settings: {
      patternId: "transformation-story",
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "quiet", backgroundColor: "#f8faf7", textColor: "#1e2329", accentColor: "#0d7c68", radius: 0, shadow: "none" },
      decoration: { type: "none", position: "bottom-right", color: "#0d7c68", opacity: 0.2 }
    }
  },
  {
    id: "product-spotlight",
    label: "Product spotlight",
    description: "A focused product feature paired with concise buying benefits.",
    category: "Commerce",
    elements: ["product-showcase", "checklist"],
    settings: {
      patternId: "product-spotlight",
      layout: "two-column",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      style: { preset: "carded", backgroundColor: "#ffffff", textColor: "#1e2329", accentColor: "#0d7c68", radius: 18, shadow: "soft" },
      decoration: { type: "frame", position: "bottom-right", color: "#0d7c68", opacity: 0.22 }
    }
  }
];

export const pageLayoutOptions = [
  { value: "full-width", label: "Full width" },
  { value: "grid", label: "Grid" }
];

export const defaultPage = {
  title: "CodeY CMS",
  slug: "home",
  status: "STATIC",
  excerpt: "A modular base project ready for CMS, shop, presentation, and custom client websites.",
  metaTitle: "CodeY CMS",
  metaDescription: "Modular project foundation.",
  content: {
    footerText: `© ${new Date().getFullYear()} CodeY CMS.`
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
  state.token = "";
  state.hasSession = storedValue("cms_session_hint") === "1";
  state.user = null;
  state.config = null;
  state.menu = null;
  state.page = null;
  state.builderPage = null;
  state.builderPageChangeToken = "";
  state.builderPageRevisions = [];
  state.builderRevisionComparison = null;
  state.builderRevisionSlug = "";
  state.builderPost = null;
  state.shopProduct = null;
  state.shopCategories = [];
  state.activeBuilderSectionId = null;
  state.builderRailCollapsed = false;
  state.builderRailView = "library";
  state.builderHistorySlug = "";
  state.builderUndoStack = [];
  state.builderRedoStack = [];
  state.builderCanvasView = "edit";
  state.builderPreviewDevice = "desktop";
  state.cmsTemplates = [];
  state.visualEditorActive = false;
  state.visualEditorSelection = null;
  state.visualEditorEditingBlockKey = "";
  state.visualEditorHistoryKey = "";
  state.visualEditorUndoStack = [];
  state.visualEditorRedoStack = [];
  state.visualEditorDevice = "desktop";
  state.visualEditorLibraryOpen = false;
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
  state.hasSession = false;
  state.user = null;
  state.cmsTemplates = [];
  state.visualEditorActive = false;
  state.visualEditorSelection = null;
  state.visualEditorEditingBlockKey = "";
  state.visualEditorHistoryKey = "";
  state.visualEditorUndoStack = [];
  state.visualEditorRedoStack = [];
  state.visualEditorDevice = "desktop";
  state.visualEditorLibraryOpen = false;
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("cms_session_hint");
    localStorage.removeItem("cms_access_token");
    localStorage.removeItem("cms_refresh_token");
  }
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
  if (!state.hasSession) return false;
  if (refreshSessionPromise) return refreshSessionPromise;

  const pendingRefresh = (async () => {
    const response = await fetch(`${state.apiUrl}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({})
    });
    const body = await readApiBody(response);

    if (!response.ok || !body?.success || !body.data?.tokens) {
      clearStoredSession();
      return false;
    }

    state.token = body.data.tokens.accessToken;
    state.hasSession = true;
    state.user = body.data.user || state.user;
    if (typeof localStorage !== "undefined") localStorage.setItem("cms_session_hint", "1");
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

export async function restoreSession() {
  if (state.token) return true;
  return refreshSession();
}

function canRefreshRequest(path) {
  return Boolean(
    state.hasSession &&
    !["/auth/login", "/auth/refresh", "/auth/logout"].includes(path.split("?")[0])
  );
}

async function apiRequest(path, options, allowRefresh, includeMeta = false) {
  const requestAccessToken = state.token;
  const response = await fetch(`${state.apiUrl}${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...headers(),
      ...options.headers
    }
  });
  const body = await readApiBody(response);

  if (response.status === 401 && allowRefresh && canRefreshRequest(path)) {
    if (requestAccessToken && requestAccessToken !== state.token) {
      return apiRequest(path, options, false, includeMeta);
    }
    if (await refreshSession()) return apiRequest(path, options, false, includeMeta);
  } else if (response.status === 401 && state.hasSession) {
    clearStoredSession();
  }

  if (!response.ok || !body?.success) {
    const error = new Error(body?.error?.message || `Request failed with status ${response.status}.`);
    error.status = response.status;
    error.code = body?.error?.code;
    error.details = body?.error?.details || null;
    throw error;
  }

  const method = String(options.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && body.data?.page) {
    recordPageChange(body.data.page);
  }

  return includeMeta ? { data: body.data, meta: body.meta || {} } : body.data;
}

export async function api(path, options = {}) {
  return apiRequest(path, options, true);
}

export async function apiWithMeta(path, options = {}) {
  return apiRequest(path, options, true, true);
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
      if (!registeredElement || registeredElement.editorAvailable === false) return false;
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
  const localeCode = String(locale || state.publicRenderLocale || pathLocale() || localization.defaultLocale || "en").toLowerCase();
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
