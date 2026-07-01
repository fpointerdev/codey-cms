import { state } from "./core.js";

function pathParts() {
  return (window.location.pathname || "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

function looksLikeLocale(value) {
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(value || "");
}

export function currentLocale() {
  const params = new URLSearchParams(window.location.search);
  const queryLocale = params.get("locale");
  if (looksLikeLocale(queryLocale)) return queryLocale.toLowerCase();

  const [firstPart] = pathParts();
  return looksLikeLocale(firstPart) ? firstPart.toLowerCase() : state.config?.localization?.defaultLocale || "en";
}

export function pageSlug() {
  const params = new URLSearchParams(window.location.search);
  const querySlug = params.get("slug");
  if (querySlug) return querySlug;

  const parts = pathParts();
  if (looksLikeLocale(parts[0])) parts.shift();
  const path = parts.join("/");

  if (!path || path === "cy-admin" || path.startsWith("dashboard") || path.startsWith("auth/")) {
    return "home";
  }

  return decodeURIComponent(path);
}

export function currentAdminRoute() {
  const params = new URLSearchParams(window.location.search);
  const adminView = params.get("admin");

  if (adminView) {
    return {
      view: adminView,
      userId: params.get("userId") || undefined
    };
  }

  const path = (window.location.pathname || "/").replace(/\/+$/, "") || "/";

  if (path === "/cy-admin" || path === "/dashboard") return { view: "dashboard" };
  if (path === "/auth/reset-password") return { view: "password-reset", token: params.get("token") || "" };
  if (path === "/dashboard/profile") return { view: "profile" };
  if (path === "/dashboard/shop") return { view: "shop" };
  if (path === "/dashboard/shop/products") return { view: "shop-products" };
  if (path === "/dashboard/shop/products/new") return { view: "product-create" };
  if (path.startsWith("/dashboard/shop/products/") && path.endsWith("/edit")) {
    return {
      view: "product-editor",
      slug: decodeURIComponent(path.slice("/dashboard/shop/products/".length, -"/edit".length))
    };
  }
  if (path === "/dashboard/shop/categories") return { view: "shop-categories" };
  if (path === "/dashboard/shop/attributes") return { view: "shop-attributes" };
  if (path === "/dashboard/shop/orders") return { view: "shop-orders" };
  if (path === "/dashboard/shop/configuration") return { view: "shop-configuration" };
  if (path === "/dashboard/pages") return { view: "pages" };
  if (path === "/dashboard/pages/new") return { view: "page-create" };

  if (path.startsWith("/dashboard/pages/") && path.endsWith("/builder")) {
    return {
      view: "page-builder",
      slug: decodeURIComponent(path.slice("/dashboard/pages/".length, -"/builder".length))
    };
  }

  if (path === "/dashboard/posts") return { view: "posts" };
  if (path === "/dashboard/posts/new") return { view: "post-create" };
  if (path === "/dashboard/posts/categories") return { view: "post-categories" };

  if (path.startsWith("/dashboard/posts/") && path.endsWith("/builder")) {
    return {
      view: "post-builder",
      slug: decodeURIComponent(path.slice("/dashboard/posts/".length, -"/builder".length))
    };
  }

  if (path === "/dashboard/users") return { view: "users" };

  if (path.startsWith("/dashboard/users/")) {
    return {
      view: "user",
      userId: decodeURIComponent(path.slice("/dashboard/users/".length))
    };
  }

  if (path === "/dashboard/settings") return { view: "settings" };

  return null;
}

export function pageHref(slug) {
  return publicPageHref(slug);
}

export function publicShopRoute() {
  const path = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
  const parts = path.replace(/^\/+/, "").split("/").map((part) => decodeURIComponent(part));
  if (looksLikeLocale(parts[0])) parts.shift();

  if (parts[0] !== "shop" && parts[0] !== "product") return null;
  if (parts[0] === "shop" && parts.length === 1) return { view: "shop" };
  if (parts[0] === "shop" && parts[1] === "category" && parts[2]) return { view: "shop-category", category: parts[2] };
  if (parts[0] === "shop" && parts[1] === "attribute" && parts[2]) {
    return { view: "shop-attribute", attributeName: parts[2], attributeValue: parts[3] || "" };
  }
  if (parts[0] === "product" && parts[1]) return { view: "product", slug: parts[1] };

  return null;
}

export function publicPostRoute() {
  const path = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
  const parts = path.replace(/^\/+/, "").split("/").map((part) => decodeURIComponent(part));
  if (looksLikeLocale(parts[0])) parts.shift();

  if (parts[0] !== "posts" || !parts[1]) return null;

  return { view: "post", slug: parts.slice(1).join("/") };
}

export function publicPageHref(slug) {
  const normalizedSlug = String(slug || "home").replace(/^\/+|\/+$/g, "");
  if (!normalizedSlug || normalizedSlug === "home") return "/";

  return `/${normalizedSlug.split("/").map(encodeURIComponent).join("/")}`;
}

export function publicPostHref(slug) {
  const normalizedSlug = String(slug || "").replace(/^\/+|\/+$/g, "");
  if (!normalizedSlug) return "/posts";

  return `/posts/${normalizedSlug.split("/").map(encodeURIComponent).join("/")}`;
}

export function publicProductHref(slug) {
  const normalizedSlug = String(slug || "").replace(/^\/+|\/+$/g, "");
  if (!normalizedSlug) return "/shop";

  return `/product/${normalizedSlug.split("/").map(encodeURIComponent).join("/")}`;
}

export function adminHref(view, userId = "") {
  if (view === "dashboard") return "/dashboard";
  if (view === "shop") return "/dashboard/shop";
  if (view === "shop-products") return "/dashboard/shop/products";
  if (view === "product-create") return "/dashboard/shop/products/new";
  if (view === "product-editor" && userId) return `/dashboard/shop/products/${encodeURIComponent(userId)}/edit`;
  if (view === "shop-categories") return "/dashboard/shop/categories";
  if (view === "shop-attributes") return "/dashboard/shop/attributes";
  if (view === "shop-orders") return "/dashboard/shop/orders";
  if (view === "shop-configuration") return "/dashboard/shop/configuration";
  if (view === "pages") return "/dashboard/pages";
  if (view === "page-create") return "/dashboard/pages/new";
  if (view === "page-builder" && userId) return `/dashboard/pages/${encodeURIComponent(userId)}/builder`;
  if (view === "posts") return "/dashboard/posts";
  if (view === "post-create") return "/dashboard/posts/new";
  if (view === "post-categories") return "/dashboard/posts/categories";
  if (view === "post-builder" && userId) return `/dashboard/posts/${encodeURIComponent(userId)}/builder`;
  if (view === "profile") return "/dashboard/profile";
  if (view === "settings") return "/dashboard/settings";
  if (view === "user" && userId) return `/dashboard/users/${encodeURIComponent(userId)}`;
  return "/dashboard/users";
}
