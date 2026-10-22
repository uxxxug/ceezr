/**
 * `LOAD-01` (الدفعةُ 32) — نطاقُ «المسارِ» لأثرِ الحِملِ التشخيصيِّ: مُعطَّلٌ افتراضيّاً.
 *
 * أثرُ `rsig` القديمُ ينسبُ الاستعلامَ إلى مسارِ HTTP الذي **ورثَ** سياقَه؛ والدرينرُ يُوقَظُ من
 * داخلِ طلبِ الويبهوك (`wakeDrainerOnEnqueue`) فترثُ أشواطُه ووظائفُه مسارَ الويبهوك. هذا النطاقُ
 * مستقلٌّ عنه (فلا تتغيّرُ أرقامُ `rsig` بين الدفعات): كلُّ مسارِ خلفيّةٍ يُعلِنُ نفسَه صراحةً
 * (`drainer:sweep` · `drainer:job:<bot>:<نوع>` · `drainer:replies` · `redispatch:immediate`)
 * فيَحجُبُ ما ورثَه، ولكلِّ نطاقٍ عدّادٌ تراكميٌّ لانتظارِ مقعدِ البوّابةِ واحتجازِه وعددِ مرّاتِه.
 *
 * بلا تفعيلٍ (`enableLoadPathScope`) تُنفِّذُ `withLoadPath` الدالّةَ مباشرةً ولا تُنشئُ شيئاً:
 * لا سلوكٌ يتغيّرُ ولا كلفة. ولا يحملُ النطاقُ إلّا تسميةً ثابتةً وأرقاماً — لا حمولةً ولا معرّفاً.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** ما يُراكَمُ لكلِّ نطاقٍ: انتظارُ مقعدِ البوّابة، واحتجازُه، وعددُ الحجوزات (استعلامٌ أو معاملة). */
export interface GateAccumulator {
  waitMs: number;
  holdMs: number;
  acquisitions: number;
}

export interface LoadPathStore {
  readonly path: string;
  readonly gate: GateAccumulator;
}

let scope: AsyncLocalStorage<LoadPathStore> | null = null;

/** يُفعِّلُ النطاقَ (من `createLoadTrace` وحدَه) أو يُعطِّلُه (`false`). */
export function enableLoadPathScope(on: boolean): void {
  scope = on ? new AsyncLocalStorage<LoadPathStore>() : null;
}

/** يُشغِّلُ `fn` داخلَ نطاقِ مسارٍ جديدٍ بعدّادٍ صفريٍّ — يَحجُبُ أيَّ نطاقٍ موروث. */
export function withLoadPath<T>(path: string, fn: () => T): T {
  if (scope === null) return fn();
  return scope.run({ path, gate: { waitMs: 0, holdMs: 0, acquisitions: 0 } }, fn);
}

/** النطاقُ الجاري أو `undefined` (معطَّلٌ، أو لا نطاقَ مُعلَن). */
export function currentLoadPath(): LoadPathStore | undefined {
  return scope?.getStore();
}

/**
 * نوعُ تحديثِ تيليجرام لتسميةِ النطاق — من مفاتيحِ الحمولةِ وحدَها، لا من محتواها:
 * `contact` (إثباتُ الهاتف) · `callback` · `command` (نصٌّ يبدأُ بـ`/`) · `message` · `other`.
 */
export function telegramUpdateKind(payload: unknown): string {
  if (payload === null || typeof payload !== "object") return "other";
  const p = payload as {
    message?: { contact?: unknown; text?: unknown };
    callback_query?: unknown;
  };
  if (p.callback_query !== undefined) return "callback";
  if (p.message === undefined || p.message === null) return "other";
  if (p.message.contact !== undefined && p.message.contact !== null) return "contact";
  if (typeof p.message.text === "string" && p.message.text.startsWith("/")) return "command";
  return "message";
}
