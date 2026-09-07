import { chromium } from "playwright";

const BASE = process.env.BASE || "http://127.0.0.1:4173";
const errors = [];
const consoleErrors = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
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

const click = async (selector, label) => {
  try {
    const element = page.locator(selector).first();
    await element.waitFor({ state: "visible", timeout: 4000 });
    await element.click();
    await page.waitForTimeout(350);
    return true;
  } catch {
    console.log(`skip: ${label}`);
    return false;
  }
};

const navItems = ["Home", "Work", "Calendar", "Todo", "Settings"];

for (let round = 1; round <= 3; round += 1) {
  for (const item of navItems) {
    await click(`text="${item}"`, `nav ${item} round ${round}`);
  }
}

await click(
  'button:has-text("Add work"), button:has-text("Create"), button:has-text("New")',
  "create form",
);
await page.keyboard.press("Escape");
await click(
  'button[aria-label*="command"], button[aria-label*="Command"]',
  "command palette",
);
await page.keyboard.press("Escape");

for (let i = 0; i < 12; i += 1) {
  await page.keyboard.press("Escape");
  await click("tbody tr", `table row ${i}`);
  await page.keyboard.press("Escape");
}

const bodyText = (await page.locator("body").innerText()).slice(0, 300);
console.log("\n=== FINAL PAGE STATE ===");
console.log(bodyText.replace(/\n+/g, " | "));
console.log(`\n=== PAGE ERRORS: ${errors.length} ===`);
errors.forEach((e, i) => console.log(`\n[${i + 1}] ${e}`));
console.log(`\n=== CONSOLE ERRORS: ${consoleErrors.length} ===`);
consoleErrors.slice(0, 10).forEach((e, i) => console.log(`\n[${i + 1}] ${e}`));

await browser.close();
process.exit(errors.length ? 1 : 0);
