# Front-of-site Renderer

This is a dependency-free CMS renderer and inline editing shell for the copied client site.

Open `index.html` from a static server and point it to the API:

```text
http://localhost:4000/api/v1
```

Use `?slug=home` to choose a page. Add `&edit=1` to show the editor connection bar. If a JWT access token is saved there, the page loads in preview mode and editable content blocks show inline edit controls.

The shell uses these CMS APIs:

- `GET /cms/pages/:slug`
- `PATCH /cms/pages/:slug/blocks/:blockKey`
- `POST /cms/pages/:slug/sections`
- `POST /cms/pages/:slug/publish`
- `GET /cms/menus/main`

This folder is intentionally plain HTML/CSS/JS so generated projects can replace it with Next.js, Astro, or a custom theme without changing the backend CMS contract.
