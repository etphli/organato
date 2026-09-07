import { useOrganatoWorkspace } from "../state/OrganatoProvider";

export function SubjectDot({ subjectId }: { subjectId: string | null }) {
  const { subjectsById } = useOrganatoWorkspace();
  const subject = subjectId ? subjectsById.get(subjectId) : undefined;
  return (
    <span
      className="subject-dot"
      style={
        {
          "--subject-colour": subject?.colour ?? "#71717a",
        } as React.CSSProperties
      }
      aria-label={subject?.displayName ?? "No subject"}
      title={subject?.displayName ?? "No subject"}
    />
  );
}
