import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const apiUrl = process.env.ORGANATO_API_URL?.replace(/\/$/, "");
if (!apiUrl) {
  throw new Error("ORGANATO_API_URL is required.");
}

const template = JSON.parse(
  await readFile(
    new URL("../packages/email/src/template.json", import.meta.url),
    "utf8",
  ),
);
function readHealthWithCurl() {
  const executable = process.platform === "darwin" ? "/usr/bin/curl" : "curl";
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "--fail",
        "--silent",
        "--show-error",
        "--header",
        "Cache-Control: no-cache",
        `${apiUrl}/health`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let errorOutput = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(JSON.parse(output));
        return;
      }
      reject(
        new Error(
          errorOutput.trim() || `Production health check failed (${code}).`,
        ),
      );
    });
  });
}

const health = await readHealthWithCurl();
if (health.emailTemplateVersion !== template.version) {
  throw new Error(
    `Production email template is ${JSON.stringify(health.emailTemplateVersion ?? null)}; expected ${JSON.stringify(template.version)}.`,
  );
}

console.log(`Production email template ${template.version} is active.`);
