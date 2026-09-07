import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { URL } from "node:url";

const distDirectory = new URL("../dist/", import.meta.url);
const assetsDirectory = new URL("./assets/", distDirectory);
const indexHtml = await readFile(
  new URL("./index.html", distDirectory),
  "utf8",
);
const buildId = createHash("sha256")
  .update(indexHtml)
  .digest("hex")
  .slice(0, 12);
const assetFiles = (await readdir(assetsDirectory))
  .filter((file) => /\.(?:css|js)$/.test(file))
  .toSorted();
const precache = [
  "/",
  "/boot.css",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-maskable.svg",
  ...assetFiles.map((file) => `/assets/${file}`),
];
const serviceWorkerPath = new URL("./sw.js", distDirectory);
const serviceWorker = await readFile(serviceWorkerPath, "utf8");
const stamped = serviceWorker
  .replace(
    /const cacheName = "organato-shell-[^"]+";/,
    `const cacheName = "organato-shell-${buildId}";`,
  )
  .replace(
    /const shell = \[[^\n]*\];/,
    `const shell = ${JSON.stringify(precache)};`,
  );

if (
  !stamped.includes(`organato-shell-${buildId}`) ||
  !stamped.includes(`/assets/${assetFiles[0] ?? "__missing_asset__"}`)
) {
  throw new Error("Service worker build fields could not be stamped.");
}

await writeFile(serviceWorkerPath, stamped);
