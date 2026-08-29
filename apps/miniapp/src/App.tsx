import { useMemo } from "react";
import { establishSession } from "./identity/boot.ts";
import { clearSession } from "./identity/session.ts";
import { fetchViewer } from "./identity/viewer.ts";
import { ErrorBoundary } from "./shell/ErrorBoundary.tsx";
import type { IdentityPort } from "./shell/identity-port.ts";
import { Shell } from "./shell/Shell.tsx";
import { createTelemetry } from "./telemetry/telemetry.ts";

/**
 * `F1-09`: **موضعُ وصلِ الهويةِ بالإطارِ الواحد**. وهو ههنا لا في `Shell`
 * لأنّ القسم 9.4 يجعل `shell` و`identity` حزمتَين، ونقطةُ الدخولِ وحدَها فوقَ
 * الحزمتَين فيملِك أن يستوردهما معاً بلا دائرةٍ. والكائنُ ثابتٌ لعمرِ التطبيقِ:
 * كائنٌ جديدٌ في كلِّ تصييرٍ يُعيد تشغيلَ أثرِ الإقلاعِ أبداً.
 */
const identity: IdentityPort = { establishSession, clearSession, fetchViewer };

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
      <Shell identity={identity} telemetry={telemetry} />
    </ErrorBoundary>
  );
}
