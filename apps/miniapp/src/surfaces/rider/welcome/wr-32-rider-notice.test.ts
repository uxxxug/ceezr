/**
 * الغرض: `WR-32` في الواجهةِ — رسالةُ خصوصيّةِ الراكبِ وسمعتِه: صفُّها «رسالةُ اطّلاعٍ»
 *   بحالاتٍ تُقالُ بلغتِها، و«الراكبُ العائدُ» (لم يبقَ له إلّا الرسالةُ) يُعرَفُ فيُعرَضُ
 *   له فعلٌ واحدٌ بلا إعادةِ تسجيلٍ، وخادمٌ أقدمُ بلا `presentation` يبقى كما كان،
 *   والشاشةُ تعرضُ نصَّ الرسالةِ كاملاً مفتوحاً، ومفاتيحُها موجودةٌ في اللغاتِ الثلاثِ.
 * الحالة: اختبار فعلي — دوالُّ نقيّةٌ وقراءةُ مصدرٍ، بلا DOM ولا شبكةٍ.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/welcome
 * يُتوقع أن يستخدمه لاحقاً: CI
 */

import { describe, expect, it } from "bun:test";
import ar from "../../../../../../packages/shared/i18n/miniapp/ar.json" with { type: "json" };
import en from "../../../../../../packages/shared/i18n/miniapp/en.json" with { type: "json" };
import ur from "../../../../../../packages/shared/i18n/miniapp/ur.json" with { type: "json" };
import { type ConsentApiStatus, consentRows, noticeOnly, outstandingRows } from "./consent-view.ts";

const SOURCE = await Bun.file(new URL("./WelcomeScreen.tsx", import.meta.url)).text();

const doc = (kind: string, version: string, presentation?: string) => ({
  kind,
  version,
  titleKey: `consent.${kind}.title`,
  summaryKey: `consent.${kind}.summary`,
  textKey: `consent.${kind}.${version}.text`,
  requiredForOnboarding: true,
  ...(presentation === undefined ? {} : { presentation }),
});

const TERMS = doc("terms_of_service", "2026-09-12", "document");
const PRIVACY = doc("privacy_policy", "2026-10-13", "document");
const NOTICE = doc("rider_privacy_notice", "2026-11-04", "notice");

type State = "missing" | "satisfied" | "superseded";
function status(states: Readonly<Record<string, State>>, documents = [TERMS, PRIVACY, NOTICE]) {
  const onboarding = documents.map((d) => ({
    kind: d.kind,
    currentVersion: d.version,
    state: states[d.kind] ?? "missing",
  }));
  return {
    ok: true,
    documents,
    onboarding: {
      satisfied: onboarding.every((d) => d.state === "satisfied"),
      documents: onboarding,
    },
  } as ConsentApiStatus;
}

describe("WR-32 — نموذجُ عرضِ رسالةِ الراكبِ", () => {
  it("راكبٌ جديدٌ: الرسالةُ صفٌّ «اطّلاعٍ» معلّقٌ مع الوثيقتينِ — ليسَ «عائداً»", () => {
    const rows = consentRows(status({}));
    const notice = rows.find((r) => r.kind === NOTICE.kind);
    expect(notice?.notice).toBe(true);
    expect(notice?.statusKey).toBe("welcome.notice_pending");
    expect(rows.filter((r) => r.notice).length).toBe(1);
    expect(outstandingRows(rows).length).toBe(3);
    expect(noticeOnly(rows)).toBe(false);
  });

  it("راكبٌ مسجَّلٌ قبلَ الرسالةِ: الرسالةُ وحدَها معلّقةٌ ⇒ فعلٌ واحدٌ بلا إعادةِ تسجيلٍ", () => {
    const rows = consentRows(
      status({ terms_of_service: "satisfied", privacy_policy: "satisfied" }),
    );
    expect(outstandingRows(rows).map((r) => r.kind)).toEqual([NOTICE.kind]);
    expect(noticeOnly(rows)).toBe(true);
  });

  it("إصدارٌ جديدٌ للرسالةِ: `superseded` يُقالُ بلغةِ الرسالةِ ويعيدُها مرّةً", () => {
    const rows = consentRows(
      status({
        terms_of_service: "satisfied",
        privacy_policy: "satisfied",
        rider_privacy_notice: "superseded",
      }),
    );
    expect(rows.find((r) => r.notice)?.statusKey).toBe("welcome.notice_superseded");
    expect(noticeOnly(rows)).toBe(true);
  });

  it("بعدَ الإقرارِ: لا شيءَ معلّقٌ فلا تتكرّرُ", () => {
    const rows = consentRows(
      status({
        terms_of_service: "satisfied",
        privacy_policy: "satisfied",
        rider_privacy_notice: "satisfied",
      }),
    );
    expect(outstandingRows(rows)).toEqual([]);
    expect(noticeOnly(rows)).toBe(false);
    expect(rows.find((r) => r.notice)?.statusKey).toBe("welcome.notice_acknowledged");
  });

  it("وثيقةٌ معلّقةٌ مع الرسالةِ ⇒ ليسَ «عائداً»: لا تُطوى موافقةٌ قانونيّةٌ في فعلِ اطّلاعٍ", () => {
    const rows = consentRows(
      status({ terms_of_service: "satisfied", privacy_policy: "superseded" }),
    );
    expect(noticeOnly(rows)).toBe(false);
  });

  it("خادمٌ أقدمُ بلا `presentation`: كلُّ صفٍّ وثيقةٌ كما كان", () => {
    const legacy = [doc("terms_of_service", "2026-09-12"), doc("privacy_policy", "2026-10-13")];
    const rows = consentRows(status({}, legacy));
    expect(rows.every((r) => !r.notice)).toBe(true);
    expect(rows.map((r) => r.statusKey)).toEqual([
      "welcome.consent_pending",
      "welcome.consent_pending",
    ]);
  });
});

describe("WR-32 — شاشةُ الترحيبِ تعرضُ الرسالةَ", () => {
  it("نصُّ الرسالةِ يُعرَضُ كاملاً مفتوحاً في `wc__notice-body`", () => {
    expect(SOURCE).toContain('<div className="wc__notice-body">{t(row.textKey)}</div>');
    expect(SOURCE).toContain('className="wc__notice"');
  });

  it("الراكبُ العائدُ: زرُّ «اطّلعتُ» وتلميحُ العائدِ، والجديدُ «أوافقُ على الكلِّ»", () => {
    expect(SOURCE).toContain('t("welcome.notice_ack")');
    expect(SOURCE).toContain('t("welcome.notice_returning_hint")');
    expect(SOURCE).toContain('t("welcome.accept_all")');
  });

  it("المفاتيحُ موجودةٌ بقيمةٍ غيرِ فارغةٍ في العربيّةِ والإنجليزيّةِ والأورديّةِ", () => {
    const keys = [
      "consent.rider_privacy_notice.title",
      "consent.rider_privacy_notice.summary",
      "consent.rider_privacy_notice.2026-11-03.text",
      "consent.rider_privacy_notice.2026-11-04.text",
      "welcome.notice_pending",
      "welcome.notice_acknowledged",
      "welcome.notice_superseded",
      "welcome.notice_ack",
      "welcome.notice_ack_note",
      "welcome.notice_returning_hint",
    ];
    for (const dict of [ar, en, ur] as Record<string, unknown>[]) {
      for (const key of keys) {
        const value = dict[key];
        expect(typeof value === "string" && value.trim().length > 0, key).toBe(true);
      }
    }
  });

  it("النصُّ العربيُّ يَعِدُ بما يطابقُ النظامَ: رقمُك لا يظهرُ للسائقين", () => {
    const text = (ar as Record<string, string>)["consent.rider_privacy_notice.2026-11-04.text"];
    expect(text).toContain("رقم جوالك");
    expect(text).toContain("لا يظهر للسائقين");
  });
});

describe("WR-37 — العبارةُ القانونيّةُ مطابقةٌ لسياسةِ الخصوصيّةِ", () => {
  const KEY = "consent.rider_privacy_notice.2026-11-04.text";

  // العبارةُ المعتمَدةُ من نصِّ السياسةِ (2026-10-13) حرفاً في كلِّ لغةٍ
  const APPROVED: Record<"ar" | "en" | "ur", string> = {
    ar: "إلا بموافقتك أو بأمر قضائي",
    en: "except with your consent or by court order",
    ur: "آپ کی رضامندی یا عدالتی حکم",
  };
  // الصياغةُ القديمةُ المرفوضةُ (وعدٌ بالغٍ «ما يُلزمنا به النظام») — ممنوعٌ عودتُها
  const REJECTED: Record<"ar" | "en" | "ur", string> = {
    ar: "في حدود ما يُلزمنا",
    en: "as far as the law requires",
    ur: "جتنا قانون ہم پر لازم",
  };

  it.each([
    ["ar", ar],
    ["en", en],
    ["ur", ur],
  ] as [keyof typeof APPROVED, Record<string, unknown>][])(
    "الرسالةُ (%s) تحملُ العبارةَ المعتمَدةَ ولا تحملُ المرفوضةَ",
    (_lang, dict) => {
      const text = (dict as Record<string, string>)[KEY];
      expect(text).toContain(APPROVED[_lang]);
      expect(text).not.toContain(REJECTED[_lang]);
    },
  );

  it("عبارةُ البوتِ (`rider.privacy_notice`) تحملُ العبارةَ المعتمَدةَ ولا القديمةَ في اللغاتِ الثلاثِ", async () => {
    const { translate } = await import("../../../../../../packages/shared/i18n/index.ts");
    for (const lang of ["ar", "en", "ur"] as const) {
      const text = translate(lang, "rider.privacy_notice");
      expect(text).toContain(APPROVED[lang]);
      expect(text).not.toContain(REJECTED[lang]);
    }
  });
});
