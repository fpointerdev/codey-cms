import assert from "node:assert/strict";
import test from "node:test";
import { canonicalPublicRedirectTarget } from "../src/core/public-routing.js";
import { CmsService } from "../src/modules/cms/cms.service.js";

test("public canonical routing removes trailing slashes and preserves queries", () => {
  assert.equal(canonicalPublicRedirectTarget("/about/?campaign=summer", "/about/"), "/about?campaign=summer");
  assert.equal(canonicalPublicRedirectTarget("/", "/"), null);
  assert.equal(canonicalPublicRedirectTarget("/about", "/about"), null);
});

test("CMS redirects normalize paths and preserve the incoming query string", async () => {
  const service = new CmsService({
    cmsRedirect: {
      findFirst: async (query: { where: { sourcePath: string; active: boolean } }) => {
        assert.deepEqual(query.where, { sourcePath: "/old-page", active: true });
        return {
          id: "redirect-1",
          sourcePath: "/old-page",
          targetPath: "/new-page?from=redirect",
          statusCode: 301,
          preserveQuery: true,
          active: true
        };
      }
    }
  } as never);

  const redirect = await service.resolveRedirect("/old-page/?campaign=summer");
  assert.equal(redirect?.targetPath, "/new-page?from=redirect&campaign=summer");
  assert.equal(redirect?.statusCode, 301);
});

test("CMS redirects merge preserved queries before URL fragments", async () => {
  const service = new CmsService({
    cmsRedirect: {
      findFirst: async () => ({
        id: "redirect-1",
        sourcePath: "/old-page",
        targetPath: "/new-page?from=redirect#details",
        statusCode: 302,
        preserveQuery: true,
        active: true
      })
    }
  } as never);

  const redirect = await service.resolveRedirect("/old-page?campaign=summer");
  assert.equal(redirect?.targetPath, "/new-page?from=redirect&campaign=summer#details");
});

test("CMS redirects reject direct loops before writing to the database", async () => {
  const service = new CmsService({} as never);

  await assert.rejects(
    service.createRedirect({
      sourcePath: "/same-page/",
      targetPath: "/same-page?again=true",
      statusCode: 301,
      preserveQuery: true,
      active: true
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "redirect_loop");
      return true;
    }
  );
});

test("CMS redirects reject protocol-relative targets and indirect loops", async () => {
  const service = new CmsService({
    cmsRedirect: {
      findFirst: async ({ where }: { where: { sourcePath: string } }) => where.sourcePath === "/middle"
        ? { targetPath: "/start" }
        : null,
      create: async () => {
        throw new Error("Redirect should not be created.");
      }
    }
  } as never);

  await assert.rejects(
    service.createRedirect({
      sourcePath: "/start",
      targetPath: "//external.example.com/path",
      statusCode: 301,
      preserveQuery: true,
      active: true
    }),
    (error: unknown) => (error as { code?: string }).code === "invalid_redirect_target"
  );
  await assert.rejects(
    service.createRedirect({
      sourcePath: "/start",
      targetPath: "/middle",
      statusCode: 301,
      preserveQuery: true,
      active: true
    }),
    (error: unknown) => (error as { code?: string }).code === "redirect_loop"
  );
});
