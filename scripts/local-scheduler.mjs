import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

function loadEnvFile(path) {
  if (!path) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2];
  }
}

const args = process.argv.slice(2);
const envIndex = args.indexOf("--env-file");
if (envIndex >= 0) loadEnvFile(args[envIndex + 1]);
const job = args.find((value) => value === "hourly" || value === "digest");
if (!job)
  throw new Error("Usage: local-scheduler.mjs hourly|digest [--env-file path]");

const apiUrl = process.env.ORGANATO_API_URL;
const token = process.env.ORGANATO_SCHEDULER_TOKEN;
if (!apiUrl || !token) {
  throw new Error(
    "ORGANATO_API_URL and ORGANATO_SCHEDULER_TOKEN are required.",
  );
}

const endpoint = `${apiUrl.replace(/\/$/, "")}/api/internal/schedule?job=${job}`;

function curlConfig() {
  return [
    `url = ${JSON.stringify(endpoint)}`,
    "request = POST",
    "silent",
    "show-error",
    "fail",
    "retry = 3",
    "retry-delay = 2",
    "connect-timeout = 15",
    "max-time = 120",
    `header = ${JSON.stringify(`Authorization: Bearer ${token}`)}`,
    `header = ${JSON.stringify("Content-Type: application/json")}`,
    `data = ${JSON.stringify("{}")}`,
  ].join("\n");
}

function runCurl() {
  const executable = process.platform === "darwin" ? "/usr/bin/curl" : "curl";
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--config", "-"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        Object.assign(
          new Error(
            errorOutput.trim() ||
              `Organato ${job} scheduler failed safely (${code ?? "unknown"}).`,
          ),
          { code },
        ),
      );
    });
    child.stdin.end(curlConfig());
  });
}

async function runFetch() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(
      `Organato ${job} scheduler failed safely (${response.status}).`,
    );
  }
}

try {
  await runCurl();
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  await runFetch();
}
console.log(
  `Organato ${job} scheduler completed at ${new Date().toISOString()}.`,
);
