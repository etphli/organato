/* global URL */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(
  new URL("../scripts/setup-profile.sh", import.meta.url),
);
test("shared Pi profiles render separate users, state, display authentication and ports", () => {
  const alice = execFileSync("bash", [script, "alice", "1", "--print"], {
    encoding: "utf8",
  });
  const bob = execFileSync("bash", [script, "bob", "2", "--print"], {
    encoding: "utf8",
  });
  for (const [output, name, display, port] of [
    [alice, "alice", 100, 5901],
    [bob, "bob", 101, 5902],
  ]) {
    assert.ok(output.includes(`User=organato-${name}`));
    assert.ok(
      output.includes(
        `Environment=XAUTHORITY=/var/lib/organato-canvas-profile-${name}/Xauthority`,
      ),
    );
    assert.ok(output.includes(`Xvfb :${display}`));
    assert.ok(output.includes(`-rfbport ${port}`));
    assert.ok(
      output.includes(
        `Requires=organato-canvas-profile-${name}-x11vnc.service`,
      ),
    );
    assert.equal(output.includes("User=organato-canvas\n"), false);
    assert.equal(output.includes("/var/lib/organato-canvas-connector"), false);
    assert.equal(output.includes(" -ac"), false);
  }
  assert.equal(alice.includes("profile-bob"), false);
  assert.equal(bob.includes("profile-alice"), false);
  assert.throws(() =>
    execFileSync("bash", [script, "../alice", "1", "--print"], {
      stdio: "pipe",
    }),
  );
});

test("managed browser policy uses exact hosts and blocks internal browser pages", async () => {
  const { readFile } = await import("node:fs/promises");
  const policy = JSON.parse(
    await readFile(
      new URL(
        "../policies/managed/organato-canvas-connector.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.ok(policy.URLBlocklist.includes("*"));
  assert.ok(policy.URLBlocklist.includes("chrome://*"));
  assert.ok(policy.URLAllowlist.includes("https://.emanuel.instructure.com"));
  assert.ok(
    policy.URLAllowlist.every(
      (value) => value.startsWith("https://.") && !value.includes("*"),
    ),
  );
});
