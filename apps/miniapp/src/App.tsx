import { useMemo } from "react";
import { ErrorBoundary } from "./shell/ErrorBoundary.tsx";
import { Shell } from "./shell/Shell.tsx";
import { createTelemetry } from "./telemetry/telemetry.ts";

/**
 * Product root. Holds only presentation state (route, theme).
 * No Users / Rides / Drivers / Offers / Sessions / Tracking domain state
 * (ADR 0035 — Mini App holds no business state).
 */
/**
 * `F1-08`: موضعُ إنشاءِ القياسِ الواحدُ — نسخةٌ واحدةٌ لعمرِ التطبيقِ تُمرَّر إلى
 * حدِّ الخطأِ وإلى الهيكل. **والمَصرِفُ الافتراضيُّ لا يفعل شيئاً**: لا شبكةَ ولا
 * تخزينَ ولا مزوّدَ خارجيَّ (قرارُ مالكِ المنتج · ADR 0043). فما بُنِي بنيةُ القياسِ
 * وربطُها بمعرّفِ الطلبِ، لا إرسالُه — والإرسالُ ينتظر منصةً وموافقةً.
 */
export function App() {
  const telemetry = useMemo(() => createTelemetry(), []);
  return (
    <ErrorBoundary label="root" telemetry={telemetry}>
      <Shell telemetry={telemetry} />
    </ErrorBoundary>
  );
}
