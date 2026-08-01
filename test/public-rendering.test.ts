import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { injectPublicShellContent } from "../src/core/public-shell.js";

const {
  renderPageContent,
  renderFooter,
  renderMenuItems,
  renderPostContent,
  renderProductDetailContent,
  renderShopListingContent,
  withPublicRenderContext
} = await import("../apps/web/web/public-renderer.js");

test("public shell includes an accessible mobile navigation control", async () => {
  const shell = await readFile(new URL("../apps/web/index.html", import.meta.url), "utf8");

  assert.match(shell, /data-site-nav-toggle/);
  assert.match(shell, /aria-controls="site-navigation"/);
  assert.match(shell, /<nav id="site-navigation"/);
});

test("public page markup renders meaningful sanitized content without editor controls", () => {
  const page = {
    title: "Server rendered page",
    excerpt: "Visible before JavaScript loads.",
    content: { layout: "full-width" },
    sections: [
      {
        id: "section-1",
        key: "section-1",
        label: "Introduction",
        settings: {},
        blocks: [
          {
            key: "copy",
            type: "RICH_TEXT",
            value: "<p>Safe content</p><script>unsafe()</script>",
            settings: {},
            editable: true
          },
          {
            key: "contact",
            type: "CONTACT_FORM",
            value: { formKey: "contact" },
            settings: {},
            editable: true
          }
        ]
      }
    ]
  };

  const html = renderPageContent(page, { canEdit: false });
  assert.match(html, /Server rendered page/);
  assert.match(html, /Safe content/);
  assert.match(html, /contact-form/);
  assert.doesNotMatch(html, /unsafe\(\)|data-edit-block/);
  assert.match(renderPageContent(page, { canEdit: true }), /data-edit-block/);
});

test("visual editing keeps structural controls available for locked content", () => {
  const html = renderPageContent({
    title: "Locked content",
    content: {},
    sections: [{
      id: "locked-section",
      key: "locked-section",
      settings: {},
      blocks: [{
        key: "locked-copy",
        type: "RICH_TEXT",
        value: "<p>Managed copy</p>",
        settings: {},
        editable: false
      }]
    }]
  }, { canEdit: true });

  assert.match(html, /data-visual-move-block="up"/);
  assert.match(html, /data-visual-duplicate-block/);
  assert.match(html, /data-visual-delete-block/);
  assert.doesNotMatch(html, /data-visual-start-inline|data-edit-block/);
});

test("generated public pages preserve section keys and avoid duplicate hero titles", () => {
  const html = renderPageContent({
    title: "Home",
    content: { hideTitle: true },
    sections: [{
      id: "section-id",
      key: "hero",
      settings: {},
      blocks: [{
        key: "hero-heading",
        type: "RICH_TEXT",
        value: "<h1>Precision without compromise</h1>",
        settings: {},
        editable: true
      }]
    }]
  });

  assert.doesNotMatch(html, /class="page-title"/);
  assert.match(html, /data-section-key="hero"/);
  assert.match(html, /<h1>Precision without compromise<\/h1>/);
});

test("WebsiteSpec pages keep preview-compatible layout hooks and editable hero points", () => {
  const html = renderPageContent({
    title: "Home",
    excerpt: "",
    content: {
      source: "websiteSpec",
      hideTitle: true,
      layout: "full-width",
      style: { theme: "Utility Pro" }
    },
    sections: [{
      id: "hero-section",
      key: "hero",
      settings: {
        layout: "two-column",
        container: "wide",
        spacing: "xl",
        style: { preset: "refined-light" },
        decoration: { type: "narrative-ribbon" },
        websiteSpec: {
          type: "hero",
          composition: "eight-column-split",
          collection: true
        }
      },
      blocks: [
        {
          key: "hero-heading",
          type: "RICH_TEXT",
          value: "<h1>Premium vehicle care</h1>",
          settings: {},
          editable: true
        },
        {
          key: "hero-image",
          type: "IMAGE",
          value: { url: "/uploads/hero.jpg", alt: "Vehicle wash" },
          settings: {},
          editable: true
        },
        {
          key: "hero-points",
          type: "CUSTOM",
          value: {
            variant: "hero-points",
            items: [{ title: "Care", body: "A checked handover" }]
          },
          settings: {},
          editable: true
        }
      ]
    }]
  });

  assert.match(html, /class="website-spec-page"/);
  assert.match(html, /website-spec-section/);
  assert.match(html, /section-hero/);
  assert.match(html, /layout-two-column/);
  assert.match(html, /preset-refined-light/);
  assert.match(html, /decoration-narrative-ribbon/);
  assert.match(html, /<div class="section-inner">/);
  assert.match(html, /section-copy content-block hero-copy/);
  assert.match(html, /class="hero-points"/);
  assert.match(html, /<figure class="section-media hero-media">/);
  assert.doesNotMatch(html, /content-type-rich-text website-spec-heading/);
});

test("WebsiteSpec hero background settings render matching public hooks", () => {
  const html = renderPageContent({
    title: "Home",
    content: { source: "websiteSpec", hideTitle: true },
    sections: [{
      id: "hero-background-section",
      key: "hero",
      settings: {
        layout: "full-bleed",
        container: "full",
        mediaMode: "background",
        mediaPosition: "top",
        overlayColor: "#071014",
        overlayOpacity: 0.56,
        websiteSpec: {
          type: "hero",
          composition: "full-bleed",
          collection: false
        }
      },
      blocks: [
        {
          key: "hero-heading",
          type: "RICH_TEXT",
          value: "<h1>Architecture for daily life</h1>",
          settings: {},
          editable: true
        },
        {
          key: "hero-image",
          type: "IMAGE",
          value: { url: "/uploads/hero.jpg", alt: "Architects reviewing a physical model" },
          settings: {},
          editable: true
        }
      ]
    }]
  });

  assert.match(html, /section-hero\s+section-media-background\s+has-background-media/);
  assert.match(html, /layout-full-bleed/);
  assert.match(html, /--section-overlay-color:#071014/);
  assert.match(html, /--section-overlay-opacity:0\.56/);
  assert.match(html, /--section-media-position:center top/);
  assert.match(html, /<figure class="section-background-media">/);
  assert.match(html, /class="section-background-overlay"/);
  assert.doesNotMatch(html, /<figure class="section-media hero-media">/);
});

test("WebsiteSpec collection headings and actions render in one semantic copy group", () => {
  const html = renderPageContent({
    title: "Services",
    content: { source: "websiteSpec", hideTitle: true },
    sections: [{
      id: "services-section",
      key: "services",
      settings: { websiteSpec: { type: "featureGrid", collection: true } },
      blocks: [{
        key: "services-content",
        type: "CUSTOM",
        value: {
          type: "featureGrid",
          heading: "Choose your wash",
          cta: { label: "Explore services", url: "/services" },
          items: [{ title: "Express", body: "A quick exterior clean." }]
        },
        editable: true
      }]
    }]
  });

  assert.match(html, /<h2>Choose your wash<\/h2>/);
  assert.ok(html.indexOf("Choose your wash") < html.indexOf("Explore services"));
  assert.ok(html.indexOf("Explore services") < html.indexOf("Express"));
});

test("public footer keeps the configured site name on every page", () => {
  const html = withPublicRenderContext({
    config: { siteSettings: { title: "Washgo" } }
  }, () => renderFooter({ title: "Home", content: {} }));

  assert.match(html, /© \d{4} Washgo/);
  assert.doesNotMatch(html, /© \d{4} Home/);
});

test("public menu marks the current route", () => {
  const html = withPublicRenderContext({
    path: "/services/"
  }, () => renderMenuItems([
    { id: "home", label: "Home", url: "/" },
    { id: "services", label: "Services", url: "/services" }
  ]));

  assert.match(html, /href="\/services" aria-current="page"/);
  assert.doesNotMatch(html, /href="\/" aria-current="page"/);
});

test("structured tabs render accessible controls without an item limit", () => {
  const items = Array.from({ length: 9 }, (_, index) => ({
    title: `Tab ${index + 1}`,
    body: `Panel ${index + 1}`
  }));
  const html = renderPageContent({
    title: "Tabbed page",
    content: {},
    sections: [{
      id: "section-tabs",
      key: "section-tabs",
      settings: {},
      blocks: [{
        key: "details-tabs",
        type: "CONTENT",
        value: { variant: "tabs", items },
        settings: {},
        editable: true
      }]
    }]
  });

  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-controls="details-tabs-tabs-9-panel"/);
  assert.match(html, /id="details-tabs-tabs-9-panel"/);
  assert.match(html, /Panel 9/);
  assert.doesNotMatch(html, /structured-tab-input/);
});

test("public post markup and shell injection preserve the application shell", () => {
  const body = renderPostContent({
    title: "Published post",
    excerpt: "Post summary",
    status: "PUBLISHED",
    content: { body: "<p>Post body</p>" }
  });
  const shell = `<!doctype html><html><head><title>Site</title></head><body><a class="brand" data-brand>Old</a><nav data-menu></nav><article data-page></article><footer class="site-footer" data-footer></footer><script src="/app.js"></script></body></html>`;
  const rendered = injectPublicShellContent(shell, {
    brand: "CodeY $&",
    bodyAttributes: {
      "data-codey-preview": "cms",
      "data-codey-runtime-theme": "true",
      "data-design-family": "editorial"
    },
    menu: '<a href="/about">About</a>',
    body: `${body}<p>$& stays literal</p>`,
    footer: "Copyright $1",
    head: '<style data-site-design-system>:root{--accent:#123456}</style>'
  });

  assert.match(rendered, /data-server-rendered="true"/);
  assert.match(rendered, /<body data-codey-preview="cms" data-codey-runtime-theme="true" data-design-family="editorial">/);
  assert.match(rendered, /Published post/);
  assert.match(rendered, />CodeY \$&<\/a>/);
  assert.match(rendered, /<nav data-menu><a href="\/about">About<\/a><\/nav>/);
  assert.match(rendered, /\$& stays literal/);
  assert.match(rendered, />Copyright \$1<\/footer>/);
  assert.match(rendered, /data-site-design-system/);
  assert.match(rendered, /--accent:#123456/);
  assert.match(rendered, /<script src="\/app\.js"><\/script>/);
});

test("public images reserve layout, bound variants, and prioritize only the first image", () => {
  const html = renderPageContent({
    title: "Image page",
    content: {},
    sections: [{
      id: "media",
      key: "media",
      settings: {},
      blocks: [
        {
          key: "hero",
          type: "IMAGE",
          value: { url: "/uploads/hero.jpg", alt: "Hero", width: 640, height: 360 },
          settings: {},
          editable: true
        },
        {
          key: "supporting",
          type: "IMAGE",
          value: { url: "/uploads/supporting.jpg", alt: "Supporting", width: 320, height: 240 },
          settings: {},
          editable: true
        }
      ]
    }]
  });

  assert.equal((html.match(/fetchpriority="high"/g) || []).length, 1);
  assert.equal((html.match(/loading="lazy"/g) || []).length, 1);
  assert.match(html, /width="640" height="360"/);
  assert.match(html, /hero\.jpg\?w=640 640w/);
  assert.doesNotMatch(html, /hero\.jpg\?w=1200/);
  assert.doesNotMatch(html, /supporting\.jpg\?w=640/);
});

test("legacy slider placeholders recover intrinsic SVG dimensions", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"></svg>';
  const imageUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const html = renderPageContent({
    title: "Slider page",
    content: {},
    sections: [{
      id: "slider",
      key: "slider",
      settings: {},
      blocks: [{
        key: "slider-gallery",
        type: "GALLERY",
        value: {
          slides: [{ url: imageUrl, alt: "Legacy slide" }],
          settings: { displayMode: "slider" }
        },
        settings: {},
        editable: true
      }]
    }]
  });

  assert.match(html, /alt="Legacy slide" width="1200" height="700"/);
});

test("linked gallery items expose the whole item as an accessible destination", () => {
  const html = renderPageContent({
    title: "Projects",
    content: {},
    sections: [{
      id: "projects",
      key: "projects",
      settings: {},
      blocks: [{
        key: "project-gallery",
        type: "GALLERY",
        value: {
          items: [{
            url: "/uploads/playground.jpg",
            alt: "Community playground",
            caption: "<h3>Neighbourhood play space</h3>",
            link: "/projects/neighbourhood-play-space"
          }],
          settings: { displayMode: "gallery", showCaptions: true }
        },
        settings: {},
        editable: true
      }]
    }]
  });

  assert.match(html, /class="gallery-item-stretched-link"/);
  assert.match(html, /href="\/projects\/neighbourhood-play-space"/);
  assert.match(html, /aria-label="View Community playground"/);
  assert.match(html, /<figcaption><h3>Neighbourhood play space<\/h3><\/figcaption>/);
});

test("section backgrounds receive the same accessible foreground used by generated previews", () => {
  const html = withPublicRenderContext(
    {
      config: {
        siteSettings: {
          design: { colors: { primary: "#172145" } }
        }
      }
    },
    () => renderPageContent({
      title: "Accessible sections",
      content: {},
      sections: [
        {
          id: "dark-section",
          key: "dark-section",
          settings: {
            style: { backgroundColor: "#172145" },
            websiteSpec: { type: "text" }
          },
          blocks: []
        },
        {
          id: "light-section",
          key: "light-section",
          settings: {
            style: { background: "#fff8e7" },
            websiteSpec: { type: "text" }
          },
          blocks: []
        }
      ]
    })
  );

  assert.match(
    html,
    /data-section-key="dark-section"[^>]*style="--section-bg:#172145; --section-text:#ffffff"/
  );
  assert.match(
    html,
    /data-section-key="light-section"[^>]*style="--section-bg:#fff8e7; --section-text:#172145"/
  );
});

test("server rendering uses the active locale without client hydration", () => {
  const html = withPublicRenderContext({
    locale: "sq",
    config: {
      localization: {
        defaultLocale: "en",
        fallbackLocale: "en",
        strings: {
          "form.contact.name": { sq: "Emri" },
          "form.contact.submit": { sq: "Dergoni" }
        }
      }
    }
  }, () => renderPageContent({
    title: "Kontakt",
    content: {},
    sections: [{
      id: "contact",
      key: "contact",
      settings: {},
      blocks: [{ key: "form", type: "CONTACT_FORM", value: {}, settings: {}, editable: true }]
    }]
  }));

  assert.match(html, />Emri<\/span>/);
  assert.match(html, />Dergoni<\/button>/);
});

test("shop and product markup are useful without JavaScript and escape catalog data", () => {
  const product = {
    slug: "starter-product",
    name: "Starter <Product>",
    description: "A useful product <script>unsafe()</script>",
    sku: "STARTER-1",
    priceCents: 2500,
    currency: "EUR",
    stockQuantity: 4,
    metadata: {
      attributes: [{ name: "Material", value: "Steel" }]
    },
    category: { name: "Tools" },
    images: [{ url: "javascript:alert(1)", alt: "Unsafe image" }]
  };
  const listing = renderShopListingContent({
    products: [product],
    categories: [{ name: "Tools", slug: "tools" }],
    attributes: [{ name: "Material", slug: "material", values: ["Steel"] }],
    route: { page: 2 },
    pagination: { page: 2, limit: 1, total: 3 }
  }, { locale: "en", defaultLocale: "en" });
  const detail = renderProductDetailContent(product, { locale: "en", defaultLocale: "en" });

  assert.match(listing, /Starter &lt;Product&gt;/);
  assert.match(listing, /href="\/product\/starter-product"/);
  assert.match(listing, /href="\/shop\/category\/tools"/);
  assert.match(listing, /href="\/shop\?page=3" rel="next"/);
  assert.match(listing, /Page 2 of 3/);
  assert.doesNotMatch(listing, /<script>|javascript:/);
  assert.match(detail, /<dt>Material<\/dt><dd>Steel<\/dd>/);
  assert.doesNotMatch(detail, /<script>|javascript:/);

  const outOfRangeListing = renderShopListingContent({
    products: [],
    route: { page: 5 },
    pagination: { page: 5, limit: 20, total: 1 }
  }, { locale: "en", defaultLocale: "en" });
  assert.match(outOfRangeListing, /href="\/shop" rel="prev"/);

  const customizedListing = renderShopListingContent({
    products: [product],
    categories: [{ name: "Tools", slug: "tools" }],
    attributes: [{ name: "Material", slug: "material", values: ["Steel"] }],
    route: {}
  }, {
    locale: "en",
    defaultLocale: "en",
    shopSettings: {
      catalogTitle: "Workshop collection",
      catalogDescription: "Built for daily use.",
      catalogLayout: "editorial",
      cardStyle: "technical",
      showCategories: false,
      showAttributes: false,
      showSku: false,
      showStock: false
    }
  });
  const customizedDetail = renderProductDetailContent(product, {
    locale: "en",
    defaultLocale: "en",
    shopSettings: {
      detailLayout: "immersive",
      detailStyle: "premium",
      showAttributes: false,
      showSku: false,
      showStock: false
    }
  });

  assert.match(customizedListing, /shop-layout-editorial shop-card-technical/);
  assert.match(customizedListing, /Workshop collection/);
  assert.match(customizedListing, /Built for daily use\./);
  assert.doesNotMatch(customizedListing, /shop-public-filters|STARTER-1|in stock/);
  assert.match(customizedDetail, /shop-detail-layout-immersive shop-detail-style-premium/);
  assert.doesNotMatch(customizedDetail, /STARTER-1|in stock|Product attributes|<dt>Material<\/dt>/);
});
