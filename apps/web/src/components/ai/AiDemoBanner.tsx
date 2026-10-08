import { useOrganatoActions } from "../../state/OrganatoProvider";
import "./ai.css";

export function AiDemoBanner() {
  const { dispatch } = useOrganatoActions();
  if (import.meta.env.VITE_DEMO_MODE !== "true") return null;
  return (
    <div className="ai-demo-banner">
      <span>Demo workspace · Local sample data. No API requests.</span>
      <button type="button" onClick={() => dispatch({ type: "reset" })}>
        Reset demo
      </button>
    </div>
  );
}
