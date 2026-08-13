import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("editor modals freeze and restore the page background", async () => {
  const [modalSource, modalStyles] = await Promise.all([
    readFile("apps/web/web/modal.js", "utf8"),
    readFile("apps/web/styles/tables-modal-responsive.css", "utf8")
  ]);

  assert.match(modalSource, /freezePageForModal\(modal\)/);
  assert.match(modalSource, /restorePageAfterModal\(modal\)/);
  assert.match(modalSource, /window\.scrollTo\(x, y\)/);
  assert.match(modalSource, /element\.inert = Boolean\(activeModal && element !== activeModal\)/);
  assert.match(modalSource, /event\.key !== "Tab"/);
  assert.match(modalStyles, /html\.modal-open,[\s\S]*body\.modal-open[\s\S]*overflow: hidden/);
});
