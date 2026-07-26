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

const response = await fetch(
  `${apiUrl.replace(/\/$/, "")}/api/internal/schedule?job=${job}`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  },
);
if (!response.ok) {
  throw new Error(
    `Organato ${job} scheduler failed safely (${response.status}).`,
  );
}
console.log(
  `Organato ${job} scheduler completed at ${new Date().toISOString()}.`,
);
