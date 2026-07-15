import assert from "node:assert/strict";
import test from "node:test";
import { injectPublicShellContent } from "../src/core/public-shell.js";

const { renderPageContent, renderPostContent } = await import("../apps/web/web/public-renderer.js");

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

test("public post markup and shell injection preserve the application shell", () => {
  const body = renderPostContent({
    title: "Published post",
    excerpt: "Post summary",
    status: "PUBLISHED",
    content: { body: "<p>Post body</p>" }
  });
  const shell = `<!doctype html><html><head><title>Site</title></head><body><a class="brand" data-brand>Old</a><article data-page></article><footer class="site-footer" data-footer></footer><script src="/app.js"></script></body></html>`;
  const rendered = injectPublicShellContent(shell, {
    brand: "CodeY $&",
    body: `${body}<p>$& stays literal</p>`,
    footer: "Copyright $1"
  });

  assert.match(rendered, /data-server-rendered="true"/);
  assert.match(rendered, /Published post/);
  assert.match(rendered, />CodeY \$&<\/a>/);
  assert.match(rendered, /\$& stays literal/);
  assert.match(rendered, />Copyright \$1<\/footer>/);
  assert.match(rendered, /<script src="\/app\.js"><\/script>/);
});
