import { performance } from "node:perf_hooks";

const courses = Number(process.env.ORGANATO_BENCHMARK_COURSES ?? 12);
const assignmentsPerCourse = Number(
  process.env.ORGANATO_BENCHMARK_ASSIGNMENTS_PER_COURSE ?? 40,
);
const records = Array.from(
  { length: courses * assignmentsPerCourse },
  (_, index) => ({
    id: String(index + 1),
    courseId: String((index % courses) + 1),
    name: `Redacted assignment ${index + 1}`,
    dueAt: new Date(
      Date.UTC(2026, 6, 25 + (index % 30), index % 24),
    ).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 6, 25, 0, index % 60)).toISOString(),
    submitted: index % 17 === 0,
  }),
);

const encoder = new TextEncoder();
const start = performance.now();
const normalized = [];
for (const record of records) {
  const payload = JSON.stringify([
    record.name.trim(),
    record.dueAt,
    record.updatedAt,
    record.submitted,
  ]);
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(payload));
  normalized.push({
    ...record,
    hash: new Uint8Array(hash)[0],
    key: `${record.courseId}:${record.id}`,
  });
}
normalized.sort((a, b) => a.key.localeCompare(b.key));
const cpuApproximationMs = performance.now() - start;
const result = {
  courses,
  assignments: records.length,
  cpuApproximationMs: Number(cpuApproximationMs.toFixed(2)),
  cloudflareFreeCronCpuLimitMs: 10,
  decision:
    cpuApproximationMs <= 7
      ? "candidate-only: repeat with real redacted fixture in workerd"
      : "use-local-launchd-fallback",
};
console.log(JSON.stringify(result, null, 2));
if (cpuApproximationMs > 7) process.exitCode = 2;
