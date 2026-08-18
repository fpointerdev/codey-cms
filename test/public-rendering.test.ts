import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { injectPublicShellContent } from "../src/core/public-shell.js";
import {
  customCodeContentSecurityPolicy,
  renderCustomCodeDocument
} from "../src/modules/cms/custom-code.js";

const {
  renderPageContent,
  renderFooter,
  renderBuyerAccountContent,
  renderMenuItems,
  renderPostContent,
  renderProductDetailContent,
  renderShopListingContent,
  withPublicRenderContext
} = await import("../apps/web/web/public-renderer.js");

test("buyer account shell is useful before JavaScript loads", () => {
  const html = renderBuyerAccountContent({ locale: "en", defaultLocale: "en" });

  assert.match(html, /data-commerce-account-root/);
  assert.match(html, /data-buyer-orders/);
  assert.match(html, /data-buyer-claim-form/);
  assert.match(html, /data-buyer-forget/);
  assert.match(html, /Private lookup token/i);
  assert.match(html, /href="\/shop"/);
  assert.doesNotMatch(html, /customerEmail|lookupTokenHash/);
});

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

test("custom code runs only in an isolated public frame", () => {
  const page = {
    title: "Custom widget",
    content: {},
    sections: [{
      id: "custom-section",
      key: "custom-section",
      settings: { elementId: "custom-code" },
      blocks: [{
        id: "block-custom-widget",
        key: "custom-widget",
        type: "EMBED",
        label: "Availability widget",
        value: {
          html: '<p id="status">Loading</p>',
          css: "#status { color: green; }",
          javascript: 'document.querySelector("#status").textContent = "Ready";',
          libraries: ["https://cdn.example.com/widget.js"],
          height: 420
        },
        settings: { elementId: "custom-code" },
        editable: true
      }]
    }]
  };

  const html = renderPageContent(page, { canEdit: false });
  assert.match(html, /data-custom-code-frame/);
  assert.match(html, /sandbox="allow-scripts allow-forms"/);
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.match(html, /--custom-code-height:420px/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /src="\/api\/v1\/cms\/custom-code\/block-custom-widget"/);

  const frameDocument = renderCustomCodeDocument(page.sections[0].blocks[0].value, {
    title: "Availability widget",
    locale: "en"
  });
  assert.match(customCodeContentSecurityPolicy, /^sandbox allow-scripts allow-forms/);
  assert.match(customCodeContentSecurityPolicy, /script-src 'unsafe-inline' https:/);
  assert.match(frameDocument, /https:\/\/cdn\.example\.com\/widget\.js/);
  assert.match(frameDocument, /document\.querySelector/);

  const editorHtml = renderPageContent(page, { canEdit: true });
  assert.match(editorHtml, /Custom code preview paused/);
  assert.doesNotMatch(editorHtml, /data-custom-code-frame/);
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

test("v1 builder elements server-render semantic process, comparison, and video markup", () => {
  const html = renderPageContent({
    title: "Service details",
    content: {},
    sections: [{
      id: "details",
      key: "details",
      settings: {},
      blocks: [
        {
          key: "process",
          type: "CUSTOM",
          value: {
            variant: "process-steps",
            title: "How it works",
            items: [
              { title: "Plan", body: "Agree on scope." },
              { title: "Launch", body: "Publish and verify." }
            ],
            display: { columns: 2, showNumbers: true, surface: "soft" }
          },
          settings: { elementId: "process-steps" },
          editable: true
        },
        {
          key: "comparison",
          type: "CUSTOM",
          value: {
            variant: "comparison-table",
            title: "Compare support",
            firstColumnTitle: "Standard",
            secondColumnTitle: "Priority",
            items: [{ title: "Response", firstValue: "2 days", secondValue: "4 hours" }]
          },
          settings: { elementId: "comparison-table" },
          editable: true
        },
        {
          key: "video",
          type: "CUSTOM",
          value: {
            variant: "video",
            title: "Product tour",
            body: "A short walkthrough.",
            url: "/uploads/product-tour.mp4",
            posterUrl: "/uploads/product-tour.webp",
            display: { presentation: "hero", ratio: "16 / 9", preload: "none", loop: false, playback: "hover-focus" }
          },
          settings: { elementId: "video" },
          editable: true
        }
      ]
    }]
  });

  assert.match(html, /<ol class="structured-process/);
  assert.match(html, /<li class="structured-process-step">/);
  assert.match(html, /<table>/);
  assert.match(html, /<th scope="row">Response<\/th><td>2 days<\/td><td>4 hours<\/td>/);
  assert.match(html, /<video src="\/uploads\/product-tour\.mp4" controls playsinline preload="none"/);
  assert.match(html, /aria-label="Product tour"/);
  assert.match(html, /data-video-playback="hover-focus"/);
  assert.match(html, /poster="\/uploads\/product-tour\.webp" muted/);
  assert.match(html, /structured-block-video structured-align-left structured-density-comfortable structured-surface-outline structured-presentation-hero/);
  assert.doesNotMatch(html, /<iframe/);
});

test("interactive image placements render bounded accessible product links", () => {
  const html = renderPageContent({
    title: "Showroom",
    content: {},
    sections: [{
      id: "scene",
      key: "scene",
      settings: { elementId: "image-hotspots" },
      blocks: [{
        key: "scene-content",
        type: "CUSTOM",
        value: {
          variant: "image-hotspots",
          title: "Explore the room",
          image: { url: "/uploads/showroom.webp", alt: "Showroom with display shelves" },
          hotspots: [
            {
              title: "Featured product",
              body: "View the product details.",
              x: 42,
              y: 58,
              width: 9,
              productSlug: "featured-product",
              image: { url: "/uploads/featured-product.webp", alt: "Featured product" }
            },
            { title: "Unsafe", x: 50, y: 50, url: "javascript:alert(1)" },
            { title: "Bounded", x: 120, y: -10, url: "/details" }
          ],
          display: { ratio: "16 / 10" }
        },
        settings: { elementId: "image-hotspots" },
        editable: true
      }]
    }]
  });

  assert.match(html, /class="structured-hotspot-scene"/);
  assert.match(html, /aria-label="Interactive image points"/);
  assert.match(html, /href="\/product\/featured-product" aria-label="Featured product"/);
  assert.match(html, /class="hotspot-overlay-image"/);
  assert.match(html, /--hotspot-x:100%;--hotspot-y:0%/);
  assert.doesNotMatch(html, /javascript:|aria-label="Unsafe"/);
});

test("image comparisons and product showcases render complete server-side content", () => {
  const html = renderPageContent({
    title: "Results and products",
    content: { layout: "full-width", hideTitle: true },
    sections: [{
      id: "showcase",
      key: "showcase",
      settings: {},
      blocks: [
        {
          key: "comparison",
          type: "CUSTOM",
          settings: { elementId: "image-comparison" },
          editable: true,
          value: {
            variant: "image-comparison",
            title: "Before and after",
            items: [
              { title: "Before", image: { url: "/uploads/before.webp", alt: "Room before renovation" } },
              { title: "After", image: { url: "/uploads/after.webp", alt: "Room after renovation" } }
            ],
            display: { presentation: "split" }
          }
        },
        {
          key: "products",
          type: "PRODUCT_LIST",
          settings: { elementId: "product-showcase" },
          editable: true,
          value: {
            title: "Featured product",
            productSlugs: ["studio-chair"],
            layout: "spotlight",
            products: [{
              id: "product-1",
              slug: "studio-chair",
              name: "Studio Chair",
              description: "Built for focused work.",
              priceCents: 25000,
              currency: "EUR",
              stockQuantity: 4,
              availableStock: 4,
              metadata: {},
              images: []
            }]
          }
        }
      ]
    }]
  }, {
    shopSettings: { showSku: false, showStock: true, showDescriptions: true }
  });

  assert.match(html, /image-comparison-split/);
  assert.match(html, /alt="Room before renovation"/);
  assert.match(html, /alt="Room after renovation"/);
  assert.match(html, /product-list-layout-spotlight/);
  assert.match(html, /Studio Chair/);
  assert.match(html, /Built for focused work\./);
  assert.match(html, /data-commerce-add data-product-id="product-1"/);
});

test("expanded builder elements server-render semantic timelines, lists, locations, and quotes", () => {
  const html = renderPageContent({
    title: "Company information",
    content: {},
    sections: [{
      id: "expanded-elements",
      key: "expanded-elements",
      settings: {},
      blocks: [
        {
          key: "timeline",
          type: "CUSTOM",
          value: {
            title: "Milestones",
            items: [{ title: "Opened", body: "The first office opened.", label: "2020" }]
          },
          settings: { elementId: "timeline" },
          editable: true
        },
        {
          key: "checklist",
          type: "CUSTOM",
          value: {
            title: "Included",
            items: [{ title: "Planning", body: "A documented scope." }],
            display: { columns: 2 }
          },
          settings: { elementId: "checklist" },
          editable: true
        },
        {
          key: "resources",
          type: "CUSTOM",
          value: {
            title: "Resources",
            items: [{ title: "Service guide", body: "Read the details.", label: "Guide", url: "/service-guide" }]
          },
          settings: { elementId: "resource-list" },
          editable: true
        },
        {
          key: "locations",
          type: "CUSTOM",
          value: {
            title: "Locations",
            items: [{ title: "Main office", body: "1 Main Street", label: "Weekdays", url: "/contact" }],
            display: { columns: 2 }
          },
          settings: { elementId: "location-cards" },
          editable: true
        },
        {
          key: "quote",
          type: "CUSTOM",
          value: {
            title: "Customer perspective",
            body: "The work stayed clear from start to finish.",
            attribution: "Alex, customer"
          },
          settings: { elementId: "quote-highlight" },
          editable: true
        },
        {
          key: "bento",
          type: "CUSTOM",
          value: {
            title: "Capabilities",
            items: [{ title: "Fast delivery", body: "A clear path to launch.", featured: true }],
            display: { presentation: "spotlight", columns: 4 }
          },
          settings: { elementId: "bento-grid" },
          editable: true
        },
        {
          key: "navigation",
          type: "CUSTOM",
          value: {
            title: "Explore",
            items: [{ title: "Services", body: "See what we offer.", url: "/services" }],
            display: { presentation: "compact", columns: 3 }
          },
          settings: { elementId: "navigation-cards" },
          editable: true
        }
      ]
    }]
  });

  assert.match(html, /<ol class="structured-timeline">/);
  assert.match(html, /<ul class="structured-checklist"/);
  assert.match(html, /<a class="structured-resource-link" href="\/service-guide">/);
  assert.match(html, /<address class="structured-location">/);
  assert.match(html, /<figure class="structured-block structured-quote-highlight/);
  assert.match(html, /<blockquote><p>The work stayed clear from start to finish\.<\/p><\/blockquote>/);
  assert.match(html, /<figcaption>Alex, customer<\/figcaption>/);
  assert.match(html, /structured-block-bento-grid/);
  assert.match(html, /structured-presentation-spotlight/);
  assert.match(html, /structured-card-navigation-cards/);
  assert.match(html, /structured-presentation-compact/);
  assert.match(html, /href="\/services"/);
});

test("registered element ids preserve collection aliases and presentation defaults", () => {
  const html = renderPageContent({
    title: "Portable content",
    content: {},
    sections: [{
      id: "portable-elements",
      key: "portable-elements",
      settings: {},
      blocks: [
        {
          key: "history",
          type: "CUSTOM",
          value: { title: "History", milestones: [{ title: "Launch", body: "The first release." }] },
          settings: { elementId: "timeline" },
          editable: true
        },
        {
          key: "benefits",
          type: "CUSTOM",
          value: { title: "Benefits", points: [{ title: "Simple", body: "Easy to manage." }] },
          settings: { elementId: "checklist" },
          editable: true
        },
        {
          key: "resources",
          type: "CUSTOM",
          value: { title: "Resources", resources: [{ title: "Guide", url: "/guide" }] },
          settings: { elementId: "resource-list" },
          editable: true
        },
        {
          key: "locations",
          type: "CUSTOM",
          value: { title: "Locations", locations: [{ title: "Studio", body: "Main street" }] },
          settings: { elementId: "location-cards" },
          editable: true
        }
      ]
    }]
  });

  assert.match(html, /structured-block-timeline[^\"]*structured-presentation-line/);
  assert.match(html, /The first release\./);
  assert.match(html, /Easy to manage\./);
  assert.match(html, /structured-block-resource-list[^\"]*structured-presentation-rows/);
  assert.match(html, /href="\/guide"/);
  assert.match(html, /<address class="structured-location">/);
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

test("premium section backgrounds, borders, and device visibility server-render safely", () => {
  const html = renderPageContent({
    title: "Designed page",
    content: { hideTitle: true },
    sections: [{
      id: "premium-section",
      key: "premium-section",
      settings: {
        style: {
          backgroundColor: "#172145",
          accentColor: "#ffcc66",
          radius: 24,
          borderWidth: 2,
          borderColor: "#ffffff",
          shadow: "soft"
        },
        background: {
          mode: "image",
          imageAssetId: "asset-1",
          imageUrl: "/uploads/premium-background.webp",
          width: 1800,
          height: 1200,
          style: "cover",
          position: "top-right",
          overlayColor: "#101820",
          overlayOpacity: 0.45
        },
        visibility: { desktop: true, tablet: true, mobile: false }
      },
      blocks: [{
        key: "copy",
        type: "RICH_TEXT",
        value: "<p>Readable premium content.</p>",
        settings: {},
        editable: true
      }]
    }]
  });

  assert.match(html, /has-section-background-image/);
  assert.match(html, /section-has-border/);
  assert.match(html, /section-hidden-mobile/);
  assert.match(html, /--section-border-width:2px/);
  assert.match(html, /--section-background-position:right top/);
  assert.match(html, /--section-background-overlay-opacity:0\.45/);
  assert.match(html, /class="section-design-background"/);
  assert.match(html, /src="\/uploads\/premium-background\.webp"/);
  assert.match(html, /width="1800" height="1200"/);
  assert.match(html, /fetchpriority="high"/);
  assert.match(html, /class="section-design-overlay"/);
});

test("unsafe section background URLs never reach public markup", () => {
  const html = renderPageContent({
    title: "Safe page",
    content: { hideTitle: true },
    sections: [{
      id: "unsafe-background",
      key: "unsafe-background",
      settings: {
        background: { mode: "image", imageUrl: "javascript:alert(1)" }
      },
      blocks: []
    }]
  });

  assert.doesNotMatch(html, /section-design-background/);
  assert.doesNotMatch(html, /javascript:/);
});

test("desktop-hidden section images do not take the high-priority image slot", () => {
  const html = renderPageContent({
    title: "Priority page",
    content: { hideTitle: true },
    sections: [
      {
        id: "mobile-background",
        key: "mobile-background",
        settings: {
          background: {
            mode: "image",
            imageUrl: "/uploads/mobile-only.webp",
            width: 1200,
            height: 800
          },
          visibility: { desktop: false, tablet: true, mobile: true }
        },
        blocks: []
      },
      {
        id: "desktop-background",
        key: "desktop-background",
        settings: {
          background: {
            mode: "image",
            imageUrl: "/uploads/desktop.webp",
            width: 1600,
            height: 900
          }
        },
        blocks: []
      }
    ]
  });

  assert.match(html, /src="\/uploads\/mobile-only\.webp"[^>]+loading="lazy"/);
  assert.match(html, /src="\/uploads\/desktop\.webp"[^>]+loading="eager"[^>]+fetchpriority="high"/);
});

test("backgrounds without intrinsic dimensions use decorative CSS instead of layout-unstable images", () => {
  const html = renderPageContent({
    title: "Stable background",
    content: { hideTitle: true },
    sections: [{
      id: "external-background",
      key: "external-background",
      settings: {
        background: {
          mode: "image",
          imageUrl: "https://cdn.example.com/background.webp",
          style: "contain"
        }
      },
      blocks: []
    }]
  });

  assert.match(html, /section-design-background-css/);
  assert.match(html, /background-image:url\(&quot;https:\/\/cdn\.example\.com\/background\.webp&quot;\)/);
  assert.doesNotMatch(html, /<img[^>]+background\.webp/);
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
  assert.match(listing, /data-commerce-root/);
  assert.match(listing, /data-commerce-add/);
  assert.doesNotMatch(listing, /<script>|javascript:/);
  assert.match(detail, /<dt>Material<\/dt><dd>Steel<\/dd>/);
  assert.match(detail, /data-commerce-product-form/);
  assert.match(detail, /data-commerce-cart-toggle/);
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

test("shop catalog hero is server-rendered only on the main listing", () => {
  const options = {
    locale: "en",
    defaultLocale: "en",
    shopSettings: {
      catalogTitle: "Summer collection",
      catalogDescription: "A focused seasonal edit.",
      catalogHero: {
        enabled: true,
        mediaType: "VIDEO",
        mediaUrl: "/uploads/summer.mp4",
        posterUrl: "/uploads/summer.webp",
        altText: "",
        playback: "hover-focus",
        loop: true
      }
    }
  };
  const mainListing = renderShopListingContent({ products: [], route: { page: 1 } }, options);
  const pagedListing = renderShopListingContent({ products: [], route: { page: 2 } }, options);

  assert.match(mainListing, /class="shop-catalog-hero" data-video-frame/);
  assert.match(mainListing, /src="\/uploads\/summer\.mp4"/);
  assert.match(mainListing, /poster="\/uploads\/summer\.webp"/);
  assert.match(mainListing, /data-video-playback="hover-focus"/);
  assert.match(mainListing, / muted loop/);
  assert.match(mainListing, /<h1>Summer collection<\/h1>/);
  assert.doesNotMatch(pagedListing, /shop-catalog-hero/);
});

test("shop catalog hero images include media-library dimensions", () => {
  const listing = renderShopListingContent({ products: [], route: { page: 1 } }, {
    locale: "en",
    defaultLocale: "en",
    shopSettings: {
      catalogTitle: "Summer collection",
      catalogHero: {
        enabled: true,
        mediaType: "IMAGE",
        mediaUrl: "/uploads/summer.webp",
        altText: "Summer collection display"
      }
    },
    catalogHeroMedia: {
      url: "/uploads/summer.webp",
      width: 1600,
      height: 900,
      variants: []
    }
  });

  assert.match(listing, /src="\/uploads\/summer\.webp"/);
  assert.match(listing, /alt="Summer collection display"/);
  assert.match(listing, /width="1600" height="900"/);
});

test("shop rendering supports quote products and sellable variants", () => {
  const quoteProduct = {
    id: "quote-product",
    slug: "custom-installation",
    name: "Custom installation",
    description: "Designed for your site.",
    priceCents: 0,
    currency: "EUR",
    stockQuantity: 0,
    metadata: { purchaseMode: "quote" },
    images: []
  };
  const variantProduct = {
    id: "variant-product",
    slug: "workbench",
    name: "Workbench",
    description: "Built to order.",
    priceCents: 50000,
    currency: "EUR",
    stockQuantity: 0,
    metadata: { purchaseMode: "buy" },
    images: [],
    variants: [
      { id: "small", name: "Small", priceCents: 50000, stockQuantity: 2, active: true },
      { id: "large", name: "Large", priceCents: 70000, stockQuantity: 3, active: true }
    ]
  };

  const renderOptions = { locale: "en", defaultLocale: "en" };
  const listing = renderShopListingContent({ products: [quoteProduct, variantProduct] }, renderOptions);
  const quoteDetail = renderProductDetailContent(quoteProduct, renderOptions);
  const variantDetail = renderProductDetailContent(variantProduct, renderOptions);

  assert.match(listing, /data-commerce-quote/);
  assert.match(listing, /Choose options/);
  assert.match(quoteDetail, /data-purchase-mode="quote"/);
  assert.match(quoteDetail, /Request a quote/);
  assert.match(quoteDetail, /Tailored pricing/);
  assert.doesNotMatch(quoteDetail, /0 in stock|€0\.00/);
  assert.match(variantDetail, /name="variantId"/);
  assert.match(variantDetail, /data-stock="3"/);
  assert.match(variantDetail, />5 in stock</);
});
