import { runCommand } from "./test-runtime.mjs";

for (const profile of ["mobile", "desktop"]) {
  console.log(`Running ${profile} Lighthouse audit...`);
  await runCommand("pnpm", ["exec", "lhci", "autorun", "--config=lighthouserc.cjs"], {
    ...process.env,
    LIGHTHOUSE_PROFILE: profile
  });
}
