/**
 * الغرض: تثبيت حقيقةٍ تشغيليّة لا يكشفها أي اختبار سلوك — **بوت السائق وحده هو من
 *   ينشر في قروبات السائقين** (التفاوض، الإسناد، الإسناد المتصاعد، بطاقة الدعم)،
 *   و**بوت الراكب لا يحتاج عضوية في أي قروب**.
 *
 *   ولمَ اختبارٌ لا تقريرٌ؟ لأن خرق هذه القاعدة لا يُسقط شيئاً في CI: لو رُبط ناشرٌ
 *   بمُرسِل بوت الراكب، فالكود يترجم ويمرّ كل اختبار، ثم يفشل في الإنتاج وحده
 *   بخطأ «bot is not a member of the group chat» — أو أسوأ: ينشر البطاقة فعلاً
 *   إن كان الراكب مضافاً سهواً، فتُضغط أزرارها ولا يستلم الضغطةَ بوتٌ يعرفها،
 *   لأن `callback_query` يعود إلى البوت الذي نشر الرسالة لا إلى غيره. فتجمد
 *   بطاقةُ إسنادٍ في قروب السائقين بلا مُستجيب، وهذا ما لا يُكتشف إلّا بشكوى.
 *
 *   ولمَ فحصُ نصّ الربط لا سلوكِ الناشر؟ لأن الناشر نفسه سليم أيّاً كان مُرسِله —
 *   يكتب في المعرّف الذي يُعطى له. الخطأ الممكن هو في **موضع الربط** وحده، فهو
 *   موضع الفحص. والاختبار يفشل أيضاً إن أُضيف ناشرُ قروبٍ جديد لم يُسجَّل هنا،
 *   فلا يمرّ ناشرٌ رابعٌ صامتاً بمُرسِلٍ لم يُراجَع.
 *
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على container.ts أو negotiation-wiring.ts
 * ملاحظات مستقبلية: لو صار للمنصّة بوت ثالث يملك قروباً خاصّاً به، يُضاف مُرسِله
 *   إلى `GROUP_CAPABLE_SENDERS` مع ناشره، ويبقى `riderSender` ممنوعاً كما هو.
 */

import { describe, expect, test } from "bun:test";

/** ملفّات الربط الوحيدة التي تُنشئ ناشري القروبات. */
const WIRING_FILES = [
  "apps/gateway/src/container.ts",
  "apps/workers/src/container.ts",
  "packages/infrastructure/dispatch/negotiation-wiring.ts",
] as const;

/**
 * كل مصنع ناشرٍ يكتب في **قروب**. الفارق عن `createTicketOwnerNotifier` جوهري:
 * ذاك يخاطب صاحب التذكرة في محادثته الخاصّة، فيجب أن يمرّ بمُرسِل بوته هو —
 * ولذلك هو خارج هذه القائمة عن قصد لا سهواً.
 */
const GROUP_PUBLISHER_FACTORIES = [
  "createUnsubscribedGroupPublisher",
  "createEscalationGroupPublisher",
  "createSupportCardPublisher",
  "createSupportAdvicePublisher",
] as const;

/** أسماء المُرسِلات المسموح لها بالنشر في قروب — كلها مشتقّة من بوت السائق. */
const GROUP_CAPABLE_SENDERS = [
  "driverSender",
  "supportSender",
  "senders.identifyingDriver",
] as const;

/** نصّ ما بين قوسي أول نداء لدالّة باسمها، في كل مواضع ندائها. */
function callArguments(source: string, factory: string): readonly string[] {
  const calls: string[] = [];
  let index = source.indexOf(`${factory}(`);
  while (index !== -1) {
    const start = index + factory.length + 1;
    let depth = 1;
    let cursor = start;
    while (cursor < source.length && depth > 0) {
      const char = source[cursor];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      cursor += 1;
    }
    calls.push(source.slice(start, cursor - 1));
    index = source.indexOf(`${factory}(`, cursor);
  }
  return calls;
}

const sources = new Map<string, string>();
for (const file of WIRING_FILES) {
  sources.set(file, await Bun.file(`${import.meta.dir}/../../${file}`).text());
}

describe("البند 6.2 — بوت السائق وحده ينشر في القروبات", () => {
  test("كل ملفّات الربط قُرئت فعلاً — لا يمرّ الاختبار على ملفّ مفقود", () => {
    for (const file of WIRING_FILES) {
      expect((sources.get(file) ?? "").length).toBeGreaterThan(100);
    }
  });

  test("كل ناشر قروب مربوطٌ بمُرسِل بوت السائق، ولا واحد بمُرسِل الراكب", () => {
    let wired = 0;
    for (const [file, source] of sources) {
      for (const factory of GROUP_PUBLISHER_FACTORIES) {
        for (const argument of callArguments(source, factory)) {
          wired += 1;
          const allowed = GROUP_CAPABLE_SENDERS.some((sender) => argument.includes(sender));
          // الرسالة تسمّي الملفّ والمصنع لأن الفشل هنا يعني خطأ ربطٍ في الإنتاج
          expect(allowed, `${file} → ${factory}(${argument})`).toBe(true);
          expect(argument).not.toContain("riderSender");
          expect(argument).not.toContain("riderOut");
          expect(argument).not.toContain("identifyingRider");
        }
      }
    }
    // ولا يجوز أن يمرّ الاختبار لأن أحداً حذف الربط كلّه أو أعاد تسميته
    expect(wired).toBeGreaterThanOrEqual(GROUP_PUBLISHER_FACTORIES.length);
  });

  test("لا ناشر قروبٍ رابعٍ مربوطٌ بلا مراجعة في هذا الاختبار", () => {
    // أي `create…GroupPublisher` يظهر في ملفّ ربطٍ ولم يُسجَّل أعلاه يُسقط الاختبار
    for (const source of sources.values()) {
      for (const match of source.matchAll(/create(\w*Group\w*Publisher)\s*\(/g)) {
        const name = `create${match[1] ?? ""}`;
        expect(GROUP_PUBLISHER_FACTORIES as readonly string[]).toContain(name);
      }
    }
  });

  test("تبليغ صاحب التذكرة يبقى بمُرسِل بوته هو — لا يُجرّ إلى قاعدة القروبات", () => {
    // القاعدة «بوت السائق ينشر» تخصّ القروب وحده؛ رسالةٌ خاصّة إلى راكبٍ يجب أن
    // تصله من البوت الذي يحاوره، وإلّا وصلته من بوتٍ لم يبدأ معه محادثة أصلاً.
    // ومنذ توحيدِ صندوقِ الصادرِ (BUG-004) صار موضعُ الربطِ عاملَ التسليمِ لا
    // البوابةَ — والقاعدةُ نفسُها تبقى: مُرسِلانِ لا واحد، واحدٌ لكلّ بوت.
    const notifiers = [...sources.values()].flatMap((source) =>
      callArguments(source, "createTicketOwnerNotifier"),
    );
    expect(notifiers).toHaveLength(2);
    expect(notifiers.some((argument) => argument.includes("riderTelegram"))).toBe(true);
    // مُرسِلٌ واحدٌ على الأقلِّ مبنيٌّ على `telegram` (بوتِ السائقِ) **لا** على
    // `riderTelegram`. وهذا أقوى من مطابقةِ النصِّ `(telegram)` حرفيّاً: الوسمُ
    // بأولويّةِ المرورِ (`F6-07`) يُدخِلُ غلافاً بينَ الاثنَينِ، والقاعدةُ المحميّةُ
    // ليست شكلَ النداءِ بل أن يكونَ لكلِّ جمهورٍ بوتُه.
    expect(
      notifiers.some(
        (argument) => /\btelegram\b/.test(argument) && !argument.includes("riderTelegram"),
      ),
    ).toBe(true);
  });
});
