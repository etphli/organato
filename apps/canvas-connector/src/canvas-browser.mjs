/* global URL, TextEncoder, fetch, process */

import fs from "node:fs/promises";
import path from "node:path";

import {
  DestinationPolicy,
  ProtocolError,
  isApiWriteRequest,
  isPrivateAddress,
  validateCanvasBaseUrl,
} from "./protocol.mjs";

export const MAX_CANVAS_RESPONSE_BYTES = 3 * 1024 * 1024;
export const MAX_CANVAS_PAGES = 50;
export const MAX_CANVAS_COURSES = 200;
export const MAX_ASSIGNMENTS_PER_COURSE = 2_000;
export const MAX_CANVAS_ASSIGNMENTS = 2_000;
// Leave headroom under the Worker connector route's 3,000,000-byte body cap.
export const MAX_CANVAS_RESULT_BYTES = 2_900_000;

const MAX_ID_LENGTH = 100;
const MAX_IDENTITY_NAME_LENGTH = 300;
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function isIsoDateTime(value) {
  return (
    typeof value === "string" &&
    value.length <= 100 &&
    ISO_DATETIME_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export class CanvasBrowserError extends Error {
  constructor(code, message = code, diagnostic) {
    super(message);
    this.name = "CanvasBrowserError";
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

function idValue(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "string") {
    const result = value.trim();
    return result && result.length <= MAX_ID_LENGTH ? result : null;
  }
  return null;
}

export function normalizeCanvasIdentity(value, hostname) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanvasBrowserError("read_failed");
  }
  const id = idValue(value.id);
  if (!id || typeof hostname !== "string" || hostname.length > 253) {
    throw new CanvasBrowserError("read_failed");
  }
  const name = [value.name, value.display_name, value.short_name].find(
    (candidate) => typeof candidate === "string" && candidate.trim(),
  );
  return {
    id,
    name:
      typeof name === "string"
        ? name.trim().slice(0, MAX_IDENTITY_NAME_LENGTH)
        : "Canvas user",
    hostname,
  };
}

function normalizeCourse(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const id = idValue(row.id);
  if (!id || typeof row.name !== "string" || !row.name.trim()) return null;
  const workflowState = row.workflowState ?? row.workflow_state;
  return {
    id,
    name: row.name.trim().slice(0, 1_000),
    workflowState:
      typeof workflowState === "string" && workflowState.trim()
        ? workflowState.trim().slice(0, 100)
        : "available",
  };
}

function normalizeAssignment(row, canvasOrigin) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const id = idValue(row.id);
  const courseId = idValue(row.courseId ?? row.course_id);
  const updatedAt = row.updatedAt ?? row.updated_at;
  const htmlUrlValue = row.htmlUrl ?? row.html_url;
  const dueAtValue = Object.hasOwn(row, "dueAt") ? row.dueAt : row.due_at;
  if (
    !id ||
    !courseId ||
    typeof row.name !== "string" ||
    !row.name.trim() ||
    typeof updatedAt !== "string" ||
    !isIsoDateTime(updatedAt.trim()) ||
    typeof htmlUrlValue !== "string"
  ) {
    return null;
  }
  let htmlUrl;
  try {
    htmlUrl = new URL(htmlUrlValue);
  } catch {
    return null;
  }
  if (
    htmlUrl.origin !== canvasOrigin ||
    htmlUrl.protocol !== "https:" ||
    isPrivateAddress(htmlUrl.hostname) ||
    htmlUrl.username ||
    htmlUrl.password ||
    htmlUrl.href.length > 2_000
  ) {
    return null;
  }
  const dueAt =
    dueAtValue === null || dueAtValue === undefined
      ? null
      : typeof dueAtValue === "string"
        ? dueAtValue.trim()
        : dueAtValue;
  if (dueAt !== null && !isIsoDateTime(dueAt)) return null;
  const submitted =
    typeof row.submitted === "boolean"
      ? row.submitted
      : ["submitted", "graded", "pending_review"].includes(
          row.submission?.workflow_state ?? "",
        );
  return {
    id,
    courseId,
    name: row.name.trim().slice(0, 1_000),
    dueAt,
    htmlUrl: htmlUrl.href,
    updatedAt: updatedAt.trim(),
    published: typeof row.published === "boolean" ? row.published : true,
    submitted,
  };
}

export function normalizeCanvasSyncResult(value, canvasOrigin) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanvasBrowserError("read_failed");
  }
  if (
    !Array.isArray(value.courses) ||
    !Array.isArray(value.assignments) ||
    !Array.isArray(value.partialFailures) ||
    !Array.isArray(value.successfulCourseIds) ||
    typeof value.catalogueComplete !== "boolean" ||
    !Number.isSafeInteger(value.skippedMalformedItems) ||
    value.skippedMalformedItems < 0
  ) {
    throw new CanvasBrowserError("read_failed");
  }
  const origin = validateCanvasBaseUrl(canvasOrigin).origin;
  const courses = value.courses.map((course) => {
    const normalized = normalizeCourse(course);
    if (!normalized) throw new CanvasBrowserError("read_failed");
    return normalized;
  });
  const assignments = value.assignments.map((assignment) => {
    const normalized = normalizeAssignment(assignment, origin);
    if (!normalized) throw new CanvasBrowserError("read_failed");
    return normalized;
  });
  if (
    courses.length > MAX_CANVAS_COURSES ||
    assignments.length > MAX_CANVAS_ASSIGNMENTS
  ) {
    throw new CanvasBrowserError("read_failed");
  }
  const courseIds = new Set();
  for (const course of courses) {
    if (courseIds.has(course.id)) throw new CanvasBrowserError("read_failed");
    courseIds.add(course.id);
  }
  const assignmentIds = new Set();
  for (const assignment of assignments) {
    if (
      assignmentIds.has(assignment.id) ||
      !courseIds.has(assignment.courseId)
    ) {
      throw new CanvasBrowserError("read_failed");
    }
    assignmentIds.add(assignment.id);
  }
  if (
    value.partialFailures.length > 201 ||
    value.successfulCourseIds.length > MAX_CANVAS_COURSES ||
    value.skippedMalformedItems > 100_000
  ) {
    throw new CanvasBrowserError("read_failed");
  }
  const partialFailures = value.partialFailures.map((failure) => {
    if (
      !failure ||
      typeof failure !== "object" ||
      Array.isArray(failure) ||
      typeof failure.courseId !== "string" ||
      !idValue(failure.courseId) ||
      typeof failure.category !== "string" ||
      !failure.category.trim() ||
      failure.category.length > 100
    ) {
      throw new CanvasBrowserError("read_failed");
    }
    return {
      courseId: failure.courseId.trim(),
      category: failure.category.trim(),
    };
  });
  if (
    (!value.catalogueComplete && partialFailures.length === 0) ||
    (value.skippedMalformedItems > 0 && partialFailures.length === 0)
  ) {
    throw new CanvasBrowserError("read_failed");
  }
  const successfulCourseIds = value.successfulCourseIds.map((id) => {
    const normalized = idValue(id);
    if (!normalized) throw new CanvasBrowserError("read_failed");
    return normalized;
  });
  const successfulSet = new Set(successfulCourseIds);
  if (successfulSet.size !== successfulCourseIds.length)
    throw new CanvasBrowserError("read_failed");
  for (const courseId of successfulSet) {
    if (!courseIds.has(courseId)) throw new CanvasBrowserError("read_failed");
  }
  const partialCourseIds = new Set(
    partialFailures
      .map((failure) => failure.courseId)
      .filter((courseId) => courseIds.has(courseId)),
  );
  for (const failure of partialFailures) {
    if (
      failure.courseId !== "course_catalogue" &&
      !courseIds.has(failure.courseId)
    ) {
      throw new CanvasBrowserError("read_failed");
    }
  }
  for (const course of courses) {
    if (successfulSet.has(course.id) === partialCourseIds.has(course.id)) {
      throw new CanvasBrowserError("read_failed");
    }
  }
  if (
    value.skippedMalformedItems > 0 &&
    !partialFailures.some((failure) => failure.category.includes("malformed"))
  ) {
    throw new CanvasBrowserError("read_failed");
  }
  if (utf8ByteLength(JSON.stringify(value)) > MAX_CANVAS_RESULT_BYTES) {
    throw new CanvasBrowserError("read_failed");
  }
  return {
    courses,
    assignments,
    partialFailures,
    successfulCourseIds,
    catalogueComplete: value.catalogueComplete,
    skippedMalformedItems: value.skippedMalformedItems,
  };
}

function isMissingExecutable(error) {
  return error?.code === "ENOENT" || error?.code === "EACCES";
}

export async function findChromiumExecutable(configured) {
  const candidates = [
    configured,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      if (!isMissingExecutable(error)) throw error;
    }
  }
  throw new CanvasBrowserError(
    "read_failed",
    "Chromium executable was not found.",
  );
}

export function browserLaunchDiagnostic(error) {
  const message = error instanceof Error ? error.message : "";
  if (/SingletonLock|ProcessSingleton|profile.*in use/i.test(message))
    return "profile_in_use";
  if (
    /Missing X server|cannot open display|unable to open.*display/i.test(
      message,
    )
  )
    return "display_unavailable";
  if (/remote debugging.*disabled|DevTools.*disallowed/i.test(message))
    return "browser_control_blocked";
  if (/timeout|timed out/i.test(message)) return "browser_launch_timeout";
  return "browser_launch_failed";
}

async function launchPersistentBrowser({
  profileDir,
  executablePath,
  display,
  launchUrl,
}) {
  const { chromium } = await import("playwright-core");
  return chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless: false,
    viewport: null,
    acceptDownloads: false,
    serviceWorkers: "block",
    userPrefs: {
      credentials_enable_service: false,
      "profile.password_manager_enabled": false,
      "autofill.profile_enabled": false,
      "autofill.credit_card_enabled": false,
      "download.prompt_for_download": false,
      "download.directory_upgrade": false,
      "session.restore_on_startup": 4,
      "session.startup_urls": [launchUrl],
    },
    env: { ...process.env, DISPLAY: display },
    args: chromiumLaunchArguments(launchUrl),
  });
}

export function chromiumLaunchArguments(launchUrl) {
  return [
    `--app=${launchUrl}`,
    "--window-size=1280,900",
    "--no-first-run",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-devtools",
    "--disable-save-password-bubble",
    "--disable-password-generation",
    "--disable-features=DeveloperToolsAvailability,PasswordManagerOnboarding",
  ];
}

const BLOCK_CLIPBOARD_SCRIPT = `(() => {
  window.open = () => null;
  document.addEventListener("keydown", (event) => {
    if (event.key === "F11" || event.key === "F12" ||
        ((event.ctrlKey || event.metaKey) && ["l", "t", "n", "w", "o", "j", "u"].includes(event.key.toLowerCase()))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest?.("a[target]");
    if (anchor) anchor.target = "_self";
  }, true);
  const blocked = () => Promise.reject(new DOMException("Clipboard access is disabled", "NotAllowedError"));
  try {
    Object.defineProperty(navigator, "clipboard", {
      configurable: false,
      enumerable: true,
      get: () => ({ read: blocked, readText: blocked, write: blocked, writeText: blocked }),
    });
  } catch {}
})();`;

async function identityInPage(baseOrigin) {
  const paths = ["/api/v1/users/self", "/api/v1/users/self/profile"];
  let lastFailure = { category: "read_failed", status: 0 };
  for (const pathName of paths) {
    try {
      const target = new URL(pathName, baseOrigin);
      const response = await fetch(target.href, {
        method: "GET",
        credentials: "include",
        redirect: "manual",
        headers: { Accept: "application/json, text/plain, */*" },
      });
      if (
        response.type === "opaqueredirect" ||
        (response.status >= 300 && response.status < 400)
      ) {
        lastFailure = {
          category: "read_failed",
          status: response.status,
          redirect: true,
        };
        continue;
      }
      if (response.status === 401) {
        lastFailure = { category: "login_required", status: response.status };
        continue;
      }
      if (response.status === 403) {
        lastFailure = { category: "read_failed", status: response.status };
        continue;
      }
      if (!response.ok) {
        lastFailure = { category: "network_error", status: response.status };
        continue;
      }
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(contentLength) && contentLength > 3 * 1024 * 1024) {
        return { ok: false, category: "read_failed" };
      }
      const text = await response.text();
      if (text.length > 3 * 1024 * 1024)
        return { ok: false, category: "read_failed" };
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        return { ok: false, category: "read_failed" };
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, category: "read_failed" };
      }
      return { ok: true, value };
    } catch {
      lastFailure = { category: "network_error", status: 0 };
    }
  }
  return { ok: false, ...lastFailure };
}

async function syncInPage(baseOrigin) {
  const maximumResponseBytes = 3 * 1024 * 1024;
  const maximumPages = 50;
  const maximumCourses = 200;
  const maximumAssignments = 2_000;
  const maximumTotalAssignments = 2_000;
  const maximumResultBytes = 2_900_000;
  const maximumIdLength = 100;
  const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
  const isIsoDateTimeInPage = (value) =>
    typeof value === "string" &&
    value.length <= 100 &&
    isoDateTimePattern.test(value) &&
    Number.isFinite(Date.parse(value));
  const utf8ByteLengthInPage = (value) =>
    new TextEncoder().encode(value).byteLength;

  const idValueInPage = (value) => {
    if (typeof value === "number")
      return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
    if (typeof value === "string") {
      const result = value.trim();
      return result && result.length <= maximumIdLength ? result : null;
    }
    return null;
  };
  const fetchJson = async (urlValue) => {
    let target;
    try {
      target = new URL(urlValue, baseOrigin);
    } catch {
      return { ok: false, category: "read_failed", status: 0 };
    }
    if (
      target.origin !== baseOrigin ||
      target.protocol !== "https:" ||
      target.username ||
      target.password
    ) {
      return { ok: false, category: "read_failed", status: 0 };
    }
    try {
      const response = await fetch(target.href, {
        method: "GET",
        credentials: "include",
        redirect: "manual",
        headers: { Accept: "application/json, text/plain, */*" },
      });
      if (
        response.type === "opaqueredirect" ||
        (response.status >= 300 && response.status < 400)
      ) {
        return {
          ok: false,
          category: "read_failed",
          status: response.status,
          redirect: true,
        };
      }
      if (response.status === 401)
        return {
          ok: false,
          category: "login_required",
          status: response.status,
        };
      if (response.status === 403)
        return { ok: false, category: "read_failed", status: response.status };
      if (response.status === 429 || response.status >= 500) {
        return {
          ok: false,
          category: "network_error",
          status: response.status,
        };
      }
      if (!response.ok)
        return { ok: false, category: "read_failed", status: response.status };
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (
        Number.isFinite(contentLength) &&
        contentLength > maximumResponseBytes
      ) {
        return {
          ok: false,
          category: "read_failed",
          status: 0,
          oversized: true,
        };
      }
      const text = await response.text();
      if (text.length > maximumResponseBytes) {
        return {
          ok: false,
          category: "read_failed",
          status: 0,
          oversized: true,
        };
      }
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        return { ok: false, category: "read_failed", status: 0 };
      }
      return { ok: true, value, link: response.headers.get("link") };
    } catch {
      return { ok: false, category: "network_error", status: 0 };
    }
  };
  const nextLink = (header) => {
    if (!header) return null;
    for (const part of header.split(",")) {
      const match = part.match(/<([^>]+)>;\s*rel=["']?([^"';, ]+)["']?/i);
      if (match && match[2].toLowerCase() === "next") return match[1];
    }
    return null;
  };
  const paginated = async (firstUrl, maximumRows) => {
    const rows = [];
    const visited = new Set();
    let next = firstUrl;
    let truncated = false;
    while (next) {
      if (visited.has(next) || visited.size >= maximumPages) {
        truncated = true;
        break;
      }
      visited.add(next);
      const result = await fetchJson(next);
      if (!result.ok) return { ok: false, ...result };
      if (!Array.isArray(result.value))
        return { ok: false, category: "read_failed", status: 0 };
      rows.push(...result.value);
      if (rows.length > maximumRows) {
        return { ok: false, category: "read_failed", status: 0, limit: true };
      }
      const candidate = nextLink(result.link);
      if (!candidate) {
        next = null;
      } else {
        try {
          const candidateUrl = new URL(candidate, baseOrigin);
          if (
            candidateUrl.origin !== baseOrigin ||
            candidateUrl.protocol !== "https:" ||
            candidateUrl.username ||
            candidateUrl.password
          ) {
            return { ok: false, category: "read_failed", status: 0 };
          }
          next = candidateUrl.href;
        } catch {
          return { ok: false, category: "read_failed", status: 0 };
        }
      }
    }
    return { ok: true, rows: rows.slice(0, maximumRows), truncated };
  };

  const catalogue = await paginated(
    "/api/v1/courses?enrollment_state=active&state[]=available&per_page=100",
    maximumCourses,
  );
  if (!catalogue.ok) return { ok: false, category: catalogue.category };

  const courses = [];
  let skippedMalformedItems = 0;
  for (const row of catalogue.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      skippedMalformedItems += 1;
      continue;
    }
    const id = idValueInPage(row.id);
    if (!id || typeof row.name !== "string" || !row.name.trim()) {
      skippedMalformedItems += 1;
      continue;
    }
    courses.push({
      id,
      name: row.name.trim().slice(0, 500),
      workflowState:
        typeof row.workflow_state === "string" && row.workflow_state.trim()
          ? row.workflow_state.trim().slice(0, 100)
          : "available",
    });
  }
  const partialFailures = [];
  if (skippedMalformedItems > 0 || catalogue.truncated) {
    partialFailures.push({
      courseId: "course_catalogue",
      category: [
        skippedMalformedItems > 0 ? "malformed_course" : null,
        catalogue.truncated ? "pagination_limit" : null,
      ]
        .filter(Boolean)
        .join(","),
    });
  }

  const assignments = [];
  const successfulCourseIds = [];
  const fetchCourse = async (course) => {
    const result = await paginated(
      `/api/v1/courses/${encodeURIComponent(course.id)}/assignments?bucket=upcoming&override_assignment_dates=true&include[]=submission&per_page=100`,
      maximumAssignments,
    );
    if (!result.ok) return { course, ok: false, category: result.category };
    let malformedForCourse = 0;
    const normalized = [];
    for (const row of result.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        malformedForCourse += 1;
        continue;
      }
      const id = idValueInPage(row.id);
      const courseId = idValueInPage(row.course_id);
      let htmlUrl;
      try {
        htmlUrl = new URL(row.html_url);
      } catch {
        htmlUrl = null;
      }
      const dueAt =
        row.due_at === null || row.due_at === undefined ? null : row.due_at;
      if (
        !id ||
        !courseId ||
        courseId !== course.id ||
        typeof row.name !== "string" ||
        !row.name.trim() ||
        typeof row.updated_at !== "string" ||
        !isIsoDateTimeInPage(row.updated_at.trim()) ||
        !htmlUrl ||
        htmlUrl.origin !== baseOrigin ||
        htmlUrl.protocol !== "https:" ||
        htmlUrl.username ||
        htmlUrl.password ||
        htmlUrl.href.length > 2_000 ||
        (dueAt !== null && !isIsoDateTimeInPage(dueAt))
      ) {
        malformedForCourse += 1;
        continue;
      }
      normalized.push({
        id,
        courseId,
        name: row.name.trim().slice(0, 500),
        dueAt,
        htmlUrl: htmlUrl.href,
        updatedAt: row.updated_at.trim(),
        published: typeof row.published === "boolean" ? row.published : true,
        submitted: ["submitted", "graded", "pending_review"].includes(
          row.submission?.workflow_state ?? "",
        ),
      });
    }
    return {
      course,
      ok: true,
      normalized,
      malformedForCourse,
      truncated: result.truncated,
    };
  };

  for (let start = 0; start < courses.length; start += 4) {
    const chunk = courses.slice(start, start + 4);
    const results = await Promise.all(chunk.map(fetchCourse));
    for (const result of results) {
      if (!result.ok) {
        if (result.category === "login_required")
          return { ok: false, category: "login_required" };
        partialFailures.push({
          courseId: result.course.id,
          category: "course_fetch_failed",
        });
        continue;
      }
      assignments.push(...result.normalized);
      if (assignments.length > maximumTotalAssignments) {
        return { ok: false, category: "read_failed", limit: true };
      }
      skippedMalformedItems += result.malformedForCourse;
      if (skippedMalformedItems > 100_000) {
        return { ok: false, category: "read_failed", limit: true };
      }
      if (result.malformedForCourse || result.truncated) {
        partialFailures.push({
          courseId: result.course.id,
          category: [
            result.malformedForCourse ? "malformed_item" : null,
            result.truncated ? "pagination_limit" : null,
          ]
            .filter(Boolean)
            .join(","),
        });
      } else {
        successfulCourseIds.push(result.course.id);
      }
    }
  }
  const value = {
    courses,
    assignments,
    partialFailures,
    successfulCourseIds,
    catalogueComplete: !catalogue.truncated && skippedMalformedItems === 0,
    skippedMalformedItems,
  };
  if (utf8ByteLengthInPage(JSON.stringify(value)) > maximumResultBytes) {
    return { ok: false, category: "read_failed", limit: true };
  }
  return { ok: true, value };
}

function classifyPageFailure(result) {
  if (result?.category === "login_required") return "login_required";
  if (result?.category === "network_error") return "network_error";
  return "read_failed";
}

export class CanvasBrowserAdapter {
  constructor({
    canvasBaseUrl,
    ssoAllowlist = [],
    profileDir,
    executablePath,
    display = ":99",
    browserLauncher = launchPersistentBrowser,
    lookup,
  }) {
    this.baseUrl = validateCanvasBaseUrl(canvasBaseUrl);
    if (!profileDir || typeof profileDir !== "string") {
      throw new ProtocolError(
        "A persistent browser profile directory is required.",
      );
    }
    this.profileDir = path.resolve(profileDir);
    this.executablePath = executablePath;
    this.display = display;
    this.browserLauncher = browserLauncher;
    this.policy = new DestinationPolicy({
      canvasBaseUrl: this.baseUrl.origin,
      ssoAllowlist,
      ...(lookup ? { lookup } : {}),
    });
    this.context = null;
    this.page = null;
  }

  async ensureContext() {
    if (this.context) return this.context;
    let stat;
    try {
      stat = await fs.lstat(this.profileDir);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await fs.mkdir(this.profileDir, { recursive: true, mode: 0o700 });
      stat = await fs.lstat(this.profileDir);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new CanvasBrowserError("read_failed");
    }
    await fs.chmod(this.profileDir, 0o700);
    try {
      await this.policy.assertAllowedOrigins();
    } catch {
      throw new CanvasBrowserError("network_error");
    }
    const executable = await findChromiumExecutable(this.executablePath);
    let context;
    try {
      context = await this.browserLauncher({
        profileDir: this.profileDir,
        executablePath: executable,
        display: this.display,
        launchUrl: `${this.baseUrl.origin}/`,
      });
    } catch (error) {
      throw new CanvasBrowserError(
        "read_failed",
        "Browser launch failed",
        browserLaunchDiagnostic(error),
      );
    }
    try {
      if (typeof context.addInitScript === "function") {
        await context.addInitScript({ content: BLOCK_CLIPBOARD_SCRIPT });
      }
      if (typeof context.route === "function") {
        await context.route("**/*", async (route) => {
          const request = route.request();
          const requestUrl =
            typeof request?.url === "function" ? request.url() : request?.url;
          const requestMethod =
            typeof request?.method === "function"
              ? request.method()
              : request?.method;
          try {
            if (
              (request.isNavigationRequest?.() &&
                !this.policy.isNavigationAllowed(requestUrl)) ||
              isApiWriteRequest(request) ||
              !this.policy.isWriteAllowed(requestUrl, requestMethod) ||
              !(await this.policy.isAllowed(requestUrl))
            ) {
              await route.abort("blockedbyclient");
              return;
            }
            await route.continue();
          } catch {
            await route.abort("failed").catch(() => undefined);
          }
        });
      }
      if (typeof context.on === "function") {
        context.on("page", (page) => {
          if (this.page && this.page !== page) {
            void page.close().catch(() => undefined);
            return;
          }
          this.page = page;
          this.installPage(page);
        });
      }
      const pages = typeof context.pages === "function" ? context.pages() : [];
      this.page = pages[0] ?? (await context.newPage());
      this.installPage(this.page);
      for (const extra of pages.slice(1)) await extra.close();
      this.context = context;
      return context;
    } catch {
      if (typeof context.close === "function")
        await context.close().catch(() => undefined);
      this.page = null;
      throw new CanvasBrowserError("read_failed");
    }
  }

  installPage(page) {
    if (!page || typeof page.on !== "function") return;
    page.on("download", (download) => {
      void download.cancel().catch(() => undefined);
    });
  }

  async openLogin() {
    await this.ensureContext();
    const target = new URL("/", this.baseUrl).href;
    try {
      await this.page.goto(target, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    } catch {
      // A slow school SSO page is still useful to the remote viewer. The next
      // verify command is the authoritative check of whether sign-in worked.
    }
    if (typeof this.page.bringToFront === "function") {
      await this.page.bringToFront().catch(() => undefined);
    }
  }

  async ensureCanvasOrigin() {
    await this.ensureContext();
    let currentOrigin;
    try {
      currentOrigin = new URL(this.page.url()).origin;
    } catch {
      currentOrigin = null;
    }
    if (currentOrigin === this.baseUrl.origin) return;
    try {
      await this.page.goto(`${this.baseUrl.origin}/`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    } catch {
      throw new CanvasBrowserError("network_error");
    }
    try {
      if (new URL(this.page.url()).origin !== this.baseUrl.origin) {
        throw new CanvasBrowserError("login_required");
      }
    } catch (error) {
      if (error instanceof CanvasBrowserError) throw error;
      throw new CanvasBrowserError("read_failed");
    }
  }

  async readIdentity() {
    await this.ensureCanvasOrigin();
    let result;
    try {
      result = await this.page.evaluate(identityInPage, this.baseUrl.origin);
    } catch {
      throw new CanvasBrowserError("network_error");
    }
    if (!result?.ok) throw new CanvasBrowserError(classifyPageFailure(result));
    return normalizeCanvasIdentity(result.value, this.baseUrl.hostname);
  }

  async fetchUpcomingAssignments() {
    await this.ensureCanvasOrigin();
    let result;
    try {
      result = await this.page.evaluate(syncInPage, this.baseUrl.origin);
    } catch {
      throw new CanvasBrowserError("network_error");
    }
    if (!result?.ok) throw new CanvasBrowserError(classifyPageFailure(result));
    try {
      return normalizeCanvasSyncResult(result.value, this.baseUrl.origin);
    } catch {
      throw new CanvasBrowserError("read_failed");
    }
  }

  async close() {
    const context = this.context;
    this.context = null;
    this.page = null;
    if (context && typeof context.close === "function") {
      await context.close().catch(() => undefined);
    }
  }
}

export { identityInPage, syncInPage };
