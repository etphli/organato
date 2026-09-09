import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const apiUrl = process.env.ORGANATO_API_URL;
const token = process.env.ORGANATO_SCHEDULER_TOKEN;
if (!apiUrl || !token) {
  throw new Error(
    "Set ORGANATO_API_URL and ORGANATO_SCHEDULER_TOKEN before installing the fallback.",
  );
}

const configDir = resolve(homedir(), ".config", "organato");
const launchAgents = resolve(homedir(), "Library", "LaunchAgents");
mkdirSync(configDir, { recursive: true, mode: 0o700 });
mkdirSync(launchAgents, { recursive: true });
const envPath = resolve(configDir, "scheduler.env");
writeFileSync(
  envPath,
  `ORGANATO_API_URL=${apiUrl}\nORGANATO_SCHEDULER_TOKEN=${token}\n`,
  { mode: 0o600 },
);
chmodSync(envPath, 0o600);

const script = resolve(process.cwd(), "scripts", "local-scheduler.mjs");
function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plist(label, job, schedule) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${escapeXml(process.execPath)}</string><string>${escapeXml(script)}</string>
    <string>${job}</string><string>--env-file</string><string>${escapeXml(envPath)}</string>
  </array>
  ${schedule}
  <key>StandardOutPath</key><string>${configDir}/${job}.log</string>
  <key>StandardErrorPath</key><string>${configDir}/${job}.error.log</string>
</dict></plist>`;
}

const hourlyPath = resolve(launchAgents, "dev.organato.hourly.plist");
const digestPath = resolve(launchAgents, "dev.organato.digest.plist");
const eveningPath = resolve(launchAgents, "dev.organato.evening.plist");
const weeklyPath = resolve(launchAgents, "dev.organato.weekly.plist");
writeFileSync(
  hourlyPath,
  plist(
    "dev.organato.hourly",
    "hourly",
    "<key>StartInterval</key><integer>3600</integer>",
  ),
);
writeFileSync(
  digestPath,
  plist(
    "dev.organato.digest",
    "digest",
    "<key>StartCalendarInterval</key><dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>",
  ),
);
writeFileSync(
  eveningPath,
  plist(
    "dev.organato.evening",
    "evening",
    "<key>StartCalendarInterval</key><dict><key>Hour</key><integer>20</integer><key>Minute</key><integer>0</integer></dict>",
  ),
);
writeFileSync(
  weeklyPath,
  plist(
    "dev.organato.weekly",
    "weekly",
    "<key>StartCalendarInterval</key><dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>",
  ),
);
console.log(`Created ${hourlyPath}`);
console.log(`Created ${digestPath}`);
console.log(`Created ${eveningPath}`);
console.log(`Created ${weeklyPath}`);
console.log(
  "Load them with launchctl bootstrap gui/$(id -u) <path> after reviewing the files.",
);
