/**
 * الغرض: قياسُ حاجزِ سجلِّ الحذفِ — **حالةٌ سلبيّةٌ مبذورةٌ لكلِّ قاعدةٍ من
 *   الثمانِ** (`ح-7`: قاعدةٌ بلا حالةٍ سلبيّةٍ غيرُ مُنفَذةٍ).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ولماذا تُقاسُ مدخلاتٌ مصنوعةٌ والمستودعُ معاً: سابقةُ
 * `check-sos-surface-contract.test.ts` حرفاً — المستودعُ اليومَ نظيفٌ، فلو
 * قِيسَ وحدَه لَنجحَ الاختبارُ ولو كانَ الحاجزُ لا يفحصُ شيئاً. **والحاجزُ
 * الذي لم يُرَ ساقطاً مرّةً لا يُعرَفُ أنَّه يقفُ.**
 */

import { describe, expect, it } from "bun:test";
import {
  ERASURE_DISPOSITIONS as D,
  type ErasureRule,
} from "../../packages/shared/config/erasure-policy.ts";
import { RETENTION_CLASSES } from "../../packages/shared/config/retention-policy.ts";
import {
  auditErasurePolicy,
  functionBodyOf,
  sectionsBuiltBySql,
  type Violation,
} from "../../scripts/check-erasure-policy.ts";

/** بذرةٌ سليمةٌ صغيرةٌ: جدولانِ، واحدٌ يُمحى وواحدٌ غيرُ شخصيٍّ. */
const CLEAN_ERASURE: Record<string, ErasureRule> = {
  saved_places: {
    disposition: D.erase,
    subjects: ["rider"],
    linkedBy: "user_id",
    basis: null,
    exportSection: "savedPlaces",
    deferredTo: null,
  },
  cities: {
    disposition: D.notPersonal,
    subjects: [],
    linkedBy: null,
    basis: null,
    exportSection: null,
    deferredTo: null,
  },
};

const CLEAN_RETENTION: Record<string, string> = {
  saved_places: "untilAccountDeletion",
  cities: "operationalIndefinite",
};

const EXPORT_SQL = `
create or replace function export_my_data(p_telegram_id bigint)
returns jsonb as $fn$
begin
  return jsonb_build_object(
    'ok', true,
    'sections', jsonb_build_object(
      'savedPlaces', coalesce((select jsonb_agg(jsonb_build_object('label', p.label)) from saved_places p), '[]'::jsonb)
    )
  );
end;
$fn$ language plpgsql;
`;

const ERASE_SQL = "delete from saved_places where user_id = v_user.id;";

function audit(overrides: {
  erasure?: Record<string, ErasureRule>;
  retention?: Record<string, string>;
  deferredOnly?: ReadonlySet<string>;
  exportSql?: string;
  eraseSql?: string;
  implementedSections?: readonly string[];
}): readonly Violation[] {
  return auditErasurePolicy({
    erasure: overrides.erasure ?? CLEAN_ERASURE,
    retention: overrides.retention ?? CLEAN_RETENTION,
    deferredOnly: overrides.deferredOnly ?? new Set<string>(),
    ...(overrides.exportSql === undefined ? {} : { exportSql: overrides.exportSql }),
    ...(overrides.implementedSections === undefined
      ? {}
      : { implementedSections: overrides.implementedSections }),
    eraseSql: overrides.eraseSql ?? ERASE_SQL,
  });
}

const rules = (found: readonly Violation[]): readonly string[] => found.map((v) => v.rule);

describe("الحاجزُ يسكتُ على سجلٍّ مستقيمٍ", () => {
  it("لا يُخفِقُ على البذرةِ السليمةِ", () => {
    expect(audit({ exportSql: EXPORT_SQL })).toEqual([]);
  });
});

describe("١ · القائمتانِ مغلقتانِ في الاتّجاهَينِ", () => {
  it("يُخفِقُ على جدولٍ مُصنَّفٍ للاستبقاءِ بلا حكمِ حذفٍ", () => {
    const found = audit({ retention: { ...CLEAN_RETENTION, ratings: "financialSixYears" } });
    expect(rules(found)).toContain("CLOSED_LIST");
  });

  it("يُخفِقُ على حكمِ حذفٍ لجدولٍ لا تصنيفَ استبقاءٍ له", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        ghost_table: {
          disposition: D.erase,
          subjects: ["rider"],
          linkedBy: "user_id",
          basis: null,
          exportSection: "ghost",
          deferredTo: null,
        },
      },
    });
    expect(rules(found)).toContain("CLOSED_LIST");
  });
});

describe("٢ · لا حكمَ حذفٍ يُخالِفُ صنفَ استبقاءٍ يُوجِبُ الحفظَ", () => {
  it("يُخفِقُ على جدولٍ مُصنَّفٍ `financialSixYears` وحكمُه المحوُ", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        saved_places: { ...CLEAN_ERASURE.saved_places, disposition: D.erase } as ErasureRule,
      },
      retention: { ...CLEAN_RETENTION, saved_places: RETENTION_CLASSES.financialSixYears },
    });
    expect(rules(found)).toContain("RETENTION_CONTRADICTION");
  });

  it("يُخفِقُ على `auditUnboundedUntilCompliance` وحكمُه المحوُ — وهوَ الخرقُ الذي كانَ قائماً فعلاً في `user_consents`", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        saved_places: { ...CLEAN_ERASURE.saved_places, disposition: D.erase } as ErasureRule,
      },
      retention: {
        ...CLEAN_RETENTION,
        saved_places: RETENTION_CLASSES.auditUnboundedUntilCompliance,
      },
    });
    expect(rules(found)).toContain("RETENTION_CONTRADICTION");
  });
});

describe("٣ · حكمٌ يقولُ «لا بيانةَ ههنا» لا صاحبَ له ولا قسمَ", () => {
  it("يُخفِقُ على `notPersonal` وله أصحابٌ", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        cities: { ...CLEAN_ERASURE.cities, subjects: ["rider"] } as ErasureRule,
      },
    });
    expect(rules(found)).toContain("NO_SUBJECT_NO_CLAIM");
  });

  it("يُخفِقُ على `notPersonal` ومعه قسمُ تنزيلٍ", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        cities: { ...CLEAN_ERASURE.cities, exportSection: "cities" } as ErasureRule,
      },
    });
    expect(rules(found)).toContain("NO_SUBJECT_NO_CLAIM");
  });

  it("يُخفِقُ على `notPersonal` ومعه مسارُ نسبةٍ", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        cities: { ...CLEAN_ERASURE.cities, linkedBy: "user_id" } as ErasureRule,
      },
    });
    expect(rules(found)).toContain("NO_SUBJECT_NO_CLAIM");
  });

  it("يُخفِقُ على حكمِ محوٍ بلا صاحبِ بيانةٍ — حكمٌ على لا شيءٍ", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        saved_places: { ...CLEAN_ERASURE.saved_places, subjects: [] } as ErasureRule,
      },
    });
    expect(rules(found)).toContain("NO_SUBJECT_NO_CLAIM");
  });
});

describe("٤ · `deferredNotLive` يستحيلُ أن يستترَ خلفَه جدولٌ حيٌّ", () => {
  it("يُخفِقُ حينَ يُعلَنُ مؤجَّلاً وهوَ مُنشَأٌ في هجرةٍ مُطبَّقةٍ", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        saved_places: {
          disposition: D.deferredNotLive,
          subjects: [],
          linkedBy: null,
          basis: null,
          exportSection: null,
          deferredTo: "F4-01",
        },
      },
      deferredOnly: new Set<string>(),
    });
    expect(rules(found)).toContain("DEFERRED_MUST_BE_DEFERRED");
  });

  it("يُخفِقُ حينَ يكونُ الجدولُ مؤجَّلاً وحكمُه يُوهِمُ تنفيذاً", () => {
    const found = audit({ deferredOnly: new Set(["saved_places"]) });
    expect(rules(found)).toContain("DEFERRED_MUST_BE_DEFERRED");
  });
});

describe("٥ · الإبقاءُ والتجهيلُ لا يُقبَلانِ بلا أساسٍ مكتوبٍ", () => {
  it("يُخفِقُ على `retainLegalBasis` بلا أساسٍ", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        saved_places: {
          ...CLEAN_ERASURE.saved_places,
          disposition: D.retainLegalBasis,
          basis: null,
        } as ErasureRule,
      },
    });
    expect(rules(found)).toContain("BASIS_REQUIRED");
  });

  it("يُخفِقُ على `anonymize` بأساسٍ فارغٍ — فراغٌ ليسَ سبباً", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        saved_places: {
          ...CLEAN_ERASURE.saved_places,
          disposition: D.anonymize,
          basis: "   ",
        } as ErasureRule,
      },
    });
    expect(rules(found)).toContain("BASIS_REQUIRED");
  });

  it("يُخفِقُ على محوٍ تامٍّ ومعه أساسُ إبقاءٍ", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        saved_places: { ...CLEAN_ERASURE.saved_places, basis: "لأنَّه مهمٌّ" } as ErasureRule,
      },
    });
    expect(rules(found)).toContain("BASIS_REQUIRED");
  });
});

describe("٦ · جدولٌ فيه بيانةٌ شخصيّةٌ يجبُ أن يُنزَّلَ وتُعرَفَ نسبتُه", () => {
  it("يُخفِقُ على جدولٍ شخصيٍّ بلا قسمِ تنزيلٍ", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        saved_places: { ...CLEAN_ERASURE.saved_places, exportSection: null } as ErasureRule,
      },
    });
    expect(rules(found)).toContain("PERSONAL_MUST_BE_EXPORTABLE");
  });

  it("يُخفِقُ على جدولٍ شخصيٍّ بلا مسارِ نسبةٍ", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        saved_places: { ...CLEAN_ERASURE.saved_places, linkedBy: "" } as ErasureRule,
      },
    });
    expect(rules(found)).toContain("PERSONAL_MUST_BE_EXPORTABLE");
  });
});

describe("٧ · دينٌ بلا اسمِ بندٍ دينٌ منسيٌّ", () => {
  it("يُخفِقُ على `deferredTo` ليسَ معرّفَ بندٍ", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        saved_places: { ...CLEAN_ERASURE.saved_places, deferredTo: "لاحقاً" } as ErasureRule,
      },
    });
    expect(rules(found)).toContain("DEBT_NEEDS_AN_ITEM");
  });

  it("يقبلُ معرّفَ بندٍ صحيحاً", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        saved_places: { ...CLEAN_ERASURE.saved_places, deferredTo: "F2-12" } as ErasureRule,
      },
    });
    expect(rules(found)).not.toContain("DEBT_NEEDS_AN_ITEM");
  });
});

describe("٨ · السجلُّ يُقابَلُ بالتنفيذِ لا بالنيّةِ", () => {
  it("يُخفِقُ على قسمٍ مُعلَنٍ لا تبنيه الدالّةُ — وعدٌ بلا يدٍ تُجريه", () => {
    const found = audit({ implementedSections: [] });
    expect(rules(found)).toContain("REGISTRY_MATCHES_IMPLEMENTATION");
  });

  it("يُخفِقُ على قسمٍ تبنيه الدالّةُ ولا مصدرَ حقيقةٍ له", () => {
    const found = audit({ implementedSections: ["savedPlaces", "secretStuff"] });
    expect(rules(found)).toContain("REGISTRY_MATCHES_IMPLEMENTATION");
  });

  it("يُخفِقُ على جدولٍ يملكُه البندُ ولا تمسُّه دالّةُ الحذفِ", () => {
    const found = audit({ implementedSections: ["savedPlaces"], eraseSql: "-- لا شيءَ ههنا" });
    expect(rules(found)).toContain("REGISTRY_MATCHES_IMPLEMENTATION");
  });

  it("يسكتُ حينَ تمسُّ الدالّةُ الجدولَ ويُطابِقُ القسمانِ", () => {
    expect(audit({ implementedSections: ["savedPlaces"] })).toEqual([]);
  });
});

describe("٩ · الحكمُ يُقابَلُ بعبارةٍ تُجريه لا بذكرِ اسمٍ (SD-12)", () => {
  it("يُخفِقُ على جدولٍ يُعَدُّ ولا يُمحى — وهوَ عينُ ما كانَ يمرُّ", () => {
    // القاعدةُ القديمةُ كانت تكتفي بورودِ الاسمِ، و`select count(*)` يُرضيها،
    // فيُقالُ في الإيصالِ «مُحيَ» ولم يُمَسَّ صفٌّ. **الحاجزُ الذي يُجيزُ هذا
    // يحرسُ الكذبَ الذي بُنيَ ليمنعَه.**
    const found = audit({
      implementedSections: ["savedPlaces"],
      eraseSql: "select count(*) into v_places from saved_places where user_id = v_user.id;",
    });
    expect(rules(found)).toContain("REGISTRY_MATCHES_IMPLEMENTATION");
  });

  it("يُخفِقُ حينَ يكونُ الحكمُ تجهيلاً والعبارةُ محواً — عبارةٌ لا تُنفِذُ الحكمَ", () => {
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        saved_places: { ...CLEAN_ERASURE.saved_places, disposition: D.anonymize } as ErasureRule,
      },
      implementedSections: ["savedPlaces"],
      eraseSql: "delete from saved_places where user_id = v_user.id;",
    });
    expect(rules(found)).toContain("REGISTRY_MATCHES_IMPLEMENTATION");
  });

  it("يسكتُ حينَ تُطابِقُ العبارةُ الحكمَ: تجهيلٌ ⇐ `update`", () => {
    // **يُقاسُ سكوتُ هذه القاعدةِ وحدَها لا سكوتُ الحاجزِ كلِّه**: التجهيلُ
    // يستوجبُ أساساً مكتوباً بقاعدةٍ أُخرى، فالبذرةُ ههنا تحملُه لئلّا يُقرأَ
    // إخفاقُ تلكَ إخفاقاً لهذه.
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        saved_places: {
          ...CLEAN_ERASURE.saved_places,
          disposition: D.anonymize,
          basis: "CONSENT_IS_COMPLIANCE_EVIDENCE",
        } as ErasureRule,
      },
      implementedSections: ["savedPlaces"],
      eraseSql: "update saved_places set label = null where user_id = v_user.id;",
    });
    expect(rules(found)).not.toContain("REGISTRY_MATCHES_IMPLEMENTATION");
  });

  it("يُنفِذُ على جداولِ السائقِ كذلكَ لا على الراكبِ وحدَه", () => {
    // `driver_documents` يملكُه صاحبُ البيانةِ `driver`، وكانَ خارجَ الإنفاذِ
    // كلَّه يومَ كانت القاعدةُ تقرأُ `rider` حرفاً.
    const found = audit({
      erasure: {
        ...CLEAN_ERASURE,
        driver_documents: {
          disposition: D.erase,
          subjects: ["driver"],
          linkedBy: "driver_id",
          basis: null,
          exportSection: "driverDocuments",
          deferredTo: null,
        },
      },
      retention: { ...CLEAN_RETENTION, driver_documents: "untilAccountDeletion" },
      implementedSections: ["savedPlaces", "driverDocuments"],
      eraseSql: "delete from saved_places where user_id = v_user.id;",
    });
    const messages = found.map((v) => v.message).join(" | ");
    expect(messages).toContain("driver_documents");
  });
});

describe("قارئُ الأقسامِ يقرأُ العُمقَ لا النمطَ", () => {
  it("لا يعُدُّ مفتاحاً متداخلاً قسماً — وهوَ الخطأُ الذي وقعَ فعلاً", () => {
    const nested = `
create or replace function export_my_data(p_telegram_id bigint)
returns jsonb as $fn$
begin
  return jsonb_build_object(
    'sections', jsonb_build_object(
      'ratings', coalesce((select jsonb_agg(jsonb_build_object(
        'role', case when r.rater_user_id = v_user.id then 'given' else 'received' end,
        'score', r.score
      )) from ratings r), '[]'::jsonb),
      'orders', coalesce((select jsonb_agg(jsonb_build_object('status', o.status)) from orders o), '[]'::jsonb)
    )
  );
end;
$fn$ language plpgsql;
`;
    expect(sectionsBuiltBySql(nested)).toEqual(["orders", "ratings"]);
  });

  it("يُعيدُ فراغاً حينَ لا دالّةَ", () => {
    expect(sectionsBuiltBySql("select 1;")).toEqual([]);
  });

  it("يقرأُ جسمَ الدالّةِ بينَ العلامتَينِ، و`null` إن غابَت", () => {
    expect(functionBodyOf(EXPORT_SQL, "export_my_data")).toContain("savedPlaces");
    expect(functionBodyOf(EXPORT_SQL, "erase_my_account")).toBeNull();
  });
});

describe("السجلُّ الحقيقيُّ في المستودعِ", () => {
  it("يمرُّ بلا خرقٍ واحدٍ — والحاجزُ يُشغَّلُ على الحقيقةِ لا على البذرةِ وحدَها", () => {
    expect(auditErasurePolicy({})).toEqual([]);
  });
});
