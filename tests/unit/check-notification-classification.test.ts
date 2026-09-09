/**
 * الغرض: إثباتُ أنَّ حاجزَ تصنيفِ الإشعاراتِ (`F6-05` / `TG-002`) **يمسكُ الخرقَ
 *   فعلاً** ولا يكتفي بالمرورِ على مستودعٍ سليمٍ: خرقٌ مُصنَّعٌ لكلِّ قاعدةٍ
 *   يُرفَعُ، ومستودعٌ سليمٌ لا يُرفَع.
 * الحالة: اختبار فعلي — يستدعي دالّةَ الفحصِ مباشرةً بلا كتابةِ ملفّاتٍ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيُّ تعديلٍ على `scripts/check-notification-classification.ts`
 * ملاحظات مستقبلية: القواعدُ تُختبَرُ آلةً لا قائمةً: إضافةُ قاعدةٍ جديدةٍ تحتاجُ
 *   حالتَها الموجبةَ والسالبةَ ههنا.
 *
 * وحارسٌ لا يُختبَرُ سالباً حارسٌ مُدَّعىً: قد يمرُّ لأنَّ نمطَه لا يطابقُ شيئاً
 * أبداً، فتُقرأُ خُضرةُ CI أماناً وهيَ صمتٌ.
 */

import { describe, expect, it } from "bun:test";
import {
  type DeclaredClassification,
  findViolations,
  REPOSITORY_DECLARATION,
} from "../../scripts/check-notification-classification.ts";

/** هجراتٌ مُصنَّعةٌ: أقلُّ نصٍّ يُشبِعُ أنماطَ الحاجزِ، فلا يُختبَرُ المستودعُ بنفسِه. */
function migrations(options: {
  readonly constraintKinds?: readonly string[];
  readonly seededKinds?: readonly string[];
  readonly groupKinds?: readonly string[];
}): { readonly file: string; readonly sql: string }[] {
  const constraint = (options.constraintKinds ?? ["offer", "safety_incident"])
    .map((kind) => `'${kind}'`)
    .join(", ");
  const seeded = (options.seededKinds ?? ["offer", "safety_incident"])
    .map((kind) => `('${kind}', 'وصفٌ')`)
    .join(", ");
  const group = (options.groupKinds ?? ["safety_incident"]).map((kind) => `'${kind}'`).join(", ");

  return [
    {
      file: "20260101000000_base.sql",
      sql: `alter table notification_outbox add constraint notification_outbox_kind_check check (kind in (${constraint}));`,
    },
    {
      file: "20260909040000_f6_05_notification_classification_and_center.sql",
      sql: `
create or replace function notification_kind_is_group_addressed(p_kind text)
returns boolean language sql immutable as $$ select p_kind in (${group}) $$;

insert into notification_kind_policy (city_id, kind, channel, description_ar)
select c.id, k.kind, 'critical', k.description_ar
  from cities c
 cross join (values ${seeded}) as k(kind, description_ar);
`,
    },
  ];
}

const DECLARED: DeclaredClassification = {
  kinds: ["offer", "safety_incident"],
  channels: { offer: "critical", safety_incident: "critical" },
  groupAddressed: ["safety_incident"],
};

describe("حاجزُ تصنيفِ الإشعاراتِ: يمسكُ الخرقَ", () => {
  it("١) مستودعٌ متّسقٌ لا يُرفَعُ — شاهدٌ موجَبٌ يمنعُ حارساً يرفضُ كلَّ شيءٍ", () => {
    expect(findViolations(migrations({}), DECLARED)).toEqual([]);
  });

  it("٢) نوعٌ في قيدِ القاعدةِ بلا إعلانِ قناةٍ يُرفَعُ", () => {
    const violations = findViolations(
      migrations({
        constraintKinds: ["offer", "safety_incident", "subscription_notice"],
        seededKinds: ["offer", "safety_incident", "subscription_notice"],
      }),
      DECLARED,
    );
    expect(violations.some((entry) => entry.includes("subscription_notice"))).toBe(true);
  });

  it("٣) نوعٌ مُعلَنٌ لا وجودَ له في القيدِ يُرفَعُ — لا مُدخلَ ميّتٌ يُقرأُ تغطيةً", () => {
    const violations = findViolations(migrations({}), {
      ...DECLARED,
      kinds: [...DECLARED.kinds, "ghost_kind"],
      channels: { ...DECLARED.channels, ghost_kind: "critical" },
    });
    expect(violations.some((entry) => entry.includes("ghost_kind"))).toBe(true);
  });

  it("٤) نوعٌ في القيدِ بلا صفِّ بذرٍ يُرفَعُ", () => {
    const violations = findViolations(
      migrations({ constraintKinds: ["offer", "safety_incident"], seededKinds: ["offer"] }),
      DECLARED,
    );
    expect(
      violations.some((entry) => entry.includes("safety_incident") && entry.includes("بذر")),
    ).toBe(true);
  });

  it("٥) افتراقُ قائمةِ المُوجَّهِ إلى مجموعةٍ بينَ الكودِ والقاعدةِ يُرفَعُ في الاتّجاهَينِ", () => {
    const codeOnly = findViolations(migrations({ groupKinds: [] }), DECLARED);
    expect(codeOnly.some((entry) => entry.includes("افترقتا"))).toBe(true);

    const dbOnly = findViolations(migrations({}), { ...DECLARED, groupAddressed: [] });
    expect(dbOnly.some((entry) => entry.includes("افترقتا"))).toBe(true);
  });

  it("٦) نوعٌ مُوجَّهٌ إلى مجموعةٍ مُعلَنٌ `in_app` يُرفَعُ — الكتمُ إعدامٌ صامتٌ", () => {
    const violations = findViolations(migrations({}), {
      ...DECLARED,
      channels: { ...DECLARED.channels, safety_incident: "in_app" },
    });
    expect(violations.some((entry) => entry.includes("إعدامٌ صامتٌ"))).toBe(true);
  });

  it("٧) غيابُ القيدِ أو كتلةِ البذرِ يُرفَعُ ولا يُقرأُ نجاحاً", () => {
    // حاجزٌ لا يجدُ ما يقرؤه يجبُ أن يُخفِقَ لا أن يصمتَ: الصمتُ ههنا يُخفي
    // إعادةَ تسميةِ قيدٍ أو حذفَ بذرٍ بلا أثرٍ في CI.
    const empty = findViolations([{ file: "x.sql", sql: "select 1;" }], DECLARED);
    expect(empty.some((entry) => entry.includes("notification_outbox_kind_check"))).toBe(true);
    expect(empty.some((entry) => entry.includes("بذرِ السياسةِ"))).toBe(true);
  });
});

describe("حاجزُ تصنيفِ الإشعاراتِ: المستودعُ الحقيقيُّ", () => {
  it("٨) إعلانُ المستودعِ نفسُه متّسقٌ ولا نوعَ بلا قناةٍ", () => {
    for (const kind of REPOSITORY_DECLARATION.kinds) {
      expect(REPOSITORY_DECLARATION.channels[kind]).toBeDefined();
    }
    // كلُّ الأنواعِ `critical` اليومَ عمداً: لا شاشةَ `SS-07` بعدُ، وإعادةُ
    // التصنيفِ قبلَ وجودِ شاشةٍ إسكاتٌ لا تهدئةٌ.
    for (const kind of REPOSITORY_DECLARATION.kinds) {
      expect(REPOSITORY_DECLARATION.channels[kind]).toBe("critical");
    }
    expect(REPOSITORY_DECLARATION.groupAddressed).toEqual(["safety_incident"]);
  });
});
