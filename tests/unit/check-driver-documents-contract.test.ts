/**
 * الغرض: قياسُ حاجزِ عقدِ وثائقِ السائقِ — **حالةٌ سلبيّةٌ مبذورةٌ لكلِّ قاعدةٍ من
 *   السبعِ** (`ح-7`: قاعدةٌ بلا حالةٍ سلبيّةٍ غيرُ مُنفَذةٍ).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ولماذا تُقاسُ مدخلاتٌ مصنوعةٌ والمستودعُ معاً: المستودعُ اليومَ نظيفٌ، فلو
 * قِيسَ وحدَه لَنجحَ الاختبارُ ولو كانَ الحاجزُ لا يفحصُ شيئاً. **والحاجزُ الذي
 * لم يُرَ ساقطاً مرّةً لا يُعرَفُ أنّه يقفُ.**
 */

import { describe, expect, it } from "bun:test";
import { readRepository } from "../../scripts/check-driver-documents-contract.ts";
import {
  CLIENT_UPLOAD_FILE,
  clientUploadProblems,
  type DriverDocumentsContractInput,
  documentTextProblems,
  driverDocumentsContractProblems,
  errorTextProblems,
  keyParityProblems,
  logHygieneProblems,
  revokeProblems,
  typeParityProblems,
} from "../../scripts/lib/driver-documents-contract.ts";

const TYPES = ["driving_license", "medical_exam"] as const;
const STATUSES = ["received", "accepted"] as const;
const BLOCK_CODES = ["MISSING", "EXPIRED"] as const;
const ERROR_CODES = ["SESSION_REQUIRED", "FILE_TOO_LARGE"] as const;

const TABLE_SQL = `
-- migration-phase: expand
do $$ begin
  create type driver_document_type as enum (
    'driving_license',  -- رخصةُ القيادةِ (تُحدَّثُ)
    'medical_exam'
  );
exception when duplicate_object then null; end $$;
`;

const FUNCTIONS_SQL = `
-- migration-phase: expand
create or replace function driver_document_upload_slot(
  p_telegram_id bigint, p_doc_type driver_document_type, p_content_type text, p_size bigint
) returns jsonb as $$ begin end; $$ language plpgsql;

create or replace function driver_document_dashboard(p_telegram_id bigint)
returns jsonb as $$ begin end; $$ language plpgsql;

revoke all on function driver_document_upload_slot(bigint, driver_document_type, text, bigint)
  from public, anon, authenticated;
revoke all on function driver_document_dashboard(bigint) from public, anon, authenticated;
`;

const VIEW = `
const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "SESSION_REQUIRED",
  "FILE_TOO_LARGE",
  "UPLOAD_FAILED",
]);
const title = "driver.documents.title";
`;

const SCREEN = `const badge = TONE_BADGE[card.tone];`;

/** الرفعُ إلى مضيفٍ ليسَ لنا: إذنٌ في العنوانِ ونوعُ المحتوى وحدَه. */
const CLIENT_UPLOAD = `
export async function uploadFileToSlot(slot: DriverUploadSlotResponse, file: File) {
  const response = await fetch(slot.upload_url, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!response.ok) throw new UploadFailedError();
}
`;

const ROUTE = `
deps.log?.("info", "driver_documents.slot_signed", {
  requestId,
  docType: parsed.doc_type,
});
deps.log?.("warn", "driver_documents.signer_not_configured", { requestId });
`;

function dictionary(): Record<string, string> {
  const out: Record<string, string> = {
    "driver.documents.title": "وثائقي",
    "driver.documents.status.missing": "لم تُرسَلْ",
    "driver.documents.block.UNKNOWN": "سببٌ غيرُ معروفٍ",
    "driver.documents.error.UNKNOWN": "تعثَّرَ الطلبُ",
    "driver.documents.error.UPLOAD_FAILED": "تعثَّرَ الرفعُ",
  };
  for (const type of TYPES) out[`driver.documents.type.${type}`] = type;
  for (const status of STATUSES) out[`driver.documents.status.${status}`] = status;
  for (const code of BLOCK_CODES) out[`driver.documents.block.${code}`] = code;
  for (const code of ERROR_CODES) out[`driver.documents.error.${code}`] = code;
  return out;
}

function baseInput(): DriverDocumentsContractInput {
  const dict = dictionary();
  return {
    surface: {
      "apps/miniapp/src/surfaces/driver/documents/documents-view.ts": VIEW,
      "apps/miniapp/src/surfaces/driver/documents/DocumentsScreen.tsx": SCREEN,
      [CLIENT_UPLOAD_FILE]: CLIENT_UPLOAD,
    },
    route: ROUTE,
    functionsSql: FUNCTIONS_SQL,
    tableSql: TABLE_SQL,
    documentTypes: [...TYPES],
    documentStatuses: [...STATUSES],
    blockCodes: [...BLOCK_CODES],
    publicErrorCodes: [...ERROR_CODES],
    translations: { ar: { ...dict }, en: { ...dict }, ur: { ...dict } },
  };
}

function withDictionary(
  input: DriverDocumentsContractInput,
  language: string,
  change: (dict: Record<string, string>) => void,
): DriverDocumentsContractInput {
  const dict = { ...(input.translations[language] ?? {}) };
  change(dict);
  return { ...input, translations: { ...input.translations, [language]: dict } };
}

function withSurfaceFile(
  input: DriverDocumentsContractInput,
  path: string,
  source: string,
): DriverDocumentsContractInput {
  return { ...input, surface: { ...input.surface, [path]: source } };
}

describe("عقدُ وثائقِ السائقِ — المدخلُ النظيفُ يمرُّ", () => {
  it("لا خرقَ في المدخلِ المصنوعِ الكاملِ", () => {
    expect(driverDocumentsContractProblems(baseInput())).toEqual([]);
  });
});

describe("القاعدة ١ — مفاتيحُ الثلاثةِ واحدةٌ، ولا مُنادًى غائبٌ", () => {
  it("تسقطُ حينَ يغيبُ مفتاحٌ عن قاموسٍ واحدٍ", () => {
    const input = withDictionary(baseInput(), "ur", (dict) => {
      delete dict["driver.documents.title"];
    });
    expect(keyParityProblems(input).join("\n")).toContain("driver.documents.title");
  });

  it("تسقطُ حينَ يزيدُ قاموسٌ مفتاحاً لا نظيرَ له", () => {
    const input = withDictionary(baseInput(), "en", (dict) => {
      dict["driver.documents.extra"] = "زائدٌ";
    });
    expect(keyParityProblems(input).join("\n")).toContain("driver.documents.extra");
  });

  it("تسقطُ حينَ يُنادي السطحُ مفتاحاً لا وجودَ له في القواميسِ", () => {
    const input = withSurfaceFile(
      baseInput(),
      "apps/miniapp/src/surfaces/driver/documents/DocumentsScreen.tsx",
      `${SCREEN}\nconst label = "driver.documents.nowhere";`,
    );
    expect(keyParityProblems(input).join("\n")).toContain("driver.documents.nowhere");
  });

  it("لا تمرُّ بقواميسَ فارغةٍ من البادئةِ", () => {
    const input: DriverDocumentsContractInput = {
      ...baseInput(),
      translations: { ar: {}, en: {}, ur: {} },
    };
    expect(keyParityProblems(input).length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٢ — لا نوعَ ولا حالةَ ولا رمزَ حجبٍ بلا نصٍّ", () => {
  it("تسقطُ حينَ يُزادُ نوعُ وثيقةٍ بلا نصٍّ — وهذا سببُ وجودِها", () => {
    const input: DriverDocumentsContractInput = {
      ...baseInput(),
      documentTypes: [...TYPES, "insurance"],
    };
    expect(documentTextProblems(input).join("\n")).toContain("insurance");
  });

  it("تسقطُ حينَ يغيبُ نصُّ حالةٍ عن قاموسٍ واحدٍ", () => {
    const input = withDictionary(baseInput(), "en", (dict) => {
      delete dict["driver.documents.status.accepted"];
    });
    expect(documentTextProblems(input).join("\n")).toContain("status.accepted");
  });

  it("تسقطُ حينَ يغيبُ نصُّ رمزِ حجبٍ", () => {
    const input = withDictionary(baseInput(), "ar", (dict) => {
      delete dict["driver.documents.block.EXPIRED"];
    });
    expect(documentTextProblems(input).join("\n")).toContain("block.EXPIRED");
  });

  it("تسقطُ حينَ يغيبُ نصُّ الغيابِ نفسِه", () => {
    const input = withDictionary(baseInput(), "ur", (dict) => {
      delete dict["driver.documents.status.missing"];
    });
    expect(documentTextProblems(input).join("\n")).toContain("status.missing");
  });

  it("لا تمرُّ بقوائمِ نطاقٍ فارغةٍ", () => {
    const input: DriverDocumentsContractInput = { ...baseInput(), documentTypes: [] };
    expect(documentTextProblems(input).length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٣ — لا رمزَ عامّاً بلا نصٍّ ولا نصَّ لرمزٍ لا يُنشَرُ", () => {
  it("تسقطُ حينَ يُزادُ رمزٌ عامٌّ بلا نصٍّ", () => {
    const input: DriverDocumentsContractInput = {
      ...baseInput(),
      publicErrorCodes: [...ERROR_CODES, "CITY_NOT_READY"],
    };
    expect(errorTextProblems(input).join("\n")).toContain("CITY_NOT_READY");
  });

  it("تسقطُ حينَ يغيبُ نصُّ «UNKNOWN» — وهوَ آخرُ حاجزٍ بينَ السائقِ ومفتاحٍ خامٍّ", () => {
    const input = withDictionary(baseInput(), "en", (dict) => {
      delete dict["driver.documents.error.UNKNOWN"];
    });
    expect(errorTextProblems(input).join("\n")).toContain("error.UNKNOWN");
  });

  it("تسقطُ حينَ يُصنِّفُ السطحُ رمزاً معروفاً لا يُصدِرُه التطبيقُ", () => {
    const input = withSurfaceFile(
      baseInput(),
      "apps/miniapp/src/surfaces/driver/documents/documents-view.ts",
      VIEW.replace('"UPLOAD_FAILED",', '"UPLOAD_FAILED",\n  "UPLOAD_POLICY_MISSING",'),
    );
    expect(errorTextProblems(input).join("\n")).toContain("UPLOAD_POLICY_MISSING");
  });

  it("لا تمرُّ بقائمةِ رموزٍ فارغةٍ", () => {
    const input: DriverDocumentsContractInput = { ...baseInput(), publicErrorCodes: [] };
    expect(errorTextProblems(input).length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٤ — لا دالّةَ بلا نزعِ تنفيذٍ", () => {
  it("تسقطُ حينَ تُزادُ دالّةٌ بلا نزعٍ", () => {
    const input: DriverDocumentsContractInput = {
      ...baseInput(),
      functionsSql: `${FUNCTIONS_SQL}\ncreate or replace function record_driver_document(p_id bigint)\nreturns jsonb as $$ begin end; $$ language plpgsql;\n`,
    };
    expect(revokeProblems(input).join("\n")).toContain("record_driver_document");
  });

  it("تسقطُ حينَ يكونُ النزعُ ناقصَ دورٍ واحدٍ", () => {
    const input: DriverDocumentsContractInput = {
      ...baseInput(),
      functionsSql: FUNCTIONS_SQL.replace(
        "revoke all on function driver_document_dashboard(bigint) from public, anon, authenticated;",
        "revoke all on function driver_document_dashboard(bigint) from public, anon;",
      ),
    };
    expect(revokeProblems(input).join("\n")).toContain("authenticated");
  });

  it("لا تمرُّ بهجرةٍ بلا دالّةٍ", () => {
    const input: DriverDocumentsContractInput = { ...baseInput(), functionsSql: "-- لا شيءَ\n" };
    expect(revokeProblems(input).length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٥ — لا تفويضَ يذهبُ إلى مضيفِ المخزنِ ولا مسارَ يُبنى في العميلِ", () => {
  it("تسقطُ حينَ تُرسَلُ ترويسةُ تفويضٍ معَ الملفِّ", () => {
    const input = withSurfaceFile(
      baseInput(),
      CLIENT_UPLOAD_FILE,
      CLIENT_UPLOAD.replace(
        '"content-type": file.type',
        '"content-type": file.type, authorization: `Bearer ${token}`',
      ),
    );
    expect(clientUploadProblems(input).join("\n")).toContain("authorization");
  });

  it("تسقطُ حينَ يُقرأُ رمزُ الجلسةِ في مِلفِّ الرفعِ", () => {
    const input = withSurfaceFile(
      baseInput(),
      CLIENT_UPLOAD_FILE,
      `${CLIENT_UPLOAD}\nconst token = getSession();`,
    );
    expect(clientUploadProblems(input).join("\n")).toContain("getSession");
  });

  it("تسقطُ حينَ يبني العميلُ مسارَ الكائنِ بنفسِه", () => {
    const input = withSurfaceFile(
      baseInput(),
      CLIENT_UPLOAD_FILE,
      `${CLIENT_UPLOAD}\nconst path = "drivers/" + driverId + "/license.png";`,
    );
    expect(clientUploadProblems(input).join("\n")).toContain("مسارَ كائنٍ");
  });

  it("لا تمرُّ بغيابِ مِلفِّ الرفعِ", () => {
    const surface = { ...baseInput().surface };
    delete surface[CLIENT_UPLOAD_FILE];
    expect(clientUploadProblems({ ...baseInput(), surface }).length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٦ — لا مسارَ ولا إذنَ رفعٍ في سجلِّ الخادمِ", () => {
  it("تسقطُ حينَ يُكتَبُ مسارُ الكائنِ في سجلٍّ", () => {
    const input: DriverDocumentsContractInput = {
      ...baseInput(),
      route: ROUTE.replace("docType: parsed.doc_type,", "objectPath: slot.object_path,"),
    };
    expect(logHygieneProblems(input).join("\n")).toContain("objectPath");
  });

  it("تسقطُ حينَ يُكتَبُ العنوانُ الموقَّعُ في سجلٍّ", () => {
    const input: DriverDocumentsContractInput = {
      ...baseInput(),
      route: ROUTE.replace("docType: parsed.doc_type,", "upload_url: signed.url,"),
    };
    expect(logHygieneProblems(input).join("\n")).toContain("upload_url");
  });

  it("لا تمرُّ بمِلفِّ مساراتٍ بلا سطرِ سجلٍّ", () => {
    expect(logHygieneProblems({ ...baseInput(), route: "export const x = 1;" }).length).toBe(1);
  });
});

describe("القاعدة ٧ — تعدادُ القاعدةِ وقائمةُ النطاقِ واحدٌ", () => {
  it("تسقطُ حينَ يزيدُ النطاقُ نوعاً لا تقبلُه القاعدةُ", () => {
    const input: DriverDocumentsContractInput = {
      ...baseInput(),
      documentTypes: [...TYPES, "periodic_inspection"],
    };
    expect(typeParityProblems(input).join("\n")).toContain("periodic_inspection");
  });

  it("تسقطُ حينَ يزيدُ التعدادُ نوعاً لا تعرفُه الشاشةُ", () => {
    const input: DriverDocumentsContractInput = {
      ...baseInput(),
      tableSql: TABLE_SQL.replace("'medical_exam'", "'medical_exam',\n    'insurance'"),
    };
    expect(typeParityProblems(input).join("\n")).toContain("insurance");
  });

  it("لا تمرُّ بهجرةٍ بلا تعدادٍ", () => {
    expect(typeParityProblems({ ...baseInput(), tableSql: "-- لا تعدادَ\n" }).length).toBe(1);
  });

  it("تعليقٌ فيه قوسٌ مُغلَقٌ لا يقطعُ قراءةَ التعدادِ — وهذا إخفاقٌ وقعَ فعلاً", () => {
    // في المستودعِ اسمُ نوعٍ مشروحٌ بعربيّةٍ فيها «(تُحدَّثُ سنويّاً)»، فكانَت
    // قراءةُ التعدادِ تقفُ عندَ القوسِ ويمرُّ نوعانِ بلا نصٍّ. مسحُ التعليقاتِ
    // قبلَ القراءةِ هوَ الإصلاحُ، وهذا الاختبارُ يمنعُ عودتَه.
    expect(typeParityProblems(baseInput())).toEqual([]);
  });
});

describe("المستودعُ الحقيقيُّ", () => {
  it("لا خرقَ في المستودعِ كما هوَ اليومَ", () => {
    expect(driverDocumentsContractProblems(readRepository())).toEqual([]);
  });
});
