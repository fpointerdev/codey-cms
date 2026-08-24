import type { ModuleId } from "../core/types/module.js";
import { runtimeVersion } from "../runtime/release.js";
import { builderElementRegistry } from "./builder/element-registry.js";

export type ModuleCategory = "core" | "content" | "commerce" | "operations";

export type ModulePlan = "free" | "starter" | "cms" | "shop" | "pro";

export type ModuleLifecycleHook = "install" | "enable" | "disable" | "uninstall" | "seed" | "migrate";

export type ModulePermissionDefinition = {
  action: string;
  subject: string;
  description: string;
};

export type ModuleManifestEntry = {
  id: ModuleId;
  label: string;
  description: string;
  version: string;
  category: ModuleCategory;
  dependencies: ModuleId[];
  required: boolean;
  defaultEnabled: boolean;
  plans: ModulePlan[];
  monthlyEuroCents: number;
  compatibility: {
    minBaseVersion: string;
    maxBaseVersion?: string;
  };
  permissions: ModulePermissionDefinition[];
  lifecycle: Record<ModuleLifecycleHook, boolean>;
};

export type DeploymentProfileId = "presentation" | "cms" | "shop" | "saas";

export type DeploymentProfile = {
  id: DeploymentProfileId;
  label: string;
  description: string;
  modules: ModuleId[];
  monthlyEuroCents: number;
};

const baseVersion = runtimeVersion;
const standardLifecycle: Record<ModuleLifecycleHook, boolean> = {
  install: true,
  enable: true,
  disable: true,
  uninstall: true,
  seed: true,
  migrate: true
};
const requiredLifecycle: Record<ModuleLifecycleHook, boolean> = {
  ...standardLifecycle,
  disable: false,
  uninstall: false
};
const compatibility = {
  minBaseVersion: baseVersion
};

export const moduleCatalog = {
  health: {
    id: "health",
    label: "Health",
    description: "Runtime health checks for deployments and uptime monitoring.",
    version: baseVersion,
    category: "core",
    dependencies: [],
    required: true,
    defaultEnabled: true,
    plans: ["free"],
    monthlyEuroCents: 0,
    compatibility,
    permissions: [],
    lifecycle: requiredLifecycle
  },
  config: {
    id: "config",
    label: "Configuration",
    description: "Runtime metadata, DB-backed module management, site settings, deployment profiles, domains, audit logs, and generation contracts.",
    version: baseVersion,
    category: "core",
    dependencies: [],
    required: true,
    defaultEnabled: true,
    plans: ["free"],
    monthlyEuroCents: 0,
    compatibility,
    permissions: [
      {
        action: "read",
        subject: "modules",
        description: "Read installed modules and settings"
      },
      {
        action: "manage",
        subject: "modules",
        description: "Install, enable, disable, uninstall, and configure modules"
      },
      {
        action: "manage",
        subject: "secrets",
        description: "Configure credential-bearing service connections"
      },
      {
        action: "read",
        subject: "audit",
        description: "Read structured audit logs"
      }
    ],
    lifecycle: requiredLifecycle
  },
  auth: {
    id: "auth",
    label: "Authentication",
    description: "JWT access tokens, refresh tokens, registration, login, and profile endpoints.",
    version: baseVersion,
    category: "core",
    dependencies: [],
    required: true,
    defaultEnabled: true,
    plans: ["starter", "cms", "shop", "pro"],
    monthlyEuroCents: 60,
    compatibility,
    permissions: [],
    lifecycle: requiredLifecycle
  },
  users: {
    id: "users",
    label: "Users",
    description: "User account listing, profile data, and status management.",
    version: baseVersion,
    category: "core",
    dependencies: ["auth", "roles"],
    required: true,
    defaultEnabled: true,
    plans: ["starter", "cms", "shop", "pro"],
    monthlyEuroCents: 60,
    compatibility,
    permissions: [
      {
        action: "read",
        subject: "users",
        description: "Read users"
      },
      {
        action: "update",
        subject: "users",
        description: "Update users"
      },
      {
        action: "delete",
        subject: "users",
        description: "Delete users"
      },
      {
        action: "invite",
        subject: "users",
        description: "Invite users"
      }
    ],
    lifecycle: requiredLifecycle
  },
  roles: {
    id: "roles",
    label: "Roles and Permissions",
    description: "RBAC roles, permissions, and administrative access controls.",
    version: baseVersion,
    category: "core",
    dependencies: ["auth"],
    required: true,
    defaultEnabled: true,
    plans: ["starter", "cms", "shop", "pro"],
    monthlyEuroCents: 60,
    compatibility,
    permissions: [
      {
        action: "read",
        subject: "roles",
        description: "Read roles and permissions"
      },
      {
        action: "create",
        subject: "roles",
        description: "Create roles"
      },
      {
        action: "update",
        subject: "roles",
        description: "Update roles"
      }
    ],
    lifecycle: requiredLifecycle
  },
  products: {
    id: "products",
    label: "Products",
    description: "Product catalog, categories, stock, pricing, and product publishing status.",
    version: baseVersion,
    category: "commerce",
    dependencies: [],
    required: false,
    defaultEnabled: false,
    plans: ["shop", "pro"],
    monthlyEuroCents: 500,
    compatibility,
    permissions: [
      {
        action: "read",
        subject: "products",
        description: "Read draft and archived products"
      },
      {
        action: "create",
        subject: "products",
        description: "Create products and categories"
      },
      {
        action: "update",
        subject: "products",
        description: "Update products"
      }
    ],
    lifecycle: standardLifecycle
  },
  orders: {
    id: "orders",
    label: "Orders",
    description: "Customer orders, order items, totals, stock reservation, and status workflow.",
    version: baseVersion,
    category: "commerce",
    dependencies: ["products"],
    required: false,
    defaultEnabled: false,
    plans: ["shop", "pro"],
    monthlyEuroCents: 700,
    compatibility,
    permissions: [
      {
        action: "read",
        subject: "orders",
        description: "Read orders"
      },
      {
        action: "update",
        subject: "orders",
        description: "Update orders"
      }
    ],
    lifecycle: standardLifecycle
  },
  cms: {
    id: "cms",
    label: "CMS",
    description: "Pages, posts, menus, redirects, media assets, contact forms, revisions, publish states, tags, and content blocks.",
    version: baseVersion,
    category: "content",
    dependencies: [],
    required: false,
    defaultEnabled: false,
    plans: ["cms", "shop", "pro"],
    monthlyEuroCents: 300,
    compatibility,
    permissions: [
      {
        action: "read",
        subject: "cms",
        description: "Read draft and archived CMS content"
      },
      {
        action: "create",
        subject: "cms",
        description: "Create CMS pages and posts"
      },
      {
        action: "update",
        subject: "cms",
        description: "Update CMS pages and posts"
      }
    ],
    lifecycle: standardLifecycle
  },
  localization: {
    id: "localization",
    label: "Localization",
    description: "Multilingual CMS pages, posts, categories, menus, locale routing, and language switcher settings.",
    version: baseVersion,
    category: "content",
    dependencies: ["cms"],
    required: false,
    defaultEnabled: false,
    plans: ["cms", "shop", "pro"],
    monthlyEuroCents: 200,
    compatibility,
    permissions: [
      {
        action: "manage",
        subject: "localization",
        description: "Manage locales, default language, and translation settings"
      }
    ],
    lifecycle: standardLifecycle
  },
  notifications: {
    id: "notifications",
    label: "Notifications",
    description: "System and email notification records for users and operations.",
    version: baseVersion,
    category: "operations",
    dependencies: ["auth", "users"],
    required: false,
    defaultEnabled: false,
    plans: ["cms", "shop", "pro"],
    monthlyEuroCents: 100,
    compatibility,
    permissions: [
      {
        action: "create",
        subject: "notifications",
        description: "Create notifications"
      }
    ],
    lifecycle: standardLifecycle
  },
  payments: {
    id: "payments",
    label: "Payments",
    description: "Site-owned Stripe, PayPal, and manual payment configuration with verified order settlement.",
    version: baseVersion,
    category: "commerce",
    dependencies: ["orders"],
    required: false,
    defaultEnabled: false,
    plans: ["shop", "pro"],
    monthlyEuroCents: 300,
    compatibility,
    permissions: [
      {
        action: "read",
        subject: "payments",
        description: "View payments and payment provider configuration"
      },
      {
        action: "update",
        subject: "payments",
        description: "Configure payment providers and manage payment status"
      }
    ],
    lifecycle: standardLifecycle
  }
} satisfies Record<ModuleId, ModuleManifestEntry>;

const coreModules: ModuleId[] = ["health", "config", "auth", "users", "roles"];

export const deploymentProfiles = {
  presentation: {
    id: "presentation",
    label: "Presentation Website",
    description: "Marketing or company website with editable CMS pages.",
    modules: [...coreModules, "cms"],
    monthlyEuroCents: 60
  },
  cms: {
    id: "cms",
    label: "CMS Website",
    description: "Content-first website with pages, posts, users, and notifications.",
    modules: [...coreModules, "cms", "notifications"],
    monthlyEuroCents: 300
  },
  shop: {
    id: "shop",
    label: "Shop",
    description: "Commerce website with editable pages, products, orders, payments, and notifications.",
    modules: [...coreModules, "cms", "products", "orders", "notifications", "payments"],
    monthlyEuroCents: 1000
  },
  saas: {
    id: "saas",
    label: "SaaS",
    description: "Authenticated application base with users, roles, and notifications.",
    modules: [...coreModules, "notifications"],
    monthlyEuroCents: 700
  }
} satisfies Record<DeploymentProfileId, DeploymentProfile>;

export const themeManifest = {
  id: "code-epsylon-base",
  label: "CodeY Base Theme",
  version: baseVersion,
  admin: {
    entry: "/cy-admin",
    routes: [
      "/dashboard",
      "/dashboard/pages",
      "/dashboard/posts",
      "/dashboard/collections",
      "/dashboard/shop",
      "/dashboard/shop/products",
      "/dashboard/shop/categories",
      "/dashboard/shop/attributes",
      "/dashboard/shop/orders",
      "/dashboard/shop/configuration",
      "/dashboard/posts/categories",
      "/dashboard/profile",
      "/dashboard/users",
      "/dashboard/users/:id",
      "/dashboard/users/:id/edit",
      "/dashboard/settings"
    ],
    navigation: [
      { label: "Dashboard", route: "/dashboard", view: "dashboard" },
      { label: "Shop", route: "/dashboard/shop", view: "shop", modules: ["products", "orders"] },
      { label: "Pages", route: "/dashboard/pages", view: "pages", modules: ["cms"] },
      { label: "Posts", route: "/dashboard/posts", view: "posts", modules: ["cms"] },
      { label: "Collections", route: "/dashboard/collections", view: "collections", modules: ["cms"] },
      { label: "Users", route: "/dashboard/users", view: "users", modules: ["users", "roles"] },
      { label: "Profile", route: "/dashboard/profile", view: "profile", modules: ["auth"] },
      { label: "Settings", route: "/dashboard/settings", view: "settings", modules: ["config"] }
    ],
    dashboard: {
      title: "Project Console",
      metrics: ["pages", "posts", "products", "enabledModules"],
      primaryWorkflows: ["pages", "posts", "shop", "users"],
      moduleStateVisible: true,
      builderPaletteVisible: true
    }
  },
  frontend: {
    entry: "/",
    routePattern: "/:slug",
    homeRoute: "/",
    shopRoutes: ["/shop", "/shop/category/:slug", "/shop/attribute/:name/:value", "/product/:slug", "/account/orders"],
    pageQueryParamFallback: "slug",
    editableWhenAuthenticated: true,
    serverRenderedSeo: true,
    seoFields: ["title", "description", "canonical", "openGraph", "twitterCard"],
    noindexRoutes: ["/cy-admin", "/dashboard/*", "/auth/*", "/account/orders"]
  },
  cms: {
    publicRoutes: {
      pages: ["/", "/:slug", "/?slug=:slug"],
      sitemap: "/sitemap.xml",
      robots: "/robots.txt"
    },
    contentModels: {
      pages: {
        publicRenderer: true,
        routePattern: "/:slug"
      },
      posts: {
        publicRenderer: true,
        routePattern: "/posts/:slug",
        adminRoute: "/dashboard/posts",
        apiRoute: "/api/v1/cms/posts"
      },
      collections: {
        publicRenderer: false,
        publicApi: true,
        adminRoute: "/dashboard/collections",
        apiRoute: "/api/v1/cms/collections"
      }
    },
    apiRoutes: {
      pages: "/api/v1/cms/pages",
      posts: "/api/v1/cms/posts",
      collections: "/api/v1/cms/collections",
      menus: "/api/v1/cms/menus",
      media: "/api/v1/cms/media",
      contactForm: "/api/v1/cms/forms/contact"
    },
    editableBlocks: [
      "TEXT",
      "RICH_TEXT",
      "IMAGE",
      "GALLERY",
      "EMBED",
      "BUTTON",
      "CTA",
      "CONTACT_FORM",
      "PRODUCT_LIST",
      "CUSTOM"
    ],
    contactForms: {
      blockType: "CONTACT_FORM",
      fields: ["name", "email", "phone", "subject", "message"],
      spamSignals: ["website", "startedAt"]
    },
    media: {
      storageDrivers: ["local", "s3"],
      localPublicPath: "/uploads",
      productionDriver: "s3",
      directUploadApi: "/api/v1/cms/media/upload",
      signedUploadApi: "/api/v1/cms/media/uploads"
    }
  },
  componentTemplates: builderElementRegistry.map((element) => ({
    id: element.id,
    label: element.label,
    modules: element.modules,
    blocks: element.blockTypes,
    purpose: element.description,
    generatorSafe: element.generatorSafe,
    editorAvailable: element.editorAvailable !== false
  })),
  generatorRules: [
    "Keep client themes inside the copied project; do not modify the upstream CodeY base for one client.",
    "Use CMS pages, sections, and content blocks for editable public content.",
    "Use /cy-admin for login and /dashboard routes for administration.",
    "Use clean public page URLs such as /about while keeping ?slug=about as a compatibility fallback.",
    "Use server-rendered SEO fields for page title, description, canonical, Open Graph, and Twitter metadata.",
    "Reuse the builder element registry and componentTemplates before inventing custom block structures.",
    "Enable modules through the manifest and installed module records before using module-specific UI.",
    "Use CONTACT_FORM blocks for public inquiry forms instead of static disabled markup.",
    "Use the gallery componentTemplate for static portfolio/gallery pages instead of overloading sliders.",
    "Use the image-hotspots componentTemplate for positioned links or product placements over a real scene image.",
    "Use video display.playback=hover-focus only for muted hover/focus playback; native controls remain the touch and reduced-motion fallback.",
    "Treat /shop as the canonical product collection route and configure optional hero media through product storefront settings.",
    "Use MediaAsset records and the media upload APIs for images; local storage is for development and S3-compatible storage is required in production.",
    "Never generate custom-code elements. They are an explicit trusted-editor escape hatch and remain sandboxed on public pages."
  ]
};
