/**
 * الغرض: مسارا حقَّي البيانةِ — `GET /v1/me/data-export` و
 *   `POST /v1/me/erasure` (`F2-11` · `SR-12` · §9.12).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-12` — المساران لا يذكرانِ دوراً.
 * الحاكم: docs/adr/0112-erasure-is-a-per-table-judgement-not-a-delete.md
 *
 * ## لماذا الحذفُ `POST` على مَورِدٍ اسمُه `erasure` لا `DELETE /v1/me`
 *
 * لأنَّ `DELETE /v1/me` كذبةٌ في العنوانِ نفسِه: الصفُّ **لا يُحذَفُ**، بل
 * يُجهَّلُ، وأحدَ عشرَ جدولاً تُحكَمُ كلٌّ بحكمِه. والفعلُ يُنشئُ **وثيقةً** —
 * إيصالاً يُعادُ في الجسمِ — وهذا إنشاءٌ لا حذفٌ. والقسم 10 يوجبُ
 * `Idempotency-Key` على الأوامرِ، و`DELETE` يُعادُ إرسالُه من وسيطٍ تلقائيّاً
 * بينما `POST` لا يُعادُ — وفعلٌ لا يُنقَضُ لا يُتركُ لاجتهادِ وسيطٍ.
 *
 * ## ولماذا لا يُنشَرُ رمزُ عطبِ التنزيلِ `404` بل `200` بـ`exported:false`
 *
 * لأنَّ `USER_NOT_FOUND` ههنا جوابٌ صحيحٌ: جلسةٌ سليمةٌ لحسابٍ لم يُنشَأْ صفُّه
 * بعدُ (القسم 9.8 خطوة 4). وهذه حالةٌ لا عطلٌ، والشاشةُ تقولُها بجملةٍ مفهومةٍ.
 *
 * ## وما لا يفعلُه هذانِ المساران عن قصدٍ
 *
 *   ــ **لا يقرآنِ معرّفاً من الطلبِ**: المعرّفُ من الرمزِ الموقَّعِ وحدَه.
 *   ــ **لا يُسجِّلانِ حمولةً**: سجلٌّ فيه حزمةُ تنزيلٍ نسخةٌ ثانيةٌ من كلِّ
 *      بيانةِ الإنسانِ في ملفِّ سجلٍّ لا يُحكَمُ عليه بحكمِ حذفٍ (ADR 0078).
 *   ــ **لا يضعانِ الحزمةَ في ملفٍّ على القرصِ**: تُعادُ في الجسمِ وتُحفَظُ في
 *      جهازِ صاحبِها — وملفٌّ على خادمِنا نسخةٌ ثالثةٌ تنجو من الحذفِ.
 */

import { type Context, Hono } from "hono";
import {
  type DataRightsDeps,
  type DataRightsPublicErrorCode,
  eraseMyAccount,
  exportMyData,
} from "../../../../packages/application/privacy/data-rights.ts";
import { dataExportFileName } from "../../../../packages/domain/privacy/data-rights.ts";

export interface DataRightsRouteDependencies {
  /** غيابُها **يعطّلُ المسارَينِ بـ503** ولا يجعلهما يجيبانِ بلا تحقّقٍ. */
  readonly dataRights?: DataRightsDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** خريطةُ الحالاتِ — **شاملةٌ حرفاً** لاتّحادِ رموزِ الطبقةِ. */
const STATUS_BY_ERROR: Readonly<Record<DataRightsPublicErrorCode, 401 | 422 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  PRIVACY_STORE_NOT_AVAILABLE: 503,
  // طلبٌ مفهومٌ وشرطُه غيرُ مستوفًى — لا عطبُ صياغةٍ (`400`) ولا منعُ صلاحيةٍ.
  CONFIRMATION_REQUIRED: 422,
};

function rejected(c: Context, error: DataRightsPublicErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_ERROR[error]);
}

function bearerTokenFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

/** حدُّ حجمِ جسمِ التأكيدِ — كلمةٌ واحدةٌ، فلا يُقرأُ ميغابايتٌ لأجلِها. */
const MAX_CONFIRMATION_BODY_BYTES = 256;

async function readConfirmation(c: Context): Promise<string | undefined> {
  const raw = await c.req.text();
  if (raw.length === 0 || raw.length > MAX_CONFIRMATION_BODY_BYTES) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const value = (parsed as Record<string, unknown>).confirmation;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function createDataRightsRoutes(deps: DataRightsRouteDependencies): Hono {
  const app = new Hono();

  /** «نزِّلْ بياناتي». قراءةٌ واحدةٌ تحملُ الحزمةَ كلَّها في لحظةٍ واحدةٍ. */
  app.get("/v1/me/data-export", async (c) => {
    if (deps.dataRights === undefined) {
      deps.log?.("privacy.export_disabled", {});
      return rejected(c, "PRIVACY_STORE_NOT_AVAILABLE");
    }

    const result = await exportMyData(deps.dataRights, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
    });
    if (!result.ok) return rejected(c, result.error);

    const verdict = result.value;
    if (!verdict.exported) {
      return c.json({ ok: true, exported: false as const, refusal: verdict.refusal });
    }
    return c.json({
      ok: true,
      exported: true as const,
      // اسمُ الملفِّ يُبنى في المجالِ لا في الواجهةِ: موضعٌ واحدٌ يضمنُ أنَّه
      // يبقى بلا اسمٍ ولا رقمٍ مهما تعدَّدَت الشاشاتُ التي تُنزِّلُه.
      fileName: dataExportFileName(verdict.bundle.exportedAt),
      bundle: verdict.bundle,
    });
  });

  /**
   * «احذفْ حسابي». **فعلٌ لا يُنقَضُ**، فشرطُه كلمةُ تأكيدٍ مكتوبةٌ يُقابِلُها
   * الخادمُ — لا ضغطةٌ ثانيةٌ في الواجهةِ وحدَها.
   */
  app.post("/v1/me/erasure", async (c) => {
    if (deps.dataRights === undefined) {
      deps.log?.("privacy.erasure_disabled", {});
      return rejected(c, "PRIVACY_STORE_NOT_AVAILABLE");
    }

    const result = await eraseMyAccount(deps.dataRights, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      confirmation: await readConfirmation(c),
    });
    if (!result.ok) return rejected(c, result.error);

    const outcome = result.value;
    if (!outcome.erased) {
      return c.json({
        ok: true,
        erased: false as const,
        refusal: outcome.refusal,
        activeOrders: outcome.activeOrders,
      });
    }
    return c.json({
      ok: true,
      erased: true as const,
      erasedAt: outcome.erasedAt,
      receipt: outcome.receipt,
    });
  });

  return app;
}
