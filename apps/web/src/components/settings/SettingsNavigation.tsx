import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

export const settingsCategories = [
  ["account", "Account & access"],
  ["appearance", "Appearance"],
  ["home", "Home"],
  ["work", "Assignments"],
  ["todo", "Todo"],
  ["calendar", "Calendar"],
  ["canvas", "Canvas / Reshet"],
  ["email", "Email & reminders"],
  ["subjects", "Subjects"],
  ["search", "Search & shortcuts"],
  ["accessibility", "Accessibility"],
  ["data", "Data & archive"],
  ["security", "Security"],
  ["advanced", "Advanced"],
  ["about", "About"],
] as const;

export type SettingsCategoryId = (typeof settingsCategories)[number][0];

const groups: Array<{
  label: string;
  categories: SettingsCategoryId[];
}> = [
  { label: "Account", categories: ["account"] },
  {
    label: "Preferences",
    categories: [
      "appearance",
      "home",
      "work",
      "todo",
      "calendar",
      "search",
      "accessibility",
    ],
  },
  { label: "Integrations", categories: ["canvas", "email"] },
  {
    label: "Data & security",
    categories: ["subjects", "data", "security", "advanced"],
  },
  { label: "About", categories: ["about"] },
];

const searchTerms: Record<SettingsCategoryId, string> = {
  account:
    "profile display name timezone sydney google account allowed identity owner sign in active sessions browser revoke",
  appearance:
    "theme obsidian dark black light system density compact comfortable font size sidebar corners animation colour",
  home: "mini calendar quick todo upcoming workload panels",
  work: "assignment checkpoint both table columns inline editing source icons submitted bulk archive sort view",
  todo: "task quick add natural shorthand recurrence repeat reminder calendar attachment",
  calendar:
    "month week agenda first day drag reschedule all day google calendar event",
  canvas:
    "canvas reshet Emanuel School session cookie course upcoming assignment import sync read only connect",
  email:
    "gmail email digest reminder 6 am Sydney recipient test message short notice",
  subjects: "course subject name rename short label colour color active hidden",
  search:
    "search notes fuzzy recent command palette keyboard shortcut key bindings",
  accessibility:
    "reduced motion contrast underline links icon text screen reader focus font",
  data: "archive restore export csv json backup import retention delete reset statistics",
  security:
    "session sign in event reauthenticate revoke token encryption privacy diagnostic scope",
  advanced:
    "rescan rebuild sync token device preferences diagnostics usage ceiling internal ids",
  about: "version build schema license privacy free policy update PWA source",
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function SettingsNavigation({ active }: { active: SettingsCategoryId }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const normalized = normalize(query);
    if (!normalized) return new Set(settingsCategories.map(([id]) => id));
    return new Set(
      settingsCategories
        .filter(
          ([id, label]) =>
            normalize(label).includes(normalized) ||
            searchTerms[id].includes(normalized),
        )
        .map(([id]) => id),
    );
  }, [query]);
  const resultCount = visible.size;

  return (
    <aside className="settings-nav" aria-label="Settings navigation">
      <label>
        <Search size={15} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings"
          aria-label="Search settings"
        />
      </label>
      {groups.map((group) => {
        const visibleIds = group.categories.filter((id) => visible.has(id));
        if (!visibleIds.length) return null;
        return (
          <div className="settings-nav-group" key={group.label}>
            <strong>{group.label}</strong>
            {visibleIds.map((id) => {
              const category = settingsCategories.find(
                ([categoryId]) => categoryId === id,
              );
              if (!category) return null;
              return (
                <Link
                  key={id}
                  to={`/settings/${id}`}
                  className={active === id ? "active" : ""}
                >
                  {category[1]}
                </Link>
              );
            })}
          </div>
        );
      })}
      {!resultCount ? (
        <p className="settings-nav-empty">No matching setting.</p>
      ) : null}
    </aside>
  );
}
