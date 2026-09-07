import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "apps/canvas-connector");
const destination = join(root, "apps/web/public/downloads");
const temporary = await mkdtemp(join(tmpdir(), "organato-pi-package-"));
const folder = "organato-canvas-connector";
async function ensureOrdinaryFiles(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink())
    throw new Error("Connector packages cannot include symbolic links.");
  if (stat.isDirectory())
    for (const entry of await readdir(path))
      await ensureOrdinaryFiles(join(path, entry));
  else if (!stat.isFile())
    throw new Error("Connector packages can only contain source files.");
}
try {
  const target = join(temporary, folder);
  await mkdir(target);
  for (const entry of [
    "package.json",
    "package-lock.json",
    "src",
    "bin",
    "scripts",
    "systemd",
    "policies",
    "test",
  ]) {
    await ensureOrdinaryFiles(join(source, entry));
    await cp(join(source, entry), join(target, entry), { recursive: true });
  }
  await mkdir(destination, { recursive: true });
  const archive = join(destination, `${folder}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", temporary, folder], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  await writeFile(`${archive}.sha256`, `${digest}  ${folder}.tar.gz\n`);
  console.log(
    "Packaged the Raspberry Pi connector with its dependency lock and tests.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
