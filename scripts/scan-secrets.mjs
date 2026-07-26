import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .filter(
    (file) =>
      !file.endsWith("pnpm-lock.yaml") &&
      !file.startsWith("design/concepts/") &&
      !file.endsWith(".png"),
  );

const patterns = [
  /AIza[0-9A-Za-z_-]{35}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:refresh_token|canvas_token|client_secret)\s*[:=]\s*["'][A-Za-z0-9_-]{20,}/i,
  /Bearer\s+[A-Za-z0-9._-]{30,}/,
];

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (patterns.some((pattern) => pattern.test(content))) findings.push(file);
}
if (findings.length) {
  console.error(
    `Potential committed secrets found in:\n${findings.join("\n")}`,
  );
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} text files checked).`);
