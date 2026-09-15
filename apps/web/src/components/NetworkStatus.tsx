import { useEffect, useState } from "react";

export function NetworkStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online ? null : (
    <div className="network-banner" role="alert">
      Offline · showing the last available view. Changes won&apos;t save until
      you reconnect.
    </div>
  );
}
