/**
 * الغرض: فحصُ الحياةِ **مرّةً واحدةً عندَ الفشلِ** للإجابةِ عن سؤالِ القسم 9.7:
 *   «الشبكةُ أم خدمتُنا؟» — عبرَ `GET /health` وحدَه (القسم 10: «فحوصُ التشغيل |
 *   نظام»)، وهو مسارٌ بلا تبعياتٍ يعيد حياةً لا جهوزيةً.
 * الحالة: منفّذ فعلياً — البند `F1-07` (بقرارِ مالكِ المنتجِ: «نعم — `GET /health`
 *   وحدَه»).
 * ينتمي إلى: apps/miniapp/src/system (حزمة `shell` — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `shell/Shell.tsx` و`routing/RoleRouter.tsx` عندَ فشلِ
 *   نداءٍ، ولا شيءَ سواهما.
 * ملاحظات مستقبلية: **`GET /ready` لا يُقرأ من هذا التطبيقِ عن قصد** — جسمُه يحمل
 *   `missingEnv` و`failedChecks` و`checkDetails` بأسماءِ فحوصٍ داخلية، وقارئُه
 *   عميلٌ غيرُ موثَّق. فـ«ما يعمل وما لا يعمل» في `SS-02` يُبنى على رمزِ الحالةِ
 *   وترويسةِ `Retry-After` لا على داخلياتِ الخادم. وموجزُ حالةٍ عامٌّ مخصَّصٌ
 *   للعملاءِ قرارٌ لاحقٌ إن طُلب.
 *
 * لماذا لا فحصٌ دوريّ: ADR 0035 §4 يمنع نمطَ الاستقصاءِ الدوريِّ في شاشاتِ
 * التطبيقِ المصغَّر. والفحصُ ههنا **ردُّ فعلٍ على فشلٍ حدث** لا نبضٌ يعمل دائماً،
 * وإعادةُ المحاولةِ بيدِ المستخدمِ وحدَه. ويحرس ذلك فحصٌ في CI لا اتفاقٌ يُنسى.
 */

import { ApiError, apiFetch } from "../api/client.ts";
import type { ReachabilityProbe } from "./failure.ts";

/** نداءُ الفحصِ — يُحقَن في الاختبارِ فلا تُنادى شبكةٌ حقيقية. */
export type HealthCall = () => Promise<unknown>;

const callHealth: HealthCall = () => apiFetch<unknown>("/health", { public: true });

/**
 * أوصلَ الخادمُ ردّاً أم لا؟ **وردٌّ بحالةِ خطأٍ جوابٌ أيضاً**: معناه أنّ الشبكةَ
 * سالكةٌ وأنّ خدمتَنا تستجيب، وذاك ما يميّز «انقطاعَ شبكةٍ» من «خللٍ عندنا».
 * ولذلك `ApiError` تُقرأ `reachable` لا `unreachable`.
 */
export async function probeReachability(call: HealthCall = callHealth): Promise<ReachabilityProbe> {
  try {
    await call();
    return "reachable";
  } catch (thrown) {
    return thrown instanceof ApiError ? "reachable" : "unreachable";
  }
}

/**
 * ما يعلنه الجهازُ عن شبكتِه. `navigator.onLine` **إشارةٌ ضعيفةٌ في اتجاهٍ
 * واحدٍ**: `false` تعني بلا شبكةٍ يقيناً، و`true` لا تعني أنّ الإنترنتَ يعمل.
 * ولذلك تُقرأ لتأكيدِ الانقطاعِ فقط، ولا يُبنى عليها ادّعاءُ اتصال. وغيابُ
 * `navigator` (خارجَ المتصفّح) يُقرأ «متصلاً» فلا يُعلَن انقطاعٌ بلا دليل.
 */
export function deviceOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  const online = (navigator as { onLine?: unknown }).onLine;
  return typeof online === "boolean" ? online : true;
}
