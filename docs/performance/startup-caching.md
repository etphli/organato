# Startup and workspace caching benchmark

Measured against `0ce61e6` on 5 October 2026, using production builds, Chromium, 480 synthetic work items, 150 ms network latency, and 10 Mbps throughput. Each navigation metric is the median of five fresh browser contexts. The service worker is enabled in both builds. Repeat loads use the same context after initial hydration and cache writes complete. Timings finish after the destination heading paints for two animation frames.

| Measurement                                               |    Before |    After | Reduction |
| --------------------------------------------------------- | --------: | -------: | --------: |
| Cold Home                                                 |  1,143 ms |   826 ms |       28% |
| Cold Assignments                                          |  1,125 ms | 1,009 ms |       10% |
| Repeat Home                                               |    758 ms |   264 ms |       65% |
| Repeat Assignments                                        |    754 ms |   301 ms |       60% |
| First Assignments click, no hover, after 1 second on Home |    344 ms |    62 ms |       82% |
| Sort 480 mixed-deadline items, median of 25 samples       |   21.8 ms |   1.8 ms |       92% |
| Main JavaScript bundle, gzip                              | 104.78 kB | 76.25 kB |       27% |

The main bundle excludes vendor chunks; icons now have a separate 5.06 kB gzip chunk. These are controlled client benchmarks, not measurements of production database or integration latency. Raw timing samples are in [startup-caching-results.json](startup-caching-results.json).

## Changes

- Load the requested page module concurrently with sign-in and workspace requests.
- Save active work items, subjects, settings, and saved views in IndexedDB. Calendar, assignments, checkpoints, Home, and Todo consume this shared snapshot.
- Read the snapshot only after the live sign-in check, keyed by account and workspace. Keep at most one account snapshot; reject invalid data and snapshots older than 24 hours. Clear saved private data after a signed-out session response.
- Revalidate every startup. Keep the current page visible, preserve unchanged item references and typed filters, and apply server updates as a React transition. Retry a response that overlaps a mutation, reject older item versions, and keep pending or failed writes out of the persisted snapshot.
- Warm sidebar page modules after initial hydration, while respecting offline and data-saving mode. Retain hover/focus/touch prefetching. Give hashed assets immutable HTTP caching.
- Load unopened inspector, search, command, and backup-validation code separately. Warm overlays after startup.
- Reuse up to 30 item-detail payloads for 60 seconds, deduplicate pending requests, and invalidate on refresh or edits. Alternating between two unchanged items makes two detail requests instead of four.
- Calculate deadline sort keys once per item per sort, preserving existing ordering.

## Verification

`pnpm check` passed: formatting, lint, types, 217 tests, connector checks, production builds, licence checks, the existing audit policy, and secret scanning. Integration-kit tests also passed (6 tests). Targeted checks were run after each optimization; subsequent reference-retention changes passed targeted tests, lint, type checking, and the web build.

Real desktop (1440 × 1000) and mobile (390 × 844) browser checks covered 25 navigation clicks each, cache hydration before a delayed response, filter and focus retention through server changes, account isolation, expiry rejection, and clearing the cache after sign-out. No page errors occurred. Cache schema tests cover corrupt fields, unsupported versions, unsafe links, and preservation of dependency link identities.

## Recording

This recording uses synthetic data. It visits assignments, checkpoints, and calendar, then reloads assignments while the server waits four seconds. The saved view appears first; the item changes from “saved version” to “server revision” while the Biology filter and input focus remain intact. The fresh item is then shown in checkpoints and calendar.

https://github.com/user-attachments/assets/9f397dc3-3de1-4303-a1fe-5e021eb4081a
