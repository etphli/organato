import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);

test("installed schedulers run after the source checkout is removed", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "organato-launchd-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const checkout = join(home, "checkout");
  await mkdir(join(checkout, "scripts"), { recursive: true });
  for (const file of ["install-launchd.mjs", "local-scheduler.mjs"]) {
    await copyFile(
      new URL(file, import.meta.url),
      join(checkout, "scripts", file),
    );
  }

  const requests = [];
  const server = createServer((request, response) => {
    requests.push([request.method, request.url, request.headers.authorization]);
    response.writeHead(200).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  await run(process.execPath, ["scripts/install-launchd.mjs"], {
    cwd: checkout,
    env: {
      ...process.env,
      HOME: home,
      ORGANATO_API_URL: `http://127.0.0.1:${server.address().port}`,
      ORGANATO_SCHEDULER_TOKEN: "test-token",
      NO_PROXY: "127.0.0.1",
    },
  });
  await rm(checkout, { recursive: true });

  for (const job of ["digest", "hourly", "evening", "weekly"]) {
    const plist = await readFile(
      join(home, "Library", "LaunchAgents", `dev.organato.${job}.plist`),
      "utf8",
    );
    const args = plist.match(
      /<key>ProgramArguments<\/key><array>(.*?)<\/array>/s,
    )[1];
    const [node, ...argv] = Array.from(
      args.matchAll(/<string>(.*?)<\/string>/g),
      ([, value]) => value,
    );
    await run(node, argv);
    assert.deepEqual(requests.pop(), [
      "POST",
      `/api/internal/schedule?job=${job}`,
      "Bearer test-token",
    ]);
  }
});
