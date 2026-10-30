/**
 * الغرض: إشارةُ القناةِ الآنيةِ الداخليّةُ إلى **كلِّ** نسخِ البوّابةِ — تمهيدُ تعدُّدِ النسخِ
 *   (قرارُ المالكِ 2026-10-30: قياسُ نسختَين وثلاثٍ لبلوغِ 5,000 مستخدم).
 * الحالة: منفَّذٌ فعليّاً.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: `offer-board-delivery.ts` و`rider-trip-app-delivery.ts`.
 *
 * ## لماذا البثُّ إلى الكلّ
 *
 * غرفُ Socket.IO محلّيّةٌ لكلِّ نسخةٍ (`adapter.rooms`). مع نسختَين خلفَ موزِّعٍ تصلُ الإشارةُ
 * نسخةً عشوائيّةً، فإن لم يكن السائقُ/الراكبُ متّصلًا بها عادت `emitted: false` وذهبَ الحدثُ
 * إلى بطاقةِ تيليجرامَ وهو متّصلٌ فعلًا بالنسخةِ الأخرى. فالعاملُ يُشيرُ إلى كلِّ نسخةٍ
 * بعنوانِها المباشرِ، والمآلُ «بُثَّ» إن بثّتْه نسخةٌ واحدةٌ على الأقلّ — ولا يتغيّرُ شيءٌ
 * لنسخةٍ واحدة (عنوانٌ واحدٌ ⇒ نداءٌ واحدٌ كما كان).
 *
 * فشلُ نسخةٍ أو بطؤُها لا يُفشلُ الإشارةَ ما دامت أخرى بثّت؛ وفشلُ الكلِّ = «لم تُبَثّ»
 * فتنالُ البطاقةُ فرصتها — لا فشلَ صفّ.
 */

type SignalFetch = (url: string, init: RequestInit) => Promise<Response>;

/** يُطبِّعُ عنوانًا واحدًا أو قائمةً إلى قائمةٍ بلا فراغات (الغيابُ = قائمةٌ فارغة). */
export function signalTargets(value: string | readonly string[] | null): readonly string[] {
  if (value === null) return [];
  const list = typeof value === "string" ? [value] : value;
  return list.filter((url) => url.length > 0);
}

export interface FanoutSignalInput {
  readonly fetch: SignalFetch;
  readonly targets: readonly string[];
  readonly path: string;
  readonly secret: string;
  readonly body: unknown;
  readonly timeoutMs: number;
  readonly onRejected?: (status: number) => void;
}

/** يُرسلُ الإشارةَ إلى كلِّ الأهدافِ معًا؛ `true` إن أعلنت واحدةٌ منها `emitted`. */
export async function fanoutSignal(input: FanoutSignalInput): Promise<boolean> {
  if (input.targets.length === 0) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const payload = JSON.stringify(input.body);
  try {
    const results = await Promise.all(
      input.targets.map(async (target) => {
        try {
          const response = await input.fetch(`${target}${input.path}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-internal-secret": input.secret,
            },
            body: payload,
            signal: controller.signal,
          });
          if (!response.ok) {
            input.onRejected?.(response.status);
            return false;
          }
          const parsed = (await response.json().catch(() => null)) as { emitted?: boolean } | null;
          return parsed?.emitted === true;
        } catch {
          return false;
        }
      }),
    );
    return results.some((emitted) => emitted);
  } finally {
    clearTimeout(timer);
  }
}
