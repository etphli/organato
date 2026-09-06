/* global process, TextEncoder */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  MAX_RESULT_BYTES,
  ProtocolError,
  parseJsonText,
  validateApiBase,
  validateCanvasBaseUrl,
} from "./protocol.mjs";

export const DEFAULT_STATE_DIR = "/var/lib/organato-canvas-connector";

function resolvedStateDir(value) {
  const result = path.resolve(value);
  if (result === path.parse(result).root || result === path.dirname(result)) {
    throw new ProtocolError("The connector state directory is too broad.");
  }
  return result;
}

function childPath(stateDir, name) {
  const target = path.resolve(stateDir, name);
  const relative = path.relative(stateDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ProtocolError("The connector state path escaped its directory.");
  }
  return target;
}

async function ensureDirectory(directory) {
  let stat;
  try {
    stat = await fs.lstat(directory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    stat = await fs.lstat(directory);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ProtocolError(
      "The connector state directory must be a private directory.",
    );
  }
  await fs.chmod(directory, 0o700);
}

async function writeJsonAtomic(file, value) {
  const directory = path.dirname(file);
  await ensureDirectory(directory);
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const encoded = JSON.stringify(value);
  try {
    await fs.writeFile(temporary, encoded, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function readJson(file, label) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new ProtocolError(`${label} is not a regular file.`);
    const text = await fs.readFile(file, "utf8");
    return parseJsonText(text, label);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError(`${label} could not be read.`);
  }
}

async function removeOwnedPath(target) {
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || stat.isFile()) {
      await fs.unlink(target);
    } else if (stat.isDirectory()) {
      await fs.rm(target, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function validateCredential(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolError("The device credential is malformed.");
  }
  if (
    typeof value.token !== "string" ||
    !/^[A-Za-z0-9_-]{64}$/.test(value.token)
  ) {
    throw new ProtocolError("The device credential token is malformed.");
  }
  return {
    token: value.token,
    apiBase: validateApiBase(value.apiBase).origin,
    canvasBaseUrl: validateCanvasBaseUrl(value.canvasBaseUrl).origin,
    workspaceId: typeof value.workspaceId === "string" ? value.workspaceId : "",
    pairedAt: typeof value.pairedAt === "string" ? value.pairedAt : undefined,
  };
}

function validatePending(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolError("The pending device result is malformed.");
  }
  if (
    typeof value.commandId !== "string" ||
    !value.commandId.trim() ||
    value.commandId.length > 100
  ) {
    throw new ProtocolError("The pending command id is malformed.");
  }
  const result = value.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new ProtocolError("The pending device result body is malformed.");
  }
  return { commandId: value.commandId, result };
}

export class DurableState {
  constructor(stateDir = DEFAULT_STATE_DIR) {
    this.stateDir = resolvedStateDir(stateDir);
    this.credentialFile = childPath(this.stateDir, "device-credential.json");
    this.pendingFile = childPath(this.stateDir, "pending-result.json");
    this.profileDir = childPath(this.stateDir, "chromium-profile");
  }

  async init() {
    await ensureDirectory(this.stateDir);
    return this;
  }

  async loadCredential() {
    const value = await readJson(this.credentialFile, "device credential");
    return value === null ? null : validateCredential(value);
  }

  async saveCredential(value) {
    const credential = validateCredential(value);
    await writeJsonAtomic(this.credentialFile, credential);
    return credential;
  }

  async loadPending() {
    const value = await readJson(this.pendingFile, "pending result");
    return value === null ? null : validatePending(value);
  }

  async savePending(commandId, result) {
    const pending = validatePending({ commandId, result });
    const encoded = JSON.stringify(pending);
    if (new TextEncoder().encode(encoded).byteLength > MAX_RESULT_BYTES) {
      throw new ProtocolError(
        "The pending result exceeded the safe size limit.",
      );
    }
    await writeJsonAtomic(this.pendingFile, pending);
    return pending;
  }

  async clearPending() {
    await removeOwnedPath(this.pendingFile);
  }

  async clearCredentialAndProfile() {
    await removeOwnedPath(this.credentialFile);
    await removeOwnedPath(this.pendingFile);
    await removeOwnedPath(this.profileDir);
  }
}

export {
  childPath,
  ensureDirectory,
  readJson,
  removeOwnedPath,
  writeJsonAtomic,
};
