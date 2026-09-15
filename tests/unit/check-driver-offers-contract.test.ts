/**
 * الغرض: قياسُ حاجزِ عقدِ عروضِ السائقِ — **حالةٌ سلبيّةٌ مبذورةٌ لكلِّ قاعدةٍ من
 *   الثمانِ** (`ح-7`: قاعدةٌ بلا حالةٍ سلبيّةٍ غيرُ مُنفَذةٍ).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
 *
 * ولماذا تُقاسُ مدخلاتٌ مصنوعةٌ والمستودعُ معاً: المستودعُ اليومَ نظيفٌ، فلو
 * قِيسَ وحدَه لَنجحَ الاختبارُ ولو كانَ الحاجزُ لا يفحصُ شيئاً. **والحاجزُ الذي
 * لم يُرَ ساقطاً مرّةً لا يُعرَفُ أنّه يقفُ.**
 */

import { describe, expect, it } from "bun:test";
import { readRepository } from "../../scripts/check-driver-offers-contract.ts";
import {
  CONTRACT_FILE,
  DECLARED_CROSS_SLICE_KEYS,
  type DriverOffersContractInput,
  driverOffersContractProblems,
  errorTextProblems,
  grantProblems,
  honestyProblems,
  keyParityProblems,
  moneyVocabularyProblems,
  ROUTE_FILE,
  riderPrivacyProblems,
  singleWriterProblems,
  statusExhaustiveProblems,
  TEMPLATED_KEYS,
  VIEW_FILE,
} from "../../scripts/lib/driver-offers-contract.ts";

const ERROR_CODES = ["SESSION_REQUIRED", "OFFER_TAKEN"] as const;

const BOARD_SCREEN = "apps/miniapp/src/surfaces/driver/offers/OffersScreen.tsx";
const DETAIL_SCREEN = "apps/miniapp/src/surfaces/driver/offers/OfferDetailScreen.tsx";
const API_FILE = "apps/miniapp/src/surfaces/driver/offers/offers-api.ts";

const FUNCTIONS_SQL = `
-- migration-phase: expand
-- والذرّيّةُ في claim_ride وحدَها: for update skip locked ليسَ ههنا.
create or replace function driver_offer_board(p_telegram_id bigint)
returns jsonb language plpgsql stable as $$ begin
  return jsonb_build_object(
    'ok', true,
    'server_time', now(),
    'offers', jsonb_build_array(jsonb_build_object(
      'offer_id', v_id,
      'seconds_left', 42,
      'rider_distance', jsonb_build_object('kind', 'STRAIGHT_LINE', 'meters', 1200)
    ))
  );
end; $$;

create or replace function driver_accept_offer(p_telegram_id bigint, p_offer_id uuid)
returns jsonb language plpgsql as $$ begin
  v_claim := claim_ride(v_offer.order_id, v_driver.id);
  return jsonb_build_object('ok', true, 'order_id', v_claim->>'order_id');
end; $$;

revoke all on function driver_offer_board(bigint) from public, anon, authenticated;
revoke all on function driver_accept_offer(bigint, uuid) from public, anon, authenticated;

grant execute on function driver_offer_board(bigint) to service_role;
grant execute on function driver_accept_offer(bigint, uuid) to service_role;
`;

const VIEW = `
const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "SESSION_REQUIRED",
  "OFFER_TAKEN",
]);
const title = "driver.offers.title";
const kindKey = "rider.quote.distance.straightLine";
export function countdownLabel(secondsRemaining: number): string {
  const parts = countdownParts(secondsRemaining);
  return parts.minutes + ":" + String(parts.seconds).padStart(2, "0");
}
`;

const BOARD = `
const label = t("driver.offers.accept");
const badge = COUNTDOWN_BADGE[card.tone];
`;

const DETAIL = `const heading = t("driver.offers.detail.title");`;

const CONTRACT = `
export interface ApiDriverOfferCard {
  readonly offer_id: string;
  readonly seconds_left: number;
}
`;

const API = `export async function readDriverOffers(): Promise<DriverOffersResponse> {}`;

const ROUTE = `
const STATUS_BY_ERROR: Readonly<Record<string, number>> = {
  SESSION_REQUIRED: 401,
  OFFER_TAKEN: 409,
};
export function registerDriverOffersRoutes() {}
`;

const DOMAIN = `
export const OFFER_COUNTDOWN_TICK_MS = 1_000;
export function countdownSeconds(input: { secondsLeftAtRead: number; elapsedMs: number }): number {
  return Math.max(0, input.secondsLeftAtRead - Math.floor(input.elapsedMs / 1_000));
}
`;

const APPLICATION = `
export const DRIVER_OFFER_PUBLIC_ERROR_CODES = ["SESSION_REQUIRED", "OFFER_TAKEN"] as const;
`;

const STORE = `export class PostgresDriverOfferStore {}`;

function dictionary(): Record<string, string> {
  const out: Record<string, string> = {
    "driver.offers.title": "عروضي",
    "driver.offers.accept": "أقبلُ",
    "driver.offers.detail.title": "تفصيلُ العرضِ",
    "driver.offers.error.UNKNOWN": "تعثَّرَ الطلبُ",
  };
  for (const code of ERROR_CODES) out[`driver.offers.error.${code}`] = code;
  for (const key of TEMPLATED_KEYS) out[key] = key;
  for (const key of DECLARED_CROSS_SLICE_KEYS) out[key] = key;
  return out;
}

function baseInput(): DriverOffersContractInput {
  const dict = dictionary();
  return {
    surface: {
      [VIEW_FILE]: VIEW,
      [BOARD_SCREEN]: BOARD,
      [DETAIL_SCREEN]: DETAIL,
      [CONTRACT_FILE]: CONTRACT,
      [API_FILE]: API,
    },
    route: ROUTE,
    domain: DOMAIN,
    application: APPLICATION,
    store: STORE,
    functionsSql: FUNCTIONS_SQL,
    publicErrorCodes: [...ERROR_CODES],
    translations: { ar: { ...dict }, en: { ...dict }, ur: { ...dict } },
  };
}

function withDictionary(
  input: DriverOffersContractInput,
  language: string,
  change: (dict: Record<string, string>) => void,
): DriverOffersContractInput {
  const dict = { ...(input.translations[language] ?? {}) };
  change(dict);
  return { ...input, translations: { ...input.translations, [language]: dict } };
}

function withSurfaceFile(
  input: DriverOffersContractInput,
  path: string,
  source: string,
): DriverOffersContractInput {
  return { ...input, surface: { ...input.surface, [path]: source } };
}

function withSql(input: DriverOffersContractInput, sql: string): DriverOffersContractInput {
  return { ...input, functionsSql: sql };
}

describe("عقدُ عروضِ السائقِ — المدخلُ النظيفُ يمرُّ", () => {
  it("لا خرقَ في المدخلِ المصنوعِ الكاملِ", () => {
    expect(driverOffersContractProblems(baseInput())).toEqual([]);
  });
});

describe("القاعدة ١ — مفاتيحُ الثلاثةِ واحدةٌ، ولا مُنادًى غائبٌ", () => {
  it("تسقطُ حينَ يغيبُ مفتاحٌ عن قاموسٍ واحدٍ", () => {
    const input = withDictionary(baseInput(), "ur", (dict) => {
      delete dict["driver.offers.accept"];
    });
    expect(keyParityProblems(input).join("\n")).toContain("driver.offers.accept");
  });

  it("تسقطُ حينَ يزيدُ قاموسٌ مفتاحاً لا نظيرَ له", () => {
    const input = withDictionary(baseInput(), "en", (dict) => {
      dict["driver.offers.extra"] = "زائدٌ";
    });
    expect(keyParityProblems(input).join("\n")).toContain("driver.offers.extra");
  });

  it("تسقطُ حينَ يُنادي السطحُ مفتاحاً لا وجودَ له في القواميسِ", () => {
    const input = withSurfaceFile(
      baseInput(),
      BOARD_SCREEN,
      `${BOARD}\nconst gone = t("driver.offers.nowhere");`,
    );
    expect(keyParityProblems(input).join("\n")).toContain("driver.offers.nowhere");
  });

  it("تسقطُ حينَ يغيبُ مفتاحٌ مُعلَنٌ عبرَ الشرائحِ — وسمُ الخطِّ المستقيمِ مثالُه", () => {
    const input = withDictionary(baseInput(), "ar", (dict) => {
      delete dict["rider.quote.distance.straightLine"];
      delete dict["driver.documents.block.EXPIRED"];
    });
    const verdict = keyParityProblems(input).join("\n");
    expect(verdict).toContain("rider.quote.distance.straightLine");
    expect(verdict).toContain("driver.documents.block.EXPIRED");
  });

  it("تسقطُ حينَ يغيبُ مفتاحٌ يُبنى بقالبٍ — وقالبٌ لا يُقرأُ نصّاً في السطحِ", () => {
    const input = withDictionary(baseInput(), "en", (dict) => {
      delete dict["driver.offers.orderStatus.in_progress"];
    });
    expect(keyParityProblems(input).join("\n")).toContain("orderStatus.in_progress");
  });

  it("لا تمرُّ بقواميسَ فارغةٍ من البادئةِ", () => {
    const input: DriverOffersContractInput = {
      ...baseInput(),
      translations: { ar: {}, en: {}, ur: {} },
    };
    expect(keyParityProblems(input).length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٢ — رمزٌ منشورٌ بلا نصٍّ، ورمزٌ معروفٌ لا يُنشَرُ", () => {
  it("تسقطُ حينَ يُزادُ رمزٌ عامٌّ بلا نصٍّ", () => {
    const input: DriverOffersContractInput = {
      ...baseInput(),
      publicErrorCodes: [...ERROR_CODES, "OFFER_EXPIRED"],
    };
    expect(errorTextProblems(input).join("\n")).toContain("OFFER_EXPIRED");
  });

  it("تسقطُ حينَ يغيبُ نصُّ «UNKNOWN» — وهوَ آخرُ حاجزٍ بينَ السائقِ ومفتاحٍ خامٍّ", () => {
    const input = withDictionary(baseInput(), "en", (dict) => {
      delete dict["driver.offers.error.UNKNOWN"];
    });
    expect(errorTextProblems(input).join("\n")).toContain("error.UNKNOWN");
  });

  it("تسقطُ حينَ يُصنِّفُ السطحُ رمزاً معروفاً لا يُصدِرُه التطبيقُ", () => {
    const input = withSurfaceFile(
      baseInput(),
      VIEW_FILE,
      VIEW.replace('"OFFER_TAKEN",', '"OFFER_TAKEN",\n  "OFFER_ALREADY_ANSWERED",'),
    );
    expect(errorTextProblems(input).join("\n")).toContain("OFFER_ALREADY_ANSWERED");
  });

  it("تسقطُ حينَ يُصدِرُ التطبيقُ رمزاً لا يعرفُه السطحُ — فيُعرَضُ «تعثَّرَ الطلبُ» عن سببٍ مُسمّىً", () => {
    const input = withSurfaceFile(baseInput(), VIEW_FILE, VIEW.replace('  "OFFER_TAKEN",\n', ""));
    expect(errorTextProblems(input).join("\n")).toContain("لا يعرفُه السطحُ");
  });

  it("لا تمرُّ بقائمةِ رموزٍ فارغةٍ", () => {
    expect(errorTextProblems({ ...baseInput(), publicErrorCodes: [] }).length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٣ — لا لفظَ مالٍ في شريحةٍ طبقتُها الماليّةُ غائبةٌ بإعلانٍ", () => {
  it("تسقطُ حينَ يظهرُ حقلُ أجرةٍ في نموذجِ العرضِ", () => {
    const input = withSurfaceFile(
      baseInput(),
      VIEW_FILE,
      `${VIEW}\nexport const fare = card.fare ?? null;`,
    );
    expect(moneyVocabularyProblems(input).join("\n")).toContain("fare");
  });

  it("تسقطُ حينَ تُنشِرُ القاعدةُ تقديراً ماليّاً", () => {
    const input = withSql(
      baseInput(),
      FUNCTIONS_SQL.replace("'seconds_left', 42,", "'seconds_left', 42,\n      'price', 25,"),
    );
    expect(moneyVocabularyProblems(input).join("\n")).toContain("price");
  });

  it("تسقطُ حينَ يُوعِدُ نصُّ الواجهةِ بأجرةٍ", () => {
    const input = withDictionary(baseInput(), "ar", (dict) => {
      dict["driver.offers.title"] = "عروضي بالأجرةِ المقدَّرةِ";
    });
    expect(moneyVocabularyProblems(input).join("\n")).toContain("أجرة");
  });

  it("لا تسقطُ على كلمةٍ لاتينيّةٍ تحتويها — «surprise» ليست «price»", () => {
    const input = withSurfaceFile(baseInput(), VIEW_FILE, `${VIEW}\nconst surprise = 1;`);
    expect(moneyVocabularyProblems(input)).toEqual([]);
  });
});

describe("القاعدة ٤ — كاتبُ الإيكالِ واحدٌ", () => {
  it("تسقطُ حينَ يُقفَلُ صفٌّ في هذه الشريحةِ", () => {
    const input = withSql(
      baseInput(),
      FUNCTIONS_SQL.replace(
        "v_claim := claim_ride(v_offer.order_id, v_driver.id);",
        "select * into v_order from orders where id = v_offer.order_id for update skip locked;",
      ),
    );
    const verdict = singleWriterProblems(input).join("\n");
    expect(verdict).toContain("for update");
    expect(verdict).toContain("claim_ride");
  });

  it("تسقطُ حينَ تُحدِّثُ الشريحةُ «orders» بنفسِها", () => {
    const input = withSql(
      baseInput(),
      `${FUNCTIONS_SQL}\nupdate orders set status = 'matched' where id = v_offer.order_id;\n`,
    );
    expect(singleWriterProblems(input).join("\n")).toContain("update orders");
  });

  it("تسقطُ حينَ يُحدَّثُ العرضُ نفسُه خارجَ الذرّيّةِ", () => {
    const input = withSql(
      baseInput(),
      `${FUNCTIONS_SQL}\nupdate order_offers set status = 'accepted' where id = p_offer_id;\n`,
    );
    expect(singleWriterProblems(input).join("\n")).toContain("update order_offers");
  });

  it("تعليقٌ يشرحُ غيابَ القفلِ لا يُسقِطُ البناءَ — وهذا إخفاقٌ وقعَ فعلاً", () => {
    // نصُّ الهجرةِ يشرحُ أنَّ «for update skip locked» في `claim_ride` وحدَها،
    // فكانَت القاعدةُ تقرأُ الشرحَ خرقاً. محوُ التعليقاتِ قبلَ القياسِ هوَ
    // الإصلاحُ، وهذا الاختبارُ يمنعُ عودتَه.
    expect(FUNCTIONS_SQL).toContain("for update skip locked");
    expect(singleWriterProblems(baseInput())).toEqual([]);
  });

  it("لا يمرُّ قبولٌ لا يُفوِّضُ الذرّيّةَ", () => {
    const input = withSql(
      baseInput(),
      FUNCTIONS_SQL.replace("claim_ride(", "accept_offer_inline("),
    );
    expect(singleWriterProblems(input).join("\n")).toContain("claim_ride");
  });
});

describe("القاعدة ٥ — نزعُ تنفيذٍ ومنحُه لكلِّ دالّةٍ", () => {
  it("تسقطُ حينَ تُزادُ دالّةٌ بلا نزعٍ ولا منحٍ", () => {
    const input = withSql(
      baseInput(),
      `${FUNCTIONS_SQL}\ncreate or replace function driver_reject_offer(p_id uuid)\nreturns jsonb language plpgsql as $$ begin end; $$;\n`,
    );
    expect(grantProblems(input).join("\n")).toContain("driver_reject_offer");
  });

  it("تسقطُ حينَ يكونُ النزعُ ناقصَ دورٍ واحدٍ", () => {
    const input = withSql(
      baseInput(),
      FUNCTIONS_SQL.replace(
        "revoke all on function driver_accept_offer(bigint, uuid) from public, anon, authenticated;",
        "revoke all on function driver_accept_offer(bigint, uuid) from public, anon;",
      ),
    );
    expect(grantProblems(input).join("\n")).toContain("authenticated");
  });

  it("تسقطُ حينَ تبقى دالّةٌ بلا منحٍ لدورِ الخدمةِ — ومسارٌ لا يُنفَّذُ يسقطُ في الإنتاجِ وحدَه", () => {
    const input = withSql(
      baseInput(),
      FUNCTIONS_SQL.replace(
        "grant execute on function driver_accept_offer(bigint, uuid) to service_role;",
        "",
      ),
    );
    expect(grantProblems(input).join("\n")).toContain("service_role");
  });

  it("لا تمرُّ بهجرةٍ بلا دالّةٍ", () => {
    expect(grantProblems({ ...baseInput(), functionsSql: "-- لا شيءَ\n" }).length).toBeGreaterThan(
      0,
    );
  });
});

describe("القاعدة ٦ — صدقُ المؤقّتِ والمسافةِ", () => {
  it("تسقطُ حينَ تقرأُ دالّةُ العرضِ ساعةَ الجهازِ", () => {
    const input = withSurfaceFile(
      baseInput(),
      VIEW_FILE,
      `${VIEW}\nconst remaining = deadline - Date.now();`,
    );
    expect(honestyProblems(input).join("\n")).toContain("Date.now(");
  });

  it("تسقطُ حينَ يقرأُ النطاقُ ساعةً بـ«new Date»", () => {
    const input: DriverOffersContractInput = {
      ...baseInput(),
      domain: `${DOMAIN}\nconst now = new Date();`,
    };
    expect(honestyProblems(input).join("\n")).toContain("new Date(");
  });

  it("تسقطُ حينَ تدخلُ لحظةُ الانتهاءِ شاشةً", () => {
    const input = withSurfaceFile(
      baseInput(),
      BOARD_SCREEN,
      `${BOARD}\nconst left = new Date(card.expiresAt).getTime() - now();`,
    );
    expect(honestyProblems(input).join("\n")).toContain("expiresAt");
  });

  it("تسقطُ حينَ تدخلُ لحظةُ الانتهاءِ العقدَ أو البوّابةَ", () => {
    const contract = withSurfaceFile(
      baseInput(),
      CONTRACT_FILE,
      `${CONTRACT}\nexport type Deadline = { readonly expires_at: string };`,
    );
    expect(honestyProblems(contract).join("\n")).toContain(CONTRACT_FILE);
    const route: DriverOffersContractInput = {
      ...baseInput(),
      route: `${ROUTE}\nconst payload = { expires_at: offer.expires_at };`,
    };
    expect(honestyProblems(route).join("\n")).toContain(ROUTE_FILE);
  });

  it("تسقطُ حينَ لا تُنشِرُ القاعدةُ الباقيَ ولحظةَ الخادمِ", () => {
    const input = withSql(
      baseInput(),
      FUNCTIONS_SQL.replace("'seconds_left', 42,", "").replace("'server_time', now(),", ""),
    );
    const verdict = honestyProblems(input).join("\n");
    expect(verdict).toContain("seconds_left");
    expect(verdict).toContain("server_time");
  });

  it("تسقطُ حينَ تُنشَرُ مسافةٌ بمفتاحٍ غيرِ مُعلَنٍ", () => {
    const input = withSql(
      baseInput(),
      FUNCTIONS_SQL.replace(
        "'seconds_left', 42,",
        "'seconds_left', 42,\n      'distance_km', 3.2,",
      ),
    );
    expect(honestyProblems(input).join("\n")).toContain("distance_km");
  });

  it("تسقطُ حينَ تُنشَرُ مسافةٌ موسومةُ الاسمِ عاريةَ النوعِ", () => {
    const input = withSql(baseInput(), FUNCTIONS_SQL.replace("'kind', 'STRAIGHT_LINE', ", ""));
    expect(honestyProblems(input).join("\n")).toContain("STRAIGHT_LINE");
  });

  it("لا تمرُّ بغيابِ مِلفٍّ من مِلفّاتِ الساعةِ", () => {
    const surface = { ...baseInput().surface };
    delete surface[VIEW_FILE];
    expect(honestyProblems({ ...baseInput(), surface }).length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٧ — جدولُ الحالاتِ مُستوفٍ في الاتّجاهَينِ", () => {
  it("تسقطُ حينَ يبقى رمزٌ منشورٌ بلا حالةِ HTTP", () => {
    const input: DriverOffersContractInput = {
      ...baseInput(),
      publicErrorCodes: [...ERROR_CODES, "CITY_MISMATCH"],
    };
    expect(statusExhaustiveProblems(input).join("\n")).toContain("CITY_MISMATCH");
  });

  it("تسقطُ حينَ يبقى في الجدولِ مدخلٌ ميْتٌ", () => {
    const input: DriverOffersContractInput = {
      ...baseInput(),
      route: ROUTE.replace("OFFER_TAKEN: 409,", "OFFER_TAKEN: 409,\n  OFFER_GONE: 410,"),
    };
    expect(statusExhaustiveProblems(input).join("\n")).toContain("OFFER_GONE");
  });

  it("لا تمرُّ بمِلفِّ مساراتٍ بلا جدولٍ مقروءٍ", () => {
    expect(statusExhaustiveProblems({ ...baseInput(), route: "export const x = 1;" }).length).toBe(
      1,
    );
  });
});

describe("القاعدة ٨ — لا هويّةَ راكبٍ في حمولةٍ تذهبُ إلى كلِّ سائقي الجولةِ", () => {
  it("تسقطُ حينَ تُنشِرُ القاعدةُ هاتفَ الراكبِ", () => {
    const input = withSql(
      baseInput(),
      FUNCTIONS_SQL.replace(
        "'seconds_left', 42,",
        "'seconds_left', 42,\n      'phone', v_user.phone,",
      ),
    );
    expect(riderPrivacyProblems(input).join("\n")).toContain("phone");
  });

  it("تسقطُ حينَ تُنشِرُ القاعدةُ اسمَ الراكبِ أو مُعرِّفَه", () => {
    const input = withSql(
      baseInput(),
      FUNCTIONS_SQL.replace(
        "'seconds_left', 42,",
        "'seconds_left', 42,\n      'full_name', v_rider.full_name,\n      'rider_id', v_order.rider_id,",
      ),
    );
    const verdict = riderPrivacyProblems(input).join("\n");
    expect(verdict).toContain("full_name");
    expect(verdict).toContain("rider_id");
  });

  it("تسقطُ حينَ يحملُ عقدُ العميلِ حقلَ هويّةٍ", () => {
    const input = withSurfaceFile(
      baseInput(),
      CONTRACT_FILE,
      `${CONTRACT}\nexport type Rider = { readonly language_code: string };`,
    );
    expect(riderPrivacyProblems(input).join("\n")).toContain("language_code");
  });
});

describe("المستودعُ الحقيقيُّ", () => {
  it("لا خرقَ في المستودعِ كما هوَ اليومَ", () => {
    expect(driverOffersContractProblems(readRepository())).toEqual([]);
  });

  it("الشريحةُ الحقيقيّةُ تُنشِرُ رموزَها كلَّها بنصوصِها وحالاتِها", () => {
    const input = readRepository();
    expect(input.publicErrorCodes.length).toBeGreaterThan(0);
    expect(statusExhaustiveProblems(input)).toEqual([]);
    expect(errorTextProblems(input)).toEqual([]);
  });
});
