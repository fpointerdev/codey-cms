import type { ModuleId } from "../../core/types/module.js";
import { validateCustomCodeValue } from "../cms/custom-code.js";

export { validateCustomCodeValue };

export type BuilderBlockType =
  | "TEXT"
  | "RICH_TEXT"
  | "IMAGE"
  | "GALLERY"
  | "EMBED"
  | "BUTTON"
  | "CTA"
  | "CONTACT_FORM"
  | "PRODUCT_LIST"
  | "CUSTOM";

export type BuilderElementDefinition = {
  id: string;
  label: string;
  icon: string;
  description: string;
  category: "content" | "media" | "commerce" | "forms" | "advanced";
  modules: ModuleId[];
  blockTypes: BuilderBlockType[];
  generatorSafe: boolean;
  editorAvailable?: boolean;
  defaultValue: Record<string, unknown>;
  fieldSchema: Array<{
    name: string;
    label: string;
    type: "text" | "richText" | "image" | "gallery" | "select" | "number" | "boolean" | "productPicker" | "custom";
    required: boolean;
  }>;
};

export type SectionPresetDefinition = {
  id: string;
  label: string;
  description: string;
  allowedElements: string[];
  defaultSettings: Record<string, unknown>;
};

export type BuilderStylePresetDefinition = {
  id: string;
  label: string;
  description: string;
  settings: Record<string, unknown>;
};

export type BuilderSectionPatternDefinition = {
  id: string;
  label: string;
  description: string;
  category: "hero" | "content" | "commerce" | "trust" | "contact";
  elements: string[];
  defaultSettings: Record<string, unknown>;
};

export type BuilderBlockContract = {
  key?: string;
  type?: string;
  label?: string;
  value?: unknown;
  settings?: Record<string, unknown>;
};

export type BuilderSectionContract = {
  key?: string;
  settings?: Record<string, unknown>;
  blocks?: BuilderBlockContract[];
};

export type BuilderTemplateContract = {
  id?: string;
  label?: string;
  modules?: ModuleId[];
  blocks?: BuilderBlockContract[];
};

export type BuilderValidationIssue = {
  code: string;
  message: string;
};

export type BuilderValidationResult = {
  errors: BuilderValidationIssue[];
  warnings: BuilderValidationIssue[];
};

export const builderRegistryVersion = "2026-08-25.1";

function registryPlaceholderImage(width: number, height: number, label: string) {
  const safeLabel = label
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${safeLabel}">`,
    '<rect width="100%" height="100%" fill="#eef2f0"/>',
    `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="Arial, sans-serif" font-size="32">${safeLabel}</text>`,
    "</svg>"
  ].join("");

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export const builderElementRegistry = [
  {
    id: "heading",
    label: "Heading",
    icon: "heading",
    description: "A focused heading for introducing a section or separating content.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["TEXT"],
    generatorSafe: true,
    defaultValue: {
      text: "Section heading"
    },
    fieldSchema: [
      { name: "text", label: "Heading", type: "text", required: true }
    ]
  },
  {
    id: "rich-text",
    label: "Rich Text",
    icon: "text",
    description: "Formatted paragraphs, lists, links, and supporting page copy.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      body: "Write your content here."
    },
    fieldSchema: [
      { name: "body", label: "Content", type: "richText", required: true }
    ]
  },
  {
    id: "text-layout",
    label: "Text Layout",
    icon: "type",
    description: "Heading plus editable rich text for company, service, article, and landing sections.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["TEXT", "RICH_TEXT", "BUTTON", "CTA"],
    generatorSafe: true,
    defaultValue: {
      heading: "Section heading",
      body: "Write the content for this section."
    },
    fieldSchema: [
      { name: "heading", label: "Heading", type: "text", required: true },
      { name: "body", label: "Body", type: "richText", required: true }
    ]
  },
  {
    id: "image",
    label: "Image",
    icon: "image",
    description: "A single accessible image with preview, replacement, and alt text controls.",
    category: "media",
    modules: ["cms"],
    blockTypes: ["IMAGE"],
    generatorSafe: true,
    defaultValue: {
      image: { url: registryPlaceholderImage(1200, 800, "Content image"), alt: "Content image" }
    },
    fieldSchema: [
      { name: "image", label: "Image", type: "image", required: true }
    ]
  },
  {
    id: "image-text",
    label: "Image + Text",
    icon: "image",
    description: "Image with supporting copy for product, service, manufacturing, case study, or about sections.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["IMAGE", "TEXT", "RICH_TEXT", "BUTTON", "CTA"],
    generatorSafe: true,
    defaultValue: {
      image: { url: registryPlaceholderImage(900, 650, "Section image"), alt: "Section image" },
      body: "Explain this image or section."
    },
    fieldSchema: [
      { name: "image", label: "Image", type: "image", required: true },
      { name: "body", label: "Text", type: "richText", required: true }
    ]
  },
  {
    id: "slider",
    label: "Slider",
    icon: "gallery-horizontal",
    description: "Image slider or carousel for hero and project highlights.",
    category: "media",
    modules: ["cms"],
    blockTypes: ["TEXT", "RICH_TEXT", "GALLERY", "BUTTON", "CTA"],
    generatorSafe: true,
    defaultValue: {
      slides: [],
      settings: {
        displayMode: "slider",
        slidesPerView: 1,
        containerFade: "none",
        loop: true,
        showNavigation: true
      }
    },
    fieldSchema: [
      { name: "slides", label: "Slides", type: "gallery", required: true },
      { name: "settings", label: "Slider settings", type: "custom", required: true }
    ]
  },
  {
    id: "carousel",
    label: "Carousel",
    icon: "panel-right",
    description: "Multi-item carousel with focus and partial neighboring slides.",
    category: "media",
    modules: ["cms"],
    blockTypes: ["TEXT", "RICH_TEXT", "GALLERY", "BUTTON", "CTA"],
    generatorSafe: true,
    defaultValue: {
      slides: [],
      settings: {
        displayMode: "carousel",
        focusMode: "peek",
        slidesPerView: 1,
        containerFade: "horizontal",
        loop: true
      }
    },
    fieldSchema: [
      { name: "slides", label: "Carousel items", type: "gallery", required: true },
      { name: "settings", label: "Carousel settings", type: "custom", required: true }
    ]
  },
  {
    id: "gallery",
    label: "Gallery",
    icon: "images",
    description: "Static image grid, masonry, or justified gallery for portfolio and project pages.",
    category: "media",
    modules: ["cms"],
    blockTypes: ["TEXT", "RICH_TEXT", "GALLERY", "BUTTON", "CTA"],
    generatorSafe: true,
    defaultValue: {
      items: [],
      settings: {
        displayMode: "gallery",
        layoutMode: "grid",
        columnsDesktop: 3,
        columnsTablet: 2,
        columnsMobile: 1
      }
    },
    fieldSchema: [
      { name: "items", label: "Images", type: "gallery", required: true },
      { name: "settings", label: "Gallery settings", type: "custom", required: true }
    ]
  },
  {
    id: "button",
    label: "Button",
    icon: "mouse-pointer-click",
    description: "A clear link or action button with editable label and destination.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["BUTTON"],
    generatorSafe: true,
    defaultValue: {
      label: "Learn more",
      url: "#"
    },
    fieldSchema: [
      { name: "label", label: "Label", type: "text", required: true },
      { name: "url", label: "Destination", type: "text", required: true }
    ]
  },
  {
    id: "cta",
    label: "CTA",
    icon: "mouse-pointer-click",
    description: "Call-to-action content for inquiries, booking, checkout, or contact prompts.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["TEXT", "RICH_TEXT", "CTA", "BUTTON"],
    generatorSafe: true,
    defaultValue: {
      body: "Ready to start? Send us a request.",
      cta: { label: "Contact us", url: "#contact" }
    },
    fieldSchema: [
      { name: "body", label: "Copy", type: "richText", required: true },
      { name: "cta", label: "Button", type: "custom", required: true }
    ]
  },
  {
    id: "hero-creative",
    label: "Creative Hero",
    icon: "sparkles",
    description: "High-impact hero section with headline, supporting copy, CTA, stats, and visual media.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["TEXT", "RICH_TEXT", "IMAGE", "GALLERY", "BUTTON", "CTA", "CUSTOM"],
    generatorSafe: true,
    defaultValue: {
      title: "Bold website headline",
      body: "Explain the offer with a clear, concise message.",
      stats: []
    },
    fieldSchema: [
      { name: "title", label: "Headline", type: "text", required: true },
      { name: "body", label: "Copy", type: "richText", required: false },
      { name: "stats", label: "Stats", type: "custom", required: false }
    ]
  },
  {
    id: "stats-grid",
    label: "Stats Grid",
    icon: "badge-percent",
    description: "Metric cards for performance, company scale, project numbers, and proof points.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "TEXT", "RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      title: "Key results",
      stats: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "stats", label: "Metrics", type: "custom", required: true }
    ]
  },
  {
    id: "feature-cards",
    label: "Feature Cards",
    icon: "layout-grid",
    description: "Reusable card grid for services, features, process steps, and industry capabilities.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "TEXT", "RICH_TEXT", "BUTTON"],
    generatorSafe: true,
    defaultValue: {
      title: "What we do",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "items", label: "Cards", type: "custom", required: true }
    ]
  },
  {
    id: "team-section",
    label: "Team Section",
    icon: "users",
    description: "Team, leadership, or staff cards with names, roles, images, and bios.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "GALLERY"],
    generatorSafe: true,
    defaultValue: {
      title: "Meet the team",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "items", label: "People", type: "custom", required: true }
    ]
  },
  {
    id: "logo-grid",
    label: "Logo Grid",
    icon: "building-2",
    description: "Client, partner, certification, supplier, or technology logo grid.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "GALLERY"],
    generatorSafe: true,
    defaultValue: {
      title: "Trusted by",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "items", label: "Logos", type: "custom", required: true }
    ]
  },
  {
    id: "testimonials",
    label: "Testimonials",
    icon: "quote",
    description: "Customer quotes, reviews, and trust-building proof cards.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "TEXT", "RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      title: "What customers say",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "items", label: "Quotes", type: "custom", required: true }
    ]
  },
  {
    id: "pricing-cards",
    label: "Pricing Cards",
    icon: "credit-card",
    description: "Plan, package, subscription, or quote-range card layout.",
    category: "commerce",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "CTA", "BUTTON"],
    generatorSafe: true,
    defaultValue: {
      title: "Plans",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "items", label: "Plans", type: "custom", required: true }
    ]
  },
  {
    id: "faq-accordion",
    label: "FAQ Accordion",
    icon: "circle-help",
    description: "Question and answer content for service, shop, support, and landing pages.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      title: "Questions",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "items", label: "Questions", type: "custom", required: true }
    ]
  },
  {
    id: "tabs",
    label: "Tabs",
    icon: "panel-top",
    description: "Tabbed content for grouped services, specifications, processes, and comparison details.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      title: "Tabbed content",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "items", label: "Tabs", type: "custom", required: true }
    ]
  },
  {
    id: "accordion",
    label: "Accordion",
    icon: "list-collapse",
    description: "Expandable panels for dense information, service details, policies, and technical content.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      title: "Accordion",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "items", label: "Panels", type: "custom", required: true }
    ]
  },
  {
    id: "process-steps",
    label: "Process Steps",
    icon: "list-ordered",
    description: "Ordered steps for services, onboarding, delivery, and customer journeys.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      title: "How it works",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "items", label: "Steps", type: "custom", required: true }
    ]
  },
  {
    id: "comparison-table",
    label: "Comparison Table",
    icon: "columns-3",
    description: "Accessible side-by-side comparison for plans, services, products, and capabilities.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      title: "Compare options",
      firstColumnTitle: "Option A",
      secondColumnTitle: "Option B",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "items", label: "Comparison rows", type: "custom", required: true }
    ]
  },
  {
    id: "video",
    label: "Video",
    icon: "video",
    description: "Self-hosted MP4 or WebM video with accessible title and supporting copy.",
    category: "media",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      title: "Video title",
      body: "Add context so visitors and search engines understand the video.",
      url: "",
      display: { presentation: "inline", playback: "controls", ratio: "16 / 9", preload: "metadata", loop: false }
    },
    fieldSchema: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "body", label: "Description", type: "richText", required: false },
      { name: "url", label: "Video file", type: "custom", required: false }
    ]
  },
  {
    id: "image-hotspots",
    label: "Interactive Image",
    icon: "map-pin",
    description: "Image scene with positioned, accessible links for products, objects, locations, or details.",
    category: "media",
    modules: ["cms"],
    blockTypes: ["CUSTOM"],
    generatorSafe: true,
    defaultValue: {
      title: "Explore the scene",
      body: "Select a marker to view more information.",
      image: { url: registryPlaceholderImage(1600, 1000, "Interactive scene"), alt: "Interactive scene" },
      hotspots: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "body", label: "Description", type: "richText", required: false },
      { name: "image", label: "Scene image", type: "image", required: true },
      { name: "hotspots", label: "Placements", type: "custom", required: true }
    ]
  },
  {
    id: "image-comparison",
    label: "Image Comparison",
    icon: "columns-2",
    description: "Accessible before-and-after or option comparison with two clearly labelled images.",
    category: "media",
    modules: ["cms"],
    blockTypes: ["CUSTOM"],
    generatorSafe: true,
    defaultValue: {
      title: "See the difference",
      body: "Compare the two views side by side.",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "body", label: "Introduction", type: "richText", required: false },
      { name: "items", label: "Comparison images", type: "custom", required: true }
    ]
  },
  {
    id: "timeline",
    label: "Timeline",
    icon: "history",
    description: "Chronological milestones for company history, projects, roadmaps, and launch plans.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      title: "Our journey",
      body: "Show the milestones that explain how the work developed.",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "body", label: "Introduction", type: "richText", required: false },
      { name: "items", label: "Milestones", type: "custom", required: true }
    ]
  },
  {
    id: "checklist",
    label: "Checklist",
    icon: "list-checks",
    description: "Scannable benefits, requirements, inclusions, or readiness points.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      title: "What is included",
      body: "Keep the most important points easy to scan.",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "body", label: "Introduction", type: "richText", required: false },
      { name: "items", label: "Checklist items", type: "custom", required: true }
    ]
  },
  {
    id: "resource-list",
    label: "Resource List",
    icon: "file-text",
    description: "Accessible links to guides, documents, downloads, policies, and related pages.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      title: "Resources",
      body: "Give visitors a clear path to useful supporting material.",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "body", label: "Introduction", type: "richText", required: false },
      { name: "items", label: "Resources", type: "custom", required: true }
    ]
  },
  {
    id: "location-cards",
    label: "Location Cards",
    icon: "map-pin",
    description: "Addresses, service areas, opening hours, and contact links for one or more locations.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      title: "Visit us",
      body: "Help visitors find the right location and contact details.",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "body", label: "Introduction", type: "richText", required: false },
      { name: "items", label: "Locations", type: "custom", required: true }
    ]
  },
  {
    id: "quote-highlight",
    label: "Quote Highlight",
    icon: "quote",
    description: "Focused testimonial, founder statement, editorial pull quote, or customer insight.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "RICH_TEXT"],
    generatorSafe: true,
    defaultValue: {
      title: "Customer perspective",
      body: "Add a concise, attributable statement that supports the page story.",
      attribution: "Name, role or source"
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "body", label: "Quote", type: "richText", required: true },
      { name: "attribution", label: "Attribution", type: "text", required: false }
    ]
  },
  {
    id: "bento-grid",
    label: "Bento Grid",
    icon: "layout-grid",
    description: "A premium capability grid with one optional featured item and compact supporting cards.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "RICH_TEXT", "BUTTON"],
    generatorSafe: true,
    defaultValue: {
      title: "Designed around what matters",
      body: "Lead with the strongest benefit, then make the supporting details easy to scan.",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "body", label: "Introduction", type: "richText", required: false },
      { name: "items", label: "Highlights", type: "custom", required: true }
    ]
  },
  {
    id: "navigation-cards",
    label: "Navigation Cards",
    icon: "signpost",
    description: "Clear, linked cards that guide visitors to services, categories, resources, or next steps.",
    category: "content",
    modules: ["cms"],
    blockTypes: ["CUSTOM", "RICH_TEXT", "BUTTON"],
    generatorSafe: true,
    defaultValue: {
      title: "Where would you like to go?",
      body: "Give visitors a small set of clear paths instead of making them search through menus.",
      items: []
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "body", label: "Introduction", type: "richText", required: false },
      { name: "items", label: "Destinations", type: "custom", required: true }
    ]
  },
  {
    id: "contact-form",
    label: "Contact Form",
    icon: "mail",
    description: "Public inquiry form backed by CMS contact submissions.",
    category: "forms",
    modules: ["cms"],
    blockTypes: ["TEXT", "RICH_TEXT", "CONTACT_FORM"],
    generatorSafe: true,
    defaultValue: {
      formKey: "contact",
      subject: "Website inquiry",
      buttonLabel: "Send inquiry"
    },
    fieldSchema: [
      { name: "formKey", label: "Form key", type: "text", required: true },
      { name: "subject", label: "Subject", type: "text", required: false }
    ]
  },
  {
    id: "product-list",
    label: "Product List",
    icon: "shopping-bag",
    description: "Product slot controlled by the shop module.",
    category: "commerce",
    modules: ["products"],
    blockTypes: ["TEXT", "RICH_TEXT", "PRODUCT_LIST", "BUTTON", "CTA"],
    generatorSafe: true,
    defaultValue: {
      productSlugs: []
    },
    fieldSchema: [
      { name: "productSlugs", label: "Products", type: "productPicker", required: true }
    ]
  },
  {
    id: "product-showcase",
    label: "Product Showcase",
    icon: "badge-dollar-sign",
    description: "Focused product feature with live image, price, availability, and purchase action.",
    category: "commerce",
    modules: ["products"],
    blockTypes: ["PRODUCT_LIST"],
    generatorSafe: true,
    defaultValue: {
      title: "Featured product",
      body: "Give one important product more room to stand out.",
      productSlugs: [],
      layout: "spotlight",
      columns: 2,
      showDescription: true
    },
    fieldSchema: [
      { name: "title", label: "Heading", type: "text", required: false },
      { name: "body", label: "Introduction", type: "richText", required: false },
      { name: "productSlugs", label: "Product", type: "productPicker", required: true }
    ]
  },
  {
    id: "custom-code",
    label: "Custom Code",
    icon: "code-2",
    description: "Sandboxed HTML, CSS, JavaScript, and external libraries for trusted editor-authored widgets.",
    category: "advanced",
    modules: ["cms"],
    blockTypes: ["EMBED"],
    generatorSafe: false,
    editorAvailable: true,
    defaultValue: {
      html: "<div class=\"codey-widget\">Custom widget</div>",
      css: ".codey-widget { padding: 24px; font: 600 16px/1.5 system-ui, sans-serif; }",
      javascript: "",
      libraries: [],
      height: 320
    },
    fieldSchema: [
      { name: "html", label: "HTML", type: "custom", required: true },
      { name: "javascript", label: "JavaScript", type: "custom", required: false },
      { name: "libraries", label: "External libraries", type: "custom", required: false },
      { name: "css", label: "CSS", type: "custom", required: false },
      { name: "height", label: "Frame height", type: "number", required: true }
    ]
  },
  {
    id: "structured-content",
    label: "Structured Content",
    icon: "braces",
    description: "Fallback for structured generated content until a richer visual element exists.",
    category: "advanced",
    modules: ["cms"],
    blockTypes: ["TEXT", "RICH_TEXT", "CUSTOM", "BUTTON", "CTA"],
    generatorSafe: false,
    editorAvailable: false,
    defaultValue: {
      type: "custom",
      items: []
    },
    fieldSchema: [
      { name: "content", label: "Structured content", type: "custom", required: true }
    ]
  }
] satisfies BuilderElementDefinition[];

const generatorSafeElementIds = builderElementRegistry
  .filter((element) => element.generatorSafe)
  .map((element) => element.id);

export const sectionPresetRegistry = [
  {
    id: "one-column",
    label: "One column",
    description: "Standard full-width content stack.",
    allowedElements: generatorSafeElementIds,
    defaultSettings: {
      layout: "one-column",
      container: "default",
      spacing: "md",
      gap: "md",
      responsive: { tablet: { layout: "inherit", spacing: "inherit" }, mobile: { layout: "one-column", spacing: "sm" } }
    }
  },
  {
    id: "two-column",
    label: "Two columns",
    description: "Side-by-side content for image/text and comparison sections.",
    allowedElements: ["image-text", "image-hotspots", "image-comparison", "text-layout", "cta", "process-steps", "comparison-table", "video", "timeline", "checklist", "resource-list", "location-cards", "quote-highlight", "bento-grid", "navigation-cards", "product-list", "product-showcase"],
    defaultSettings: {
      layout: "two-column",
      container: "default",
      spacing: "md",
      gap: "md",
      responsive: { tablet: { layout: "two-column", spacing: "inherit" }, mobile: { layout: "one-column", spacing: "sm" } }
    }
  },
  {
    id: "three-column",
    label: "Three columns",
    description: "Feature, service, or product summary grid.",
    allowedElements: ["text-layout", "image-text", "stats-grid", "feature-cards", "team-section", "logo-grid", "testimonials", "pricing-cards", "faq-accordion", "tabs", "accordion", "process-steps", "comparison-table", "checklist", "resource-list", "location-cards", "bento-grid", "navigation-cards", "product-list", "product-showcase"],
    defaultSettings: {
      layout: "three-column",
      container: "default",
      spacing: "md",
      gap: "md",
      responsive: { tablet: { layout: "two-column", spacing: "inherit" }, mobile: { layout: "one-column", spacing: "sm" } }
    }
  },
  {
    id: "four-column",
    label: "Four columns",
    description: "Dense card grid for stats, features, logos, and team members.",
    allowedElements: ["stats-grid", "feature-cards", "team-section", "logo-grid", "testimonials", "pricing-cards", "process-steps", "checklist", "resource-list", "location-cards", "bento-grid", "navigation-cards"],
    defaultSettings: {
      layout: "four-column",
      container: "wide",
      spacing: "md",
      gap: "md",
      responsive: { tablet: { layout: "two-column", spacing: "inherit" }, mobile: { layout: "one-column", spacing: "sm" } }
    }
  },
  {
    id: "full-bleed",
    label: "Full width",
    description: "Wide visual section for hero, gallery, and media bands.",
    allowedElements: ["hero-creative", "slider", "carousel", "gallery", "image-text", "image-hotspots", "image-comparison", "video", "quote-highlight", "cta", "product-showcase"],
    defaultSettings: {
      layout: "full-bleed",
      container: "wide",
      spacing: "xl",
      gap: "lg",
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } }
    }
  },
  {
    id: "asymmetric",
    label: "Asymmetric",
    description: "Editorial section with stronger visual weight on one side.",
    allowedElements: ["hero-creative", "image-text", "image-hotspots", "feature-cards", "process-steps", "comparison-table", "timeline", "checklist", "resource-list", "location-cards", "quote-highlight", "bento-grid", "navigation-cards"],
    defaultSettings: {
      layout: "asymmetric",
      container: "wide",
      spacing: "lg",
      gap: "lg",
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } }
    }
  },
  {
    id: "split-hero",
    label: "Split hero",
    description: "Hero section with copy on one side and media or proof on the other.",
    allowedElements: ["hero-creative", "slider", "carousel", "image-text", "stats-grid", "cta"],
    defaultSettings: {
      layout: "asymmetric",
      container: "wide",
      spacing: "xl",
      gap: "xl",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } }
    }
  },
  {
    id: "media-band",
    label: "Media band",
    description: "Wide visual strip for galleries, carousels, project highlights, and image-led storytelling.",
    allowedElements: ["slider", "carousel", "gallery", "image-text", "image-hotspots", "image-comparison", "video", "text-layout"],
    defaultSettings: {
      layout: "full-bleed",
      container: "wide",
      spacing: "xl",
      gap: "lg",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } }
    }
  },
  {
    id: "product-grid",
    label: "Product grid",
    description: "Shop listing section with product cards and filters.",
    allowedElements: ["product-list", "product-showcase"],
    defaultSettings: {
      layout: "three-column",
      container: "default",
      spacing: "md",
      gap: "md",
      responsive: { tablet: { layout: "two-column", spacing: "inherit" }, mobile: { layout: "one-column", spacing: "sm" } }
    }
  }
] satisfies SectionPresetDefinition[];

export const builderStylePresetRegistry = [
  {
    id: "editorial-light",
    label: "Editorial light",
    description: "Clean white content band with restrained spacing and soft section contrast.",
    settings: {
      style: { preset: "quiet", backgroundColor: "#f8faf7", textColor: "#1e2329", accentColor: "#0d7c68", radius: 0, shadow: "none" },
      decoration: { type: "none", position: "bottom-right", color: "#0d7c68", opacity: 0.2 }
    }
  },
  {
    id: "premium-dark",
    label: "Premium dark",
    description: "High-impact dark presentation section with strong contrast and controlled lighting.",
    settings: {
      style: { preset: "premium-dark", backgroundColor: "#12172b", textColor: "#ffffff", accentColor: "#5b5cff", radius: 24, shadow: "glow" },
      decoration: { type: "spotlight", position: "center-right", color: "#5b5cff", opacity: 0.32 }
    }
  },
  {
    id: "industrial-grid",
    label: "Industrial grid",
    description: "Technical B2B style with grid layer, sharp spacing, and practical contrast.",
    settings: {
      style: { preset: "contrast", backgroundColor: "#18211b", textColor: "#ffffff", accentColor: "#f2c94c", radius: 0, shadow: "soft" },
      decoration: { type: "grid", position: "bottom-right", color: "#f2c94c", opacity: 0.18 }
    }
  },
  {
    id: "framed-card",
    label: "Framed card",
    description: "Contained card section for pricing, testimonials, FAQs, and focused CTAs.",
    settings: {
      style: { preset: "carded", backgroundColor: "#ffffff", textColor: "#1e2329", accentColor: "#0d7c68", radius: 18, shadow: "soft" },
      decoration: { type: "frame", position: "bottom-right", color: "#0d7c68", opacity: 0.22 }
    }
  },
  {
    id: "liquid",
    label: "Liquid glass",
    description: "Translucent surface with restrained blur, a light border, and readable contrast.",
    settings: {
      style: { preset: "liquid", backgroundColor: "#edf4f3", textColor: "#172426", accentColor: "#087f76", radius: 20, shadow: "soft" },
      decoration: { type: "none", position: "bottom-right", color: "#087f76", opacity: 0.16 }
    }
  }
] satisfies BuilderStylePresetDefinition[];

export const builderSectionPatternRegistry = [
  {
    id: "hero-proof",
    label: "Hero + proof",
    description: "Hero message with CTA, stats, and supporting proof cards.",
    category: "hero",
    elements: ["hero-creative", "stats-grid"],
    defaultSettings: {
      layout: "asymmetric",
      container: "wide",
      spacing: "xl",
      gap: "xl",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "premium-dark")?.settings
    }
  },
  {
    id: "glass-interface-banner",
    label: "Glass interface banner",
    description: "Dark interactive banner with focused copy and a translucent media surface.",
    category: "hero",
    elements: ["hero-creative", "image"],
    defaultSettings: {
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
    category: "hero",
    elements: ["hero-creative", "image"],
    defaultSettings: {
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
    category: "hero",
    elements: ["hero-creative", "image"],
    defaultSettings: {
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
    description: "Image-led service section with feature cards for capabilities or industries.",
    category: "content",
    elements: ["image-text", "feature-cards"],
    defaultSettings: {
      layout: "two-column",
      container: "wide",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "two-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "editorial-light")?.settings
    }
  },
  {
    id: "split-hero",
    label: "Split hero",
    description: "Hero copy paired with media or proof for B2B landing pages.",
    category: "hero",
    elements: ["hero-creative", "slider"],
    defaultSettings: {
      layout: "asymmetric",
      container: "wide",
      spacing: "xl",
      gap: "xl",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "premium-dark")?.settings
    }
  },
  {
    id: "media-band",
    label: "Media band",
    description: "Wide gallery or carousel band with concise context above the media.",
    category: "trust",
    elements: ["text-layout", "carousel"],
    defaultSettings: {
      layout: "full-bleed",
      container: "wide",
      spacing: "xl",
      gap: "lg",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "editorial-light")?.settings
    }
  },
  {
    id: "process-tabs",
    label: "Process tabs",
    description: "Tabbed process or specification section with a short text introduction.",
    category: "content",
    elements: ["text-layout", "tabs"],
    defaultSettings: {
      layout: "two-column",
      container: "default",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "framed-card")?.settings
    }
  },
  {
    id: "portfolio-gallery",
    label: "Portfolio gallery",
    description: "Gallery or project section with captions and visual breathing room.",
    category: "trust",
    elements: ["text-layout", "gallery"],
    defaultSettings: {
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "inherit", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "editorial-light")?.settings
    }
  },
  {
    id: "pricing-trust",
    label: "Pricing + trust",
    description: "Pricing cards paired with testimonials for conversion-focused pages.",
    category: "commerce",
    elements: ["pricing-cards", "testimonials"],
    defaultSettings: {
      layout: "two-column",
      container: "wide",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "two-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "framed-card")?.settings
    }
  },
  {
    id: "faq-contact",
    label: "FAQ + contact",
    description: "FAQ accordion with an inquiry form for landing and support pages.",
    category: "contact",
    elements: ["faq-accordion", "contact-form"],
    defaultSettings: {
      layout: "two-column",
      container: "default",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "two-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "editorial-light")?.settings
    }
  },
  {
    id: "story-timeline",
    label: "Story timeline",
    description: "Editorial introduction followed by chronological milestones.",
    category: "content",
    elements: ["text-layout", "timeline"],
    defaultSettings: {
      layout: "one-column",
      container: "default",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "editorial-light")?.settings
    }
  },
  {
    id: "benefit-checklist",
    label: "Benefits checklist",
    description: "Image-led introduction with a concise checklist of benefits or inclusions.",
    category: "content",
    elements: ["image-text", "checklist"],
    defaultSettings: {
      layout: "asymmetric",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "two-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "editorial-light")?.settings
    }
  },
  {
    id: "resource-center",
    label: "Resource center",
    description: "Supporting introduction with clear links to guides, policies, or downloads.",
    category: "content",
    elements: ["text-layout", "resource-list"],
    defaultSettings: {
      layout: "two-column",
      container: "default",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "framed-card")?.settings
    }
  },
  {
    id: "quote-story",
    label: "Quote + story",
    description: "Prominent attributable quote paired with supporting imagery and context.",
    category: "trust",
    elements: ["quote-highlight", "image-text"],
    defaultSettings: {
      layout: "asymmetric",
      container: "wide",
      spacing: "xl",
      gap: "xl",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "one-column", spacing: "lg" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "premium-dark")?.settings
    }
  },
  {
    id: "locations-contact",
    label: "Locations + contact",
    description: "Location details beside the standard CMS inquiry form.",
    category: "contact",
    elements: ["location-cards", "contact-form"],
    defaultSettings: {
      layout: "two-column",
      container: "wide",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "two-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "editorial-light")?.settings
    }
  },
  {
    id: "comparison-pricing",
    label: "Comparison + pricing",
    description: "Accessible option comparison followed by editable pricing cards.",
    category: "commerce",
    elements: ["comparison-table", "pricing-cards"],
    defaultSettings: {
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "framed-card")?.settings
    }
  },
  {
    id: "team-values",
    label: "Team + values",
    description: "People cards followed by the principles or capabilities behind the team.",
    category: "trust",
    elements: ["team-section", "feature-cards"],
    defaultSettings: {
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "editorial-light")?.settings
    }
  },
  {
    id: "shop-confidence",
    label: "Products + confidence",
    description: "Product selection with practical buying, delivery, or support questions.",
    category: "commerce",
    elements: ["product-list", "faq-accordion"],
    defaultSettings: {
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "editorial-light")?.settings
    }
  },
  {
    id: "capability-bento",
    label: "Capability bento",
    description: "Editorial introduction with a premium, scannable capability grid.",
    category: "content",
    elements: ["text-layout", "bento-grid"],
    defaultSettings: {
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "editorial-light")?.settings
    }
  },
  {
    id: "guided-navigation",
    label: "Guided navigation",
    description: "A concise introduction followed by clear paths to the next useful pages.",
    category: "content",
    elements: ["text-layout", "navigation-cards"],
    defaultSettings: {
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "lg",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "editorial-light")?.settings
    }
  },
  {
    id: "transformation-story",
    label: "Transformation story",
    description: "A clear image comparison supported by an attributable customer or project result.",
    category: "trust",
    elements: ["image-comparison", "quote-highlight"],
    defaultSettings: {
      layout: "one-column",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "start",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "editorial-light")?.settings
    }
  },
  {
    id: "product-spotlight",
    label: "Product spotlight",
    description: "A focused product feature paired with concise buying benefits.",
    category: "commerce",
    elements: ["product-showcase", "checklist"],
    defaultSettings: {
      layout: "two-column",
      container: "wide",
      spacing: "lg",
      gap: "xl",
      align: "start",
      verticalAlign: "center",
      responsive: { tablet: { layout: "one-column", spacing: "md" }, mobile: { layout: "one-column", spacing: "sm" } },
      ...builderStylePresetRegistry.find((preset) => preset.id === "framed-card")?.settings
    }
  }
] satisfies BuilderSectionPatternDefinition[];

export function builderElementById(id: string | undefined) {
  return builderElementRegistry.find((element) => element.id === id);
}

export function builderElementForSectionType(sectionType: string) {
  const mapping: Record<string, string> = {
    hero: "hero-creative",
    text: "text-layout",
    richText: "text-layout",
    image: "image-text",
    gallery: "gallery",
    cta: "cta",
    contactForm: "contact-form",
    productList: "product-list",
    featureGrid: "feature-cards",
    pricing: "pricing-cards",
    faq: "faq-accordion",
    tabs: "tabs",
    accordion: "accordion",
    custom: "structured-content"
  };

  return builderElementById(mapping[sectionType] ?? "structured-content");
}

export function contentBlockTypes(): BuilderBlockType[] {
  return [...new Set(builderElementRegistry.flatMap((element) => element.blockTypes))];
}

const structuredCustomKeys = [
  "title",
  "heading",
  "headline",
  "name",
  "body",
  "text",
  "copy",
  "description",
  "content",
  "note",
  "kicker",
  "eyebrow",
  "summary",
  "attribution",
  "image",
  "media",
  "stats",
  "metrics",
  "items",
  "hotspots"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function issue(code: string, message: string): BuilderValidationIssue {
  return { code, message };
}

function validationResult(): BuilderValidationResult {
  return { errors: [], warnings: [] };
}

function blockLabel(pageSlug: string, sectionKey: string, blockKey?: string) {
  return `${pageSlug}/${sectionKey}/${blockKey || "(missing block key)"}`;
}

function itemUrl(value: unknown) {
  return isRecord(value) && hasText(value.url);
}

function itemAlt(value: unknown) {
  return isRecord(value) && (hasText(value.alt) || hasText(value.altText));
}

function firstRecordArray(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const items = value[key];
    if (Array.isArray(items)) return items;
  }

  return [];
}

function hasAnyText(value: unknown, keys: string[]) {
  return isRecord(value) && keys.some((key) => hasText(value[key]));
}

function validateItemCollection(
  result: BuilderValidationResult,
  label: string,
  value: unknown,
  keys: string[],
  options: {
    collectionLabel: string;
    requireTitle?: boolean;
    requireBody?: boolean;
    requireValue?: boolean;
    requireUrl?: boolean;
    allowImageOnly?: boolean;
  }
) {
  if (!isRecord(value)) {
    result.errors.push(issue("invalid_custom_value", `${label} ${options.collectionLabel} block needs structured content.`));
    return;
  }

  const items = firstRecordArray(value, keys);
  if (!items.length) {
    result.errors.push(issue("empty_custom_items", `${label} ${options.collectionLabel} block needs at least one item.`));
    return;
  }

  for (const [index, item] of items.entries()) {
    const itemLabel = `${label} ${options.collectionLabel} item ${index + 1}`;
    if (!isRecord(item)) {
      result.errors.push(issue("invalid_custom_item", `${itemLabel} must be an object.`));
      continue;
    }

    const hasTitle = hasAnyText(item, ["title", "name", "label"]);
    const hasBody = hasAnyText(item, ["body", "text", "copy", "description", "content"]);
    const hasValueText = hasAnyText(item, ["value", "price", "metric"]);
    const hasImage = isRecord(item.image) || isRecord(item.media) || hasText(item.image) || hasText(item.media);

    if (options.requireTitle && !hasTitle && !(options.allowImageOnly && hasImage)) {
      result.errors.push(issue("missing_custom_item_title", `${itemLabel} needs a title, name, or label.`));
    }

    if (options.requireBody && !hasBody) {
      result.errors.push(issue("missing_custom_item_body", `${itemLabel} needs body text.`));
    }

    if (options.requireValue && !hasValueText) {
      result.errors.push(issue("missing_custom_item_value", `${itemLabel} needs a value or metric.`));
    }

    if (options.requireUrl && !hasText(item.url)) {
      result.errors.push(issue("missing_custom_item_url", `${itemLabel} needs a link URL.`));
    }
  }
}

function validateCustomElementValue(
  result: BuilderValidationResult,
  label: string,
  elementId: string | undefined,
  value: unknown,
  productSlugs: Iterable<string> = []
) {
  if (!isRecord(value) || !elementId) return;

  if (elementId === "hero-creative" && !hasAnyText(value, ["title", "heading", "headline", "name"])) {
    result.errors.push(issue("missing_hero_title", `${label} hero needs a title or headline.`));
  }

  if (elementId === "stats-grid") {
    validateItemCollection(result, label, value, ["stats", "metrics", "items"], {
      collectionLabel: "stats",
      requireTitle: true,
      requireValue: true
    });
  }

  if (elementId === "feature-cards") {
    validateItemCollection(result, label, value, ["items", "cards"], {
      collectionLabel: "feature cards",
      requireTitle: true,
      requireBody: true
    });
  }

  if (elementId === "team-section") {
    validateItemCollection(result, label, value, ["items", "people"], {
      collectionLabel: "team",
      requireTitle: true
    });
  }

  if (elementId === "logo-grid") {
    validateItemCollection(result, label, value, ["items", "logos"], {
      collectionLabel: "logo grid",
      requireTitle: true,
      allowImageOnly: true
    });
  }

  if (elementId === "testimonials") {
    validateItemCollection(result, label, value, ["items", "quotes"], {
      collectionLabel: "testimonials",
      requireTitle: true,
      requireBody: true
    });
  }

  if (elementId === "pricing-cards") {
    validateItemCollection(result, label, value, ["items", "plans"], {
      collectionLabel: "pricing",
      requireTitle: true,
      requireValue: true
    });
  }

  if (elementId === "faq-accordion") {
    validateItemCollection(result, label, value, ["items", "questions"], {
      collectionLabel: "FAQ",
      requireTitle: true,
      requireBody: true
    });
  }

  if (elementId === "tabs") {
    validateItemCollection(result, label, value, ["items", "tabs"], {
      collectionLabel: "tabs",
      requireTitle: true,
      requireBody: true
    });
  }

  if (elementId === "accordion") {
    validateItemCollection(result, label, value, ["items", "panels"], {
      collectionLabel: "accordion",
      requireTitle: true,
      requireBody: true
    });
  }

  if (elementId === "process-steps") {
    validateItemCollection(result, label, value, ["items", "steps"], {
      collectionLabel: "process",
      requireTitle: true,
      requireBody: true
    });
  }

  if (elementId === "comparison-table") {
    validateItemCollection(result, label, value, ["items", "rows"], {
      collectionLabel: "comparison",
      requireTitle: true
    });

    const items = firstRecordArray(value, ["items", "rows"]);
    for (const [index, item] of items.entries()) {
      if (!isRecord(item) || !hasText(item.firstValue) || !hasText(item.secondValue)) {
        result.errors.push(issue(
          "missing_comparison_values",
          `${label} comparison row ${index + 1} needs values for both options.`
        ));
      }
    }
  }

  if (elementId === "timeline") {
    validateItemCollection(result, label, value, ["items", "milestones"], {
      collectionLabel: "timeline",
      requireTitle: true,
      requireBody: true
    });
  }

  if (elementId === "checklist") {
    validateItemCollection(result, label, value, ["items", "points"], {
      collectionLabel: "checklist",
      requireTitle: true
    });
  }

  if (elementId === "resource-list") {
    validateItemCollection(result, label, value, ["items", "resources"], {
      collectionLabel: "resource list",
      requireTitle: true,
      requireUrl: true
    });
  }

  if (elementId === "location-cards") {
    validateItemCollection(result, label, value, ["items", "locations"], {
      collectionLabel: "locations",
      requireTitle: true,
      requireBody: true
    });
  }

  if (elementId === "bento-grid") {
    validateItemCollection(result, label, value, ["items", "cards"], {
      collectionLabel: "bento grid",
      requireTitle: true,
      requireBody: true
    });
  }

  if (elementId === "navigation-cards") {
    validateItemCollection(result, label, value, ["items", "cards"], {
      collectionLabel: "navigation cards",
      requireTitle: true,
      requireUrl: true
    });
  }

  if (elementId === "quote-highlight" && !hasAnyText(value, ["body", "text", "copy", "content"])) {
    result.errors.push(issue("missing_quote_body", `${label} quote highlight needs quote text.`));
  }

  if (elementId === "image-comparison") {
    const items = firstRecordArray(value, ["items", "images"]);
    if (items.length !== 2) {
      result.errors.push(issue("invalid_image_comparison_count", `${label} image comparison needs exactly two images.`));
    }
    items.forEach((item, index) => {
      const image = isRecord(item) && isRecord(item.image) ? item.image : {};
      if (!hasText(image.url) || (!hasText(image.alt) && !hasText(image.altText))) {
        result.errors.push(issue(
          "invalid_image_comparison_item",
          `${label} comparison image ${index + 1} needs an uploaded image and description.`
        ));
      }
    });
  }

  if (elementId === "image-hotspots") {
    const image = isRecord(value.image) ? value.image : {};
    if (!hasText(image.url) || (!hasText(image.alt) && !hasText(image.altText))) {
      result.errors.push(issue("invalid_hotspot_image", `${label} interactive image needs a URL and alt text.`));
    }

    const hotspots = Array.isArray(value.hotspots) ? value.hotspots : [];
    const knownProductSlugs = new Set(productSlugs);
    if (!hotspots.length) {
      result.errors.push(issue("empty_hotspots", `${label} interactive image needs at least one placement.`));
    }
    if (hotspots.length > 20) {
      result.errors.push(issue("too_many_hotspots", `${label} interactive image supports at most 20 placements.`));
    }

    hotspots.forEach((hotspot, index) => {
      const hotspotLabel = `${label} placement ${index + 1}`;
      if (!isRecord(hotspot)) {
        result.errors.push(issue("invalid_hotspot", `${hotspotLabel} must be an object.`));
        return;
      }

      if (!hasAnyText(hotspot, ["title", "name", "label"])) {
        result.errors.push(issue("missing_hotspot_label", `${hotspotLabel} needs a label.`));
      }

      for (const coordinate of ["x", "y"] as const) {
        const number = Number(hotspot[coordinate]);
        if (!Number.isFinite(number) || number < 0 || number > 100) {
          result.errors.push(issue("invalid_hotspot_position", `${hotspotLabel} ${coordinate} must be between 0 and 100.`));
        }
      }

      if (hotspot.width !== undefined && hotspot.width !== "") {
        const width = Number(hotspot.width);
        if (!Number.isFinite(width) || width < 1 || width > 50) {
          result.errors.push(issue("invalid_hotspot_width", `${hotspotLabel} width must be between 1 and 50.`));
        }
      }

      const productSlug = hasText(hotspot.productSlug) ? hotspot.productSlug : "";
      if (!productSlug && !hasText(hotspot.url)) {
        result.errors.push(issue("missing_hotspot_target", `${hotspotLabel} needs a product slug or link URL.`));
      } else if (productSlug && knownProductSlugs.size && !knownProductSlugs.has(productSlug)) {
        result.errors.push(issue("missing_product_reference", `${hotspotLabel} references missing product ${productSlug}.`));
      }

      const overlay = isRecord(hotspot.image) ? hotspot.image : null;
      if (overlay && (!hasText(overlay.url) || (!hasText(overlay.alt) && !hasText(overlay.altText)))) {
        result.errors.push(issue("invalid_hotspot_overlay", `${hotspotLabel} overlay image needs a URL and alt text.`));
      }
    });
  }
}

function validateGalleryValue(
  result: BuilderValidationResult,
  label: string,
  value: unknown
) {
  if (!isRecord(value)) {
    result.errors.push(issue("invalid_gallery_value", `${label} gallery block needs configured image data.`));
    return;
  }

  const items = Array.isArray(value.items) ? value.items : Array.isArray(value.slides) ? value.slides : [];
  const settings = isRecord(value.settings) ? value.settings : {};
  const displayMode = settings.displayMode;

  if (!items.length) {
    result.errors.push(issue("empty_gallery", `${label} gallery block needs at least one image.`));
  }

  if (!["gallery", "slider", "carousel"].includes(String(displayMode || ""))) {
    result.errors.push(issue("missing_gallery_display_mode", `${label} gallery block needs gallery, slider, or carousel display mode.`));
  }

  for (const [index, item] of items.entries()) {
    if (!itemUrl(item)) {
      result.errors.push(issue("missing_gallery_item_url", `${label} gallery item ${index + 1} needs a URL.`));
    }
    if (!itemAlt(item)) {
      result.errors.push(issue("missing_gallery_item_alt", `${label} gallery item ${index + 1} needs alt text.`));
    }
  }
}

export function validateBuilderBlockContract(
  block: BuilderBlockContract,
  options: {
    pageSlug?: string;
    sectionKey?: string;
    elementId?: string;
    productSlugs?: Iterable<string>;
  } = {}
) {
  const result = validationResult();
  const pageSlug = options.pageSlug || "page";
  const sectionKey = options.sectionKey || "section";
  const label = blockLabel(pageSlug, sectionKey, block.key);
  const blockElementId = hasText(block.settings?.elementId)
    ? String(block.settings.elementId)
    : options.elementId;
  const registeredElement = builderElementById(blockElementId);
  const supportedTypes = new Set<string>(contentBlockTypes());

  if (!hasText(block.key)) {
    result.errors.push(issue("missing_block_key", `${pageSlug}/${sectionKey} has a block without a key.`));
  }

  if (!hasText(block.type)) {
    result.errors.push(issue("missing_block_type", `${label} has no block type.`));
    return result;
  }

  if (blockElementId && !registeredElement) {
    result.errors.push(issue("unknown_block_element_id", `${label} references unknown builder element ${blockElementId}.`));
  }

  const blockType = block.type;

  if (!supportedTypes.has(blockType)) {
    result.errors.push(issue("unsupported_block_type", `${label} uses unsupported block type ${blockType}.`));
  }

  if (registeredElement && !(registeredElement.blockTypes as readonly string[]).includes(blockType)) {
    result.errors.push(issue("block_type_not_allowed", `${label} uses ${blockType}, which is not allowed by builder element ${registeredElement.id}.`));
  }

  if (block.value === undefined || block.value === null) {
    result.errors.push(issue("empty_block_value", `${label} has empty block value.`));
    return result;
  }

  if ((blockType === "TEXT" || blockType === "RICH_TEXT") && typeof block.value !== "string") {
    result.errors.push(issue("invalid_text_value", `${label} text block value must be a string.`));
  }

  if (blockType === "EMBED") {
    const customCodeResult = validateCustomCodeValue(block.value);
    result.errors.push(...customCodeResult.errors.map((error) => ({
      ...error,
      message: `${label} ${error.message}`
    })));
  }

  if (blockType === "IMAGE") {
    if (!isRecord(block.value) || !hasText(block.value.url)) {
      result.errors.push(issue("missing_image_url", `${label} image block needs a URL.`));
    }
    if (!isRecord(block.value) || (!hasText(block.value.alt) && !hasText(block.value.altText))) {
      result.errors.push(issue("missing_image_alt", `${label} image block needs alt text.`));
    }
  }

  if (blockType === "GALLERY") {
    validateGalleryValue(result, label, block.value);
  }

  if (blockType === "BUTTON" || blockType === "CTA") {
    if (!isRecord(block.value) || !hasText(block.value.label) || !hasText(block.value.url)) {
      result.errors.push(issue("invalid_action_value", `${label} action block needs label and URL.`));
    }
  }

  if (blockType === "CONTACT_FORM" && !isRecord(block.value)) {
    result.errors.push(issue("invalid_contact_form_value", `${label} contact form block needs configuration.`));
  }

  if (blockType === "PRODUCT_LIST") {
    const slugs = isRecord(block.value) && Array.isArray(block.value.productSlugs) ? block.value.productSlugs : [];
    const knownProductSlugs = new Set(options.productSlugs || []);

    if (!slugs.length) {
      result.errors.push(issue("empty_product_list", `${label} product list needs productSlugs.`));
    }

    for (const slug of slugs) {
      if (knownProductSlugs.size && !knownProductSlugs.has(String(slug))) {
        result.errors.push(issue("missing_product_reference", `${label} references missing product ${String(slug)}.`));
      }
    }
  }

  if (blockType === "CUSTOM") {
    const customValue = block.value;

    if (!isRecord(customValue) || !structuredCustomKeys.some((key) => key in customValue)) {
      result.errors.push(issue("unstructured_custom_value", `${label} custom block is not structured for the editor.`));
    }

    validateCustomElementValue(result, label, registeredElement?.id, customValue, options.productSlugs);

    if (blockElementId === "structured-content" && isRecord(block.value) && Array.isArray(block.value.items) && block.value.items.length) {
      result.warnings.push(issue("fallback_structured_content", `${label} custom items render as structured content but still need richer visual templates.`));
    }
  }

  return result;
}

export function validateBuilderSectionContract(
  section: BuilderSectionContract,
  options: {
    pageSlug?: string;
    requireElementId?: boolean;
    productSlugs?: Iterable<string>;
  } = {}
) {
  const result = validationResult();
  const pageSlug = options.pageSlug || "page";
  const sectionKey = section.key || "(missing section key)";
  const elementId = hasText(section.settings?.elementId) ? String(section.settings?.elementId) : "";
  const registeredElement = builderElementById(elementId);
  const blockKeys = new Set<string>();

  if (!hasText(section.key)) {
    result.errors.push(issue("missing_section_key", `${pageSlug} has a section without a key.`));
  }

  if (options.requireElementId && !elementId) {
    result.errors.push(issue("missing_element_id", `${pageSlug}/${sectionKey} has no registered builder element id.`));
  } else if (elementId && !registeredElement) {
    result.errors.push(issue("unknown_element_id", `${pageSlug}/${sectionKey} references unknown builder element ${elementId}.`));
  } else if (registeredElement?.editorAvailable === false) {
    result.warnings.push(issue("fallback_element", `${pageSlug}/${sectionKey} uses fallback builder element ${elementId}; create a richer element before Gate 2 completion.`));
  }

  if (!section.blocks?.length) {
    result.errors.push(issue("empty_section", `${pageSlug}/${sectionKey} needs at least one block.`));
  }

  for (const block of section.blocks || []) {
    if (block.key) {
      if (blockKeys.has(block.key)) {
        result.errors.push(issue("duplicate_block_key", `${pageSlug}/${sectionKey} duplicates block key ${block.key}.`));
      }
      blockKeys.add(block.key);
    }

    const blockResult = validateBuilderBlockContract(block, {
      pageSlug,
      sectionKey,
      elementId,
      productSlugs: options.productSlugs
    });
    result.errors.push(...blockResult.errors);
    result.warnings.push(...blockResult.warnings);
  }

  return result;
}

export function validateBuilderTemplateContract(template: BuilderTemplateContract) {
  const section: BuilderSectionContract = {
    key: template.id || "template",
    settings: {
      elementId: template.id
    },
    blocks: (template.blocks || []).map((block, index) => ({
      ...block,
      key: block.key || `${template.id || "template"}-${String(block.type || "block").toLowerCase()}-${index + 1}`
    }))
  };

  return validateBuilderSectionContract(section, {
    pageSlug: "template",
    requireElementId: true,
    productSlugs: ["starter-product"]
  });
}
