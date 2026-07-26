import { execFileSync } from "node:child_process";

const allowed = [
  "0BSD",
  "Apache-2.0",
  "BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
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
    problems.push(
      `${license}: ${Object.keys(packages).slice(0, 8).join(", ")}`,
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
