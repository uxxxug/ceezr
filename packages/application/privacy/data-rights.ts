/**
 * الغرض: حالتا استخدامِ حقَّي البيانةِ من التطبيقِ المصغَّرِ (`F2-11` ·
 *   `SR-12` · §9.12) — تنزيلُ ما لديَّ عنكَ، ومحوُ ما يجوزُ محوُه.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`.
 * ينتمي إلى: packages/application/privacy
 * يُستخدم من: `apps/gateway/src/routes/me-data-rights.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-12` — الدورُ لا يُذكَرُ في هذه الطبقةِ.
 * الحاكم: docs/adr/0112-erasure-is-a-per-table-judgement-not-a-delete.md
 *
 * ## لماذا **تأكيدٌ نصِّيٌّ** شرطاً في طبقةِ التطبيقِ لا في الواجهةِ وحدَها
 *
 * حذفُ الحسابِ فعلٌ لا يُنقَضُ. ونافذةُ «أمتأكّدُ؟» في الواجهةِ حاجزٌ يُتجاوَزُ
 * بنداءٍ مباشرٍ للمسارِ، وبضغطةٍ مزدوجةٍ، وبزرٍّ يقعُ تحتَ الإبهامِ. فالشرطُ
 * ههنا: **يكتبُ المستخدمُ كلمةً بعينِها** يُقابِلُها الخادمُ حرفاً. وهذا يجعلُ
 * الحذفَ فعلاً مقصوداً في الطبقةِ التي لا تُتجاوَزُ، لا في التي تُتجاوَزُ.
 * والكلمةُ تأتي من الواجهةِ بلغةِ المستخدمِ، فالمقابلةُ على **مجالٍ مغلقٍ من
 * ثلاثِ كلماتٍ** — لا على نصٍّ عربيٍّ مكتوبٍ في الخادمِ يُعجِزُ من لا يقرؤه.
 *
 * ## وما لا تفعلُه هاتانِ الحالتانِ عن قصدٍ
 *
 *   ــ **لا تُرسِلانِ بريداً ولا رسالةً**: الإيصالُ يُعرَضُ ويُنزَّلُ في
 *      اللحظةِ. وإرسالُه إلى حسابِ تيليجرامَ الذي **حُذِفَ لتوِّه** إرسالٌ إلى
 *      عنوانٍ أقسَمنا أنَّنا محوناه.
 *   ــ **لا تُنشئانِ جدولَ طلباتٍ ولا طابوراً**: المحوُ يقعُ في المعاملةِ نفسِها
 *      (القاعدة 0.6) — وطابورٌ يعني نافذةَ وقتٍ يبقى فيها ما وُعِدَ بمحوِه.
 *   ــ **لا تُقرِّرانِ ما يُمحى**: القرارُ في `erasure-policy.ts` وفي الهجرةِ،
 *      وتكرارُه ههنا مصدرُ حقيقةٍ ثانٍ يومَ يُضافُ جدولٌ.
 */

import type { ErasureOutcome } from "../../domain/privacy/data-rights.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import {
  type ErasureChatMediaPurgeDeps,
  type ErasureChatMediaPurgeReport,
  purgeErasureChatMedia,
} from "./erasure-media-purge.ts";
import type { DataRightsStore, ExportVerdict } from "./ports.ts";

export type DataRightsPublicErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_EXPIRED"
  | "SESSION_INVALID"
  | "SESSION_NOT_AVAILABLE"
  | "PRIVACY_STORE_NOT_AVAILABLE"
  | "CONFIRMATION_REQUIRED";

/**
 * كلماتُ التأكيدِ المقبولةُ — واحدةٌ لكلِّ لغةٍ من لغاتِ المنصّةِ الثلاثِ.
 * **مجالٌ مغلقٌ**: لا تُقبَلُ ترجمةٌ مرتجَلةٌ، ولا تُقبَلُ `yes`.
 */
export const ERASURE_CONFIRMATION_WORDS: readonly string[] = ["حذف", "DELETE", "ڈیلیٹ"];

/** المقابلةُ حرفيّةٌ بعدَ قصِّ الفراغِ وحدَه — لا تخشينَ ولا تطبيعَ. */
export function isErasureConfirmed(word: string | undefined): boolean {
  if (typeof word !== "string") return false;
  return ERASURE_CONFIRMATION_WORDS.includes(word.trim());
}

function sessionErrorFrom(reason: string): DataRightsPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

export interface DataRightsDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: DataRightsStore;
  readonly now: () => Date;
  /**
   * `WR-39` (قرارُ المالكِ): محوُ ملفّاتِ محادثةِ الحسابِ فورًا بعدَ إتمامِ
   * المحوِ. **غيابُهُ لا يعطِّلُ المحوَ**: الحسابُ يُمحى، والوسائطُ — إن وُجدتْ —
   * تُلتقَطُ بالمكنسةِ الدوريّةِ، ويُقالُ `unavailable` صريحةً في الحالِ.
   */
  readonly mediaPurge?: ErasureChatMediaPurgeDeps;
}

async function openSession(
  deps: DataRightsDeps,
  accessToken: string | undefined,
): Promise<Result<string, DataRightsPublicErrorCode>> {
  if (accessToken === undefined || accessToken.length === 0) return err("SESSION_REQUIRED");
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(sessionErrorFrom(session.error.reason));
  return ok(session.value.telegramUserId);
}

export async function exportMyData(
  deps: DataRightsDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<ExportVerdict, DataRightsPublicErrorCode>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const read = await deps.store.exportMyData({ telegramUserId: session.value });
  if (!read.ok) return err("PRIVACY_STORE_NOT_AVAILABLE");
  return ok(read.value);
}

export async function eraseMyAccount(
  deps: DataRightsDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly confirmation: string | undefined;
  },
): Promise<Result<ErasureOutcome, DataRightsPublicErrorCode>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  // **الترتيبُ مقصودٌ**: جلسةٌ ثمَّ تأكيدٌ ثمَّ كتابةٌ. ولا يُمَسُّ صفٌّ واحدٌ
  // قبلَ اكتمالِ الشرطَينِ — فالفعلُ لا يُنقَضُ.
  if (!isErasureConfirmed(input.confirmation)) return err("CONFIRMATION_REQUIRED");

  const erased = await deps.store.eraseMyAccount({ telegramUserId: session.value });
  if (!erased.ok) return err("PRIVACY_STORE_NOT_AVAILABLE");
  if (!erased.value.erased) return ok(erased.value);

  // ── WR-39: المحوُ الفوريُّ للوسائطِ — بعدَ الإتمامِ لا قبلهُ ──────────────
  // الحسابُ محوٌّ الآنَ مهما حدثَ بعدَهُ: فشلُ المحوِ الفوريِّ **لا يُفشِلُ
  // الاستجابةَ ولا يُسقِطُ الوسائطَ** — الصفوفُ باقيةٌ والمكنسةُ الدوريّةُ
  // تلتقطُها، والحالُ يُقالُ صريحًا (`deferred`) لا يُدَّعى نجاحٌ.
  const outcome = erased.value;

  // `try` ههنا ليستِ تسامحًا معَ الخطأِ بل صدقًا معَ الفعلِ: المحوُ وقعَ، وكلُّ
  // ما قد يحدثَ بعدهُ (حتى استثناءٌ في الالتقاطِ) لا يُفشِلُ الاستجابةَ — بل
  // يُقالُ `deferred` وتُلتقَطُ الوسائطُ بالمكنسةِ أو بطلبٍّ تالٍ.
  let purgeReport: ErasureChatMediaPurgeReport | null = null;
  if (deps.mediaPurge !== undefined && outcome.erasureUserId !== null) {
    try {
      const report = await purgeErasureChatMedia(deps.mediaPurge, outcome.erasureUserId);
      purgeReport = report.ok ? report.value : { purged: 0, deferred: true };
    } catch {
      purgeReport = { purged: 0, deferred: true };
    }
  }
  const purgeStatus =
    purgeReport === null
      ? { status: "unavailable" as const, attachments: 0 }
      : purgeReport.deferred
        ? { status: "deferred" as const, attachments: purgeReport.purged }
        : { status: "purged" as const, attachments: purgeReport.purged };
  return ok({ ...outcome, mediaPurge: purgeStatus });
}
