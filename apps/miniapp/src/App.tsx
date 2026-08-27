import { ErrorBoundary } from "./shell/ErrorBoundary.tsx";
import { Shell } from "./shell/Shell.tsx";

/**
 * Product root. Holds only presentation state (route, theme).
 * No Users / Rides / Drivers / Offers / Sessions / Tracking domain state
 * (ADR 0035 — Mini App holds no business state).
 */
export function App() {
  return (
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  );
}
