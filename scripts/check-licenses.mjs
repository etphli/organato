import { execFileSync } from "node:child_process";

const allowed = [
  "0BSD",
  "Apache-2.0",
  "BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
];

const raw = execFileSync("pnpm", ["licenses", "list", "--json"], {
  encoding: "utf8",
});
const report = JSON.parse(raw);
const problems = [];
for (const [license, packages] of Object.entries(report)) {
  const parts = license
    .split(/\s+OR\s+|\s+AND\s+/)
    .map((part) => part.replace(/[()]/g, ""));
  if (!parts.some((part) => allowed.includes(part))) {
    const unexpected = packages.filter(
      (pkg) =>
        !(
          license === "LGPL-3.0-or-later" &&
          pkg.name.startsWith("@img/sharp-libvips-")
        ),
    );
    // Miniflare's local test runtime dynamically links libvips. It is not shipped
    // in the Worker, web bundle, or standalone Pi package.
    if (unexpected.length)
      problems.push(
        `${license}: ${unexpected.map((pkg) => pkg.name).join(", ")}`,
      );
  }
}
if (problems.length) {
  console.error(
    `Disallowed or unknown dependency licences:\n${problems.join("\n")}`,
  );
  process.exit(1);
}
console.log(
  `Dependency licences are open-source and allow-listed (${Object.keys(report).length} licence groups).`,
);
