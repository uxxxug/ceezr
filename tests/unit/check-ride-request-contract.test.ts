/**
 * الغرض: إثباتُ أنَّ حاجزَ عقدِ طلبِ الرحلةِ **يُخفِقُ فعلاً** على كلِّ افتراقٍ
 *   يدّعي منعَه (`F2-05`) — لا أنَّه يمرُّ على المستودعِ كما هوَ اليومَ. وحاجزٌ
 *   بلا حالةٍ سالبةٍ اطمئنانٌ مُشترى بلا ثمنٍ، وهوَ أخطرُ من غيابِه لأنَّه يُقرأُ
 *   إنفاذاً وهوَ نصٌّ.
 * الحالة: اختبار فعلي — الحاجزُ يُستورَدُ ويُستدعى على مُدخلاتٍ مُصنَّعةٍ، ثمَّ
 *   على المستودعِ الحقيقيِّ في آخرِ الملفِّ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI — خطوةٌ مُسمّاةٌ في `.github/workflows/ci.yml`.
 * يُتوقع أن يستخدمه لاحقاً: كلُّ قاعدةٍ تُضافُ إلى الحاجزِ — قاعدةٌ بلا حالةٍ
 *   سالبةٍ ههنا لا تُحسَبُ مفروضةً (`ح-7`).
 * ملاحظات مستقبلية: مفردةُ الأجرةِ مكتوبةٌ **مُجزَّأةً** كي يُحقَنَ الممنوعُ دونَ
 *   أن يسقطَ الحاجزُ على ملفِّ اختبارِه — حَقنٌ صريحٌ لا تحايُلٌ: هذا الملفُّ
 *   خارجَ نطاقِ الشريحةِ المفحوصةِ أصلاً.
 */

import { describe, expect, it } from "bun:test";
import {
  declaredRenames,
  findViolations,
  REQUIRED_SEARCH_KEYS,
  REVOKED_FUNCTIONS,
  type RepositoryInput,
  readRepository,
  SLICE_FILES,
} from "../../scripts/check-ride-request-contract.ts";

const LANGUAGES = ["ar", "en", "ur"] as const;

/** مفردةُ الأجرةِ مُجزَّأةً كي لا يراها حاجزٌ يفحصُ نفسَه يوماً. */
const FARE = ["fa", "re"].join("");

const DB_REFUSALS = [
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_TOO_LONG",
  "NOTES_TOO_LONG",
  "INVALID_POINT",
  "CITY_HAS_NO_SERVICE_AREA",
  "ORIGIN_OUTSIDE_SERVICE_AREA",
  "DESTINATION_OUTSIDE_SERVICE_AREA",
  "SERVICE_NOT_AVAILABLE_IN_CITY",
  "ACTIVE_RIDE_EXISTS",
] as const;

function dictionaries(): Record<string, Record<string, string>> {
  const all: Record<string, Record<string, string>> = {};
  for (const language of LANGUAGES) {
    const dictionary: Record<string, string> = {};
    for (const key of REQUIRED_SEARCH_KEYS) dictionary[key] = `${key} ${language}`;
    all[language] = dictionary;
  }
  return all;
}

function judgement(): string {
  const revokes = REVOKED_FUNCTIONS.map(
    (signature) => `revoke execute on function ${signature} from public, anon, authenticated;`,
  ).join("\n");
  const refusals = [...DB_REFUSALS, "USER_NOT_FOUND", "RIDER_NOT_REGISTERED"]
    .map((code) => `  return jsonb_build_object('ok', false, 'error', '${code}');`)
    .join("\n");
  return [
    "-- migration-phase: expand",
    "create or replace function request_ride(p_telegram_id bigint) returns jsonb as $fn$",
    "  select id into v_rider from riders where user_id = v_user for update;",
    refusals,
    "  return jsonb_build_object('ok', true, 'reused', false, 'order_id', v_order);",
    "exception when unique_violation then",
    "  return jsonb_build_object('ok', true, 'reused', true, 'order_id', v_order);",
    "$fn$ language plpgsql;",
    "create or replace function ride_search_state(p_telegram_id bigint, p_order_id uuid) returns jsonb as $fn$",
    "  return jsonb_build_object('ok', false, 'error', 'INVALID_ORDER_ID');",
    "  return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');",
    "$fn$ language plpgsql;",
    revokes,
  ].join("\n");
}

function indexMigration(): string {
  return [
    "-- migration-phase: index",
    "create unique index concurrently if not exists orders_rider_idempotency_uidx",
    "  on orders (rider_id, idempotency_key)",
    "  where idempotency_key is not null;",
  ].join("\n");
}

function view(): string {
  const refusals = DB_REFUSALS.filter(
    (code) => code !== "NOTES_TOO_LONG" && code !== "IDEMPOTENCY_KEY_REQUIRED",
  )
    .map((code) => `  ${code}: "rider.search.refused.x",`)
    .join("\n");
  return [
    'import { elapsedSecondsSince } from "../../../../../../packages/domain/transport/ride-request.ts";',
    "const REFUSAL_KEYS: Readonly<Record<string, string>> = {",
    refusals,
    '  NOTES_TOO_LONG: "rider.search.refused.notesTooLong",',
    '  IDEMPOTENCY_KEY_REQUIRED: "rider.search.refused.keyRequired",',
    "};",
    "const SEARCH_REFUSAL_KEYS: Readonly<Record<string, string>> = {",
    '  INVALID_ORDER_ID: "rider.search.read.invalidId",',
    '  ORDER_NOT_FOUND: "rider.search.read.notFound",',
    "};",
    "const CANCEL_REFUSAL_KEYS: Readonly<Record<string, string>> = {",
    '  ORDER_NOT_CANCELLABLE: "rider.search.cancel.notCancellable",',
    "};",
    "const ERROR_KEYS: Readonly<Record<string, string>> = {",
    '  ACCOUNT_NOT_FOUND: "rider.search.error.account",',
    '  RIDER_NOT_REGISTERED: "rider.search.error.notRegistered",',
    "};",
    'export const ZERO = "rider.search.notified.zero";',
    "export function elapsed(input: { readonly nowMs: number }): number {",
    "  return elapsedSecondsSince(0, input.nowMs);",
    "}",
  ].join("\n");
}

function screen(): string {
  return [
    "export function SearchScreen(props: { readonly serverElapsedSeconds: number }) {",
    "  const seconds = elapsedSecondsFor({ serverElapsedSeconds: props.serverElapsedSeconds });",
    "  const canCancel = view.cancellableWithoutPenalty === true;",
    '  const notice = t("rider.search.snapshot");',
    '  const ask = t("rider.search.refresh");',
    "  return h(seconds, canCancel, notice, ask);",
    "}",
  ].join("\n");
}

function sources(): Record<string, string | null> {
  const slice: Record<string, string | null> = {};
  for (const path of SLICE_FILES) slice[path] = "const value = 1;\n";
  slice["packages/application/transport/ride-request-ports.ts"] = `type Code =\n${DB_REFUSALS.map(
    (code) => `  | "${code}"`,
  ).join("\n")};\n`;
  slice["packages/application/transport/request-ride.ts"] = [
    "export function rideStoreErrorFrom(failure: RideStoreFailure): Code {",
    '  if (failure.reason === "USER_NOT_FOUND") return "ACCOUNT_NOT_FOUND";',
    '  if (failure.reason === "RIDER_NOT_REGISTERED") return "RIDER_NOT_REGISTERED";',
    '  return "RIDE_STORE_NOT_AVAILABLE";',
    "}",
  ].join("\n");
  slice["packages/infrastructure/transport/ride-request-store.ts"] =
    'const text = "select request_ride($1, $2) as payload";\n';
  slice["apps/miniapp/src/surfaces/rider/search/search-view.ts"] = view();
  slice["apps/miniapp/src/surfaces/rider/search/SearchScreen.tsx"] = screen();
  return slice;
}

function healthy(): RepositoryInput {
  return {
    judgementSql: judgement(),
    indexSql: indexMigration(),
    indexFileName: "20260913230100_f2_05_ride_idempotency_index.sql",
    sliceSources: sources(),
    miniappDictionaries: dictionaries(),
  };
}

function withSlice(path: string, source: string): RepositoryInput {
  const base = healthy();
  return { ...base, sliceSources: { ...base.sliceSources, [path]: source } };
}

const VIEW_PATH = "apps/miniapp/src/surfaces/rider/search/search-view.ts";
const SCREEN_PATH = "apps/miniapp/src/surfaces/rider/search/SearchScreen.tsx";

describe("حاجزُ عقدِ طلبِ الرحلةِ — المُدخَلُ السليمُ يمرُّ", () => {
  it("لا مخالفةَ على مُدخَلٍ مُصنَّعٍ سليمٍ: وإلّا كانت الحالاتُ السالبةُ بلا معنى", () => {
    expect(findViolations(healthy())).toEqual([]);
  });
});

describe("القاعدةُ ١ — مفتاحُ التكرارِ قيدُ مخطَّطٍ لا فحصُ تطبيقٍ", () => {
  it("فهرسٌ على المفتاحِ وحدَه بلا الراكبِ يُسقِطُ الحاجزَ", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      indexSql: indexMigration().replace("(rider_id, idempotency_key)", "(idempotency_key)"),
    });
    expect(violations.some((text) => text.includes("is not null"))).toBe(true);
  });

  it("فهرسٌ بلا شرطٍ جزئيٍّ يُسقِطُ الحاجزَ: صفوفُ البوتِ بلا مفتاحٍ تتزاحمُ", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      indexSql: indexMigration().replace("\n  where idempotency_key is not null;", ";"),
    });
    expect(violations.some((text) => text.includes("is not null"))).toBe(true);
  });

  it("غيابُ الهجرةِ الفهرسيّةِ كلَّها يُسقِطُ الحاجزَ", () => {
    const base = healthy();
    const violations = findViolations({ ...base, indexSql: null, indexFileName: null });
    expect(violations.some((text) => text.includes("متوازيَينِ"))).toBe(true);
  });

  it("قراءةُ الراكبِ بلا `for update` تُسقِطُ الحاجزَ", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      judgementSql: judgement().replace(" for update", ""),
    });
    expect(violations.some((text) => text.includes("for update"))).toBe(true);
  });

  it("عدمُ معالجةِ `unique_violation` يُسقِطُ الحاجزَ: الثاني في السباقِ يسقطُ عطباً", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      judgementSql: judgement().replace("exception when unique_violation then", "-- none"),
    });
    expect(violations.some((text) => text.includes("unique_violation"))).toBe(true);
  });

  it("حمولةٌ بلا `reused` تُسقِطُ الحاجزَ: تُقرأُ الإعادةُ إنشاءً جديداً", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      judgementSql: judgement().replaceAll("'reused'", "'fresh'"),
    });
    expect(violations.some((text) => text.includes("reused"))).toBe(true);
  });
});

describe("القاعدةُ ٢ — الفهرسُ المتوازي وحدَه في مِلفِّه", () => {
  it("جملةٌ ثانيةٌ في مِلفِّ الفهرسِ تُسقِطُ الحاجزَ: لا معاملةَ لـ`concurrently`", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      indexSql: `${indexMigration()}\nanalyze orders;`,
    });
    expect(violations.some((text) => text.includes("معاملةٍ"))).toBe(true);
  });

  it("فهرسٌ حاجزٌ (غيرُ متوازٍ) يُسقِطُ الحاجزَ: يُقفِلُ جدولَ الطلباتِ عندَ النشرِ", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      indexSql: indexMigration().replace("concurrently ", ""),
    });
    expect(violations.some((text) => text.includes("متوازياً"))).toBe(true);
  });

  it("مِلفٌّ بلا إعلانِ الطورِ يُسقِطُ الحاجزَ", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      indexSql: indexMigration().replace("-- migration-phase: index", "-- فهرسٌ"),
    });
    expect(violations.some((text) => text.includes("الطورِ"))).toBe(true);
  });
});

describe("القاعدةُ ٣ — كلُّ رمزِ رفضٍ له نصٌّ في الشاشةِ", () => {
  it("رمزٌ تُعيدُه القاعدةُ ولا يُترجِمُه العرضُ يُسقِطُ الحاجزَ", () => {
    const violations = findViolations(
      withSlice(VIEW_PATH, view().replace(/^\s*ACTIVE_RIDE_EXISTS:.*$/m, "")),
    );
    expect(violations.some((text) => text.includes("ACTIVE_RIDE_EXISTS"))).toBe(true);
  });

  it("رمزٌ تُعيدُه القاعدةُ ولا يعرفُه عقدُ المنافذِ يُسقِطُ الحاجزَ", () => {
    const violations = findViolations(
      withSlice(
        "packages/application/transport/ride-request-ports.ts",
        'type Code = "INVALID_POINT";\n',
      ),
    );
    expect(violations.some((text) => text.includes("لا يعرفُ"))).toBe(true);
  });

  it("إعادةُ التسميةِ تُقرأُ من الشِّفرةِ: فإذا سقطَ الجَسرُ سقطَ الحاجزُ", () => {
    const useCase = healthy().sliceSources[
      "packages/application/transport/request-ride.ts"
    ] as string;
    const renames = declaredRenames(useCase);
    expect(renames.USER_NOT_FOUND).toBe("ACCOUNT_NOT_FOUND");
    const violations = findViolations(
      withSlice(
        "packages/application/transport/request-ride.ts",
        useCase.replace('if (failure.reason === "USER_NOT_FOUND") return "ACCOUNT_NOT_FOUND";', ""),
      ),
    );
    expect(violations.some((text) => text.includes("USER_NOT_FOUND"))).toBe(true);
  });
});

describe("القاعدةُ ٤ — مسارُ الشبكةِ لا يكتبُ صفَّ رحلةٍ بنفسِه", () => {
  it("استيرادُ الكاتبِ الأقدمِ في مسارِ الشبكةِ يُسقِطُ الحاجزَ", () => {
    const violations = findViolations(
      withSlice(
        "apps/gateway/src/routes/rides.ts",
        'import { createOrderWriter } from "../../../../packages/infrastructure/transport/order-adapters.ts";\n',
      ),
    );
    expect(violations.some((text) => text.includes("ARCH-006"))).toBe(true);
  });

  it("`insert into orders` في مخزنِ الرحلةِ يُسقِطُ الحاجزَ: يتخطّى قيدَ المفتاحِ", () => {
    const violations = findViolations(
      withSlice(
        "packages/infrastructure/transport/ride-request-store.ts",
        'const text = "insert into orders (rider_id) values ($1)";\n',
      ),
    );
    expect(violations.some((text) => text.includes("0.5"))).toBe(true);
  });

  it("مخزنٌ لا ينادي `request_ride` يُسقِطُ الحاجزَ: الحكمُ في القاعدةِ", () => {
    const violations = findViolations(
      withSlice(
        "packages/infrastructure/transport/ride-request-store.ts",
        'const text = "select 1";\n',
      ),
    );
    expect(violations.some((text) => text.includes("request_ride("))).toBe(true);
  });

  it("ذِكرُ الكاتبِ الأقدمِ في تعليقٍ يمرُّ: حاجزٌ يُعاقِبُ الشرحَ يُخفي سببَ المنعِ", () => {
    const violations = findViolations(
      withSlice(
        "apps/gateway/src/routes/rides.ts",
        "// لا يُستعملُ ههنا كاتبُ order-adapters: لا مفتاحَ تكرارٍ فيه.\nconst value = 1;\n",
      ),
    );
    expect(violations).toEqual([]);
  });

  it("\u0627\u0633\u062a\u062f\u0639\u0627\u0621\u064f `deps.orders.create` \u0641\u064a \u0628\u0648\u062a\u0650 \u0627\u0644\u0639\u0645\u064a\u0644\u0650 \u064a\u064f\u0633\u0642\u0637\u064f \u0627\u0644\u062d\u0627\u062c\u0632\u064e (D-01)", () => {
    const violations = findViolations(
      withSlice(
        "packages/application/bots/rider-dialog.ts",
        "const result = await deps.orders.create({ cityId, riderId, service });\n",
      ),
    );
    expect(violations.some((text) => text.includes("RideRequestCommand"))).toBe(true);
  });

  it("\u0627\u0633\u062a\u062f\u0639\u0627\u0621\u064f `orders.create` \u0645\u0628\u0627\u0634\u0631\u0629\u064b \u0641\u064a \u0627\u0644\u062a\u0648\u0635\u064a\u0644\u0650 \u064a\u064f\u0633\u0642\u0637\u064f \u0627\u0644\u062d\u0627\u062c\u0632\u064e (D-01)", () => {
    const violations = findViolations(
      withSlice(
        "packages/application/delivery/request-delivery.ts",
        "const id = await orders.create({ cityId, riderId, service });\n",
      ),
    );
    expect(violations.some((text) => text.includes("RideRequestCommand"))).toBe(true);
  });
});

describe("القاعدةُ ٥ — لا مفردةَ أجرةٍ في الشريحةِ ولا في هجرتِها", () => {
  it("حقلُ أجرةٍ في العقدِ يُرفَضُ ولو كانَ فارغاً — `م13-7` يُجمِّدُ التمهيدَ", () => {
    const violations = findViolations(
      withSlice(
        "apps/miniapp/src/surfaces/rider/search/ride-contract.ts",
        `export interface CreatedRide {\n  readonly ${FARE}: null;\n}\n`,
      ),
    );
    expect(violations.some((text) => text.includes("ADR 0039"))).toBe(true);
  });

  it("عمودُ سعرٍ في هجرةِ الحكمِ يُرفَضُ: الحجبُ يشملُ القاعدةَ لا الواجهةَ وحدَها", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      judgementSql: `${judgement()}\nalter table orders add column price_amount numeric;`,
    });
    expect(violations.some((text) => text.includes("ADR 0039"))).toBe(true);
  });
});

describe("القاعدةُ ٦ — الشاشةُ تُعيدُ مفاتيحَ لا نصّاً", () => {
  it("نصٌّ عربيٌّ معروضٌ في الشاشةِ يُسقِطُ الحاجزَ (§9.11)", () => {
    const violations = findViolations(
      withSlice(SCREEN_PATH, `${screen()}\nconst title = "نبحثُ عن سائقٍ";\n`),
    );
    expect(violations.some((text) => text.includes("9.11"))).toBe(true);
  });

  it("مفتاحٌ غائبٌ في لغةٍ واحدةٍ يُسقِطُ الحاجزَ: شاشةٌ تُظهِرُ المفتاحَ خامّاً", () => {
    const base = healthy();
    const urdu = { ...(base.miniappDictionaries.ur as Record<string, string>) };
    delete urdu["rider.search.notified.zero"];
    const violations = findViolations({
      ...base,
      miniappDictionaries: { ...base.miniappDictionaries, ur: urdu },
    });
    expect(violations.some((text) => text.includes("ur.json"))).toBe(true);
  });

  it("مفتاحٌ حاضرٌ فارغاً يُسقِطُ الحاجزَ: الفراغُ شاشةٌ لا تُقرأُ", () => {
    const base = healthy();
    const arabic = { ...(base.miniappDictionaries.ar as Record<string, string>) };
    arabic["rider.search.cancel"] = "   ";
    const violations = findViolations({
      ...base,
      miniappDictionaries: { ...base.miniappDictionaries, ar: arabic },
    });
    expect(violations.some((text) => text.includes("rider.search.cancel"))).toBe(true);
  });
});

describe("القاعدةُ ٧ — المؤقّتُ من ميلادِ الرحلةِ لا من فتحِ الشاشةِ", () => {
  it("نموذجُ عرضٍ لا يستوردُ `elapsedSecondsSince` يُسقِطُ الحاجزَ", () => {
    const violations = findViolations(
      withSlice(VIEW_PATH, view().replaceAll("elapsedSecondsSince", "localElapsed")),
    );
    expect(violations.some((text) => text.includes("سبعِ دقائقَ"))).toBe(true);
  });

  it("حسبةُ زمنٍ في الشاشةِ تُسقِطُ الحاجزَ: التحويلُ حكمُ النطاقِ", () => {
    const violations = findViolations(
      withSlice(SCREEN_PATH, `${screen()}\nconst seconds = (now - openedAt) / 1000;\n`),
    );
    expect(violations.some((text) => text.includes("بالقسمةِ"))).toBe(true);
  });

  it("شاشةٌ لا تُمرِّرُ `serverElapsedSeconds` تُسقِطُ الحاجزَ: انحرافُ الساعةِ يكذبُ", () => {
    const violations = findViolations(
      withSlice(SCREEN_PATH, screen().replaceAll("serverElapsedSeconds", "openedAtMs")),
    );
    expect(violations.some((text) => text.includes("انحرافُ"))).toBe(true);
  });
});

describe("القاعدةُ ٨ — الصفرُ نصٌّ مُعلَنٌ لا رقمٌ في قالبٍ", () => {
  it("غيابُ مفتاحِ الصفرِ من نموذجِ العرضِ يُسقِطُ الحاجزَ", () => {
    const violations = findViolations(
      withSlice(VIEW_PATH, view().replace('export const ZERO = "rider.search.notified.zero";', "")),
    );
    expect(violations.some((text) => text.includes("ADR 0023"))).toBe(true);
  });
});

describe("القاعدةُ ١١ — القراءةُ بطلبٍ، وبابُ الطلبِ واجبٌ", () => {
  it("شاشةٌ بلا زرِّ قراءةٍ تُسقِطُ الحاجزَ — فلا استقصاءَ يخلفُه (ADR 0035 §4)", () => {
    const violations = findViolations(
      withSlice(SCREEN_PATH, screen().replaceAll('"rider.search.refresh"', '"rider.search.back"')),
    );
    expect(violations.some((text) => text.includes("بلا بابِ سؤالٍ"))).toBe(true);
  });

  it("شاشةٌ لا تُعلِنُ أنَّ الرقمَ لقطةٌ تُسقِطُ الحاجزَ", () => {
    const violations = findViolations(
      withSlice(
        SCREEN_PATH,
        screen().replaceAll('"rider.search.snapshot"', '"rider.search.title"'),
      ),
    );
    expect(violations.some((text) => text.includes("يُقرأُ حيّاً"))).toBe(true);
  });

  it("والقاعدةُ تحكمُ على الشِّفرةِ لا على النثرِ: ذكرُ المفتاحِ في تعليقٍ لا يُجزئُ", () => {
    const commented = screen().replaceAll(
      '  const ask = t("rider.search.refresh");',
      '  // const ask = t("rider.search.refresh");',
    );
    expect(
      findViolations(withSlice(SCREEN_PATH, commented)).some((text) =>
        text.includes("بلا بابِ سؤالٍ"),
      ),
    ).toBe(true);
  });
});

describe("القاعدةُ ٩ — زرُّ الإلغاءِ مشروطٌ برايةِ القاعدةِ", () => {
  it("شاشةٌ لا تقرأُ `cancellableWithoutPenalty` تُسقِطُ الحاجزَ", () => {
    const violations = findViolations(
      withSlice(SCREEN_PATH, screen().replaceAll("cancellableWithoutPenalty", "alwaysTrue")),
    );
    expect(violations.some((text) => text.includes("أسوأُ من غيابِه"))).toBe(true);
  });
});

describe("القاعدةُ ١٠ — نزعُ التنفيذِ عن الأدوارِ العامّةِ", () => {
  it("نزعٌ مُعلَّقٌ يُسقِطُ الحاجزَ: تعليقٌ يُقرأُ إغلاقاً وهوَ بابٌ مفتوحٌ", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      judgementSql: judgement().replace(
        "revoke execute on function ride_search_state",
        "-- revoke execute on function ride_search_state",
      ),
    });
    expect(violations.some((text) => text.includes("ride_search_state"))).toBe(true);
  });

  it("نزعٌ ناقصُ الأدوارِ يُسقِطُ الحاجزَ", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      judgementSql: judgement().replaceAll("from public, anon, authenticated;", "from public;"),
    });
    expect(violations.some((text) => text.includes("anon"))).toBe(true);
  });

  it("غيابُ دالّةٍ من الهجرةِ يُسقِطُ الحاجزَ", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      judgementSql: judgement().replaceAll("cancel_ride_by_telegram", "cancel_ride_by_id"),
    });
    expect(violations.some((text) => text.includes("cancel_ride_by_telegram"))).toBe(true);
  });
});

describe("مِلفٌّ غائبٌ من الشريحةِ", () => {
  it("غيابُ مِلفٍّ مُعلَنٍ يُسقِطُ الحاجزَ: عقدٌ في الحاجزِ بلا شِفرةٍ تخدمُه", () => {
    const violations = findViolations(
      withSlice("packages/domain/transport/ride-request.ts", null as unknown as string),
    );
    expect(violations.some((text) => text.includes("غائبٌ"))).toBe(true);
  });
});

describe("المستودعُ الحقيقيُّ", () => {
  it("لا مخالفةَ في المستودعِ كما هوَ: الحاجزُ يُقرأُ على الشِّفرةِ لا على مُصنَّعٍ", () => {
    expect(findViolations(readRepository())).toEqual([]);
  });
});
