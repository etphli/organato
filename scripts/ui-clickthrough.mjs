// Manual smoke script: click through the PWA and fail on page errors.
// Run: BASE=http://127.0.0.1:4173 node scripts/ui-clickthrough.mjs
// Requires a Chromium binary: set CHROMIUM_EXECUTABLE_PATH, or install the
// Playwright browser (`npx playwright-core install chromium`) for the
// playwright-core version pinned in the workspace root.
import { chromium } from "playwright-core";

const BASE = process.env.BASE || "http://127.0.0.1:4173";
const errors = [];
const consoleErrors = [];
const failures = [];

function resolveExecutablePath() {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    return process.env.CHROMIUM_EXECUTABLE_PATH;
  }
  return undefined;
}

const browser = await chromium.launch({
  headless: true,
  ...(resolveExecutablePath()
    ? { executablePath: resolveExecutablePath() }
    : {}),
});
const context = await browser.newContext();
const page = await context.newPage();
page.on("pageerror", (error) => {
  errors.push(
    `${error.name}: ${error.message}\n${(error.stack || "").split("\n").slice(0, 6).join("\n")}`,
  );
});
page.on("console", (message) => {
  if (message.type() === "error")
    consoleErrors.push(message.text().slice(0, 400));
});

await page.goto(BASE, { waitUntil: "networkidle" });

const clickOptional = async (selector, label) => {
  try {
    const element = page.locator(selector).first();
    await element.waitFor({ state: "visible", timeout: 4000 });
    await element.click();
    await page.waitForTimeout(350);
    return true;
  } catch {
    console.log(`skip (optional): ${label}`);
    return false;
  }
};

// Navigation labels must exist: a missing nav item is a regression, not a
// skip. Labels mirror AppShell navigation.
const navItems = ["Home", "Assignments", "Checkpoints", "Calendar", "Todo"];

for (let round = 1; round <= 3; round += 1) {
  for (const item of navItems) {
    try {
      const element = page
        .locator(
          `nav a:has-text("${item}"), [role="navigation"] a:has-text("${item}")`,
        )
        .first();
      await element.waitFor({ state: "visible", timeout: 5000 });
      await element.click();
      await page.waitForTimeout(350);
    } catch {
      failures.push(`missing nav item "${item}" (round ${round})`);
    }
  }
}

await clickOptional(
  'button:has-text("Add work"), button:has-text("Create"), button:has-text("New")',
  "create form",
);
await page.keyboard.press("Escape");
await clickOptional(
  'button[aria-label*="command"], button[aria-label*="Command"]',
  "command palette",
);
await page.keyboard.press("Escape");

for (let i = 0; i < 12; i += 1) {
  await page.keyboard.press("Escape");
  await clickOptional("tbody tr", `table row ${i}`);
  await page.keyboard.press("Escape");
}

const bodyText = (await page.locator("body").innerText()).slice(0, 300);
console.log("\n=== FINAL PAGE STATE ===");
console.log(bodyText.replace(/\n+/g, " | "));
console.log(`\n=== MISSING NAV: ${failures.length} ===`);
failures.forEach((e, i) => console.log(`\n[${i + 1}] ${e}`));
console.log(`\n=== PAGE ERRORS: ${errors.length} ===`);
errors.forEach((e, i) => console.log(`\n[${i + 1}] ${e}`));
console.log(`\n=== CONSOLE ERRORS: ${consoleErrors.length} ===`);
consoleErrors.slice(0, 10).forEach((e, i) => console.log(`\n[${i + 1}] ${e}`));

await browser.close();
const failed = errors.length + failures.length;
process.exit(failed ? 1 : 0);
