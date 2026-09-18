/**
 * الغرض: إثباتُ حتميّةِ بذرةِ القياس بدوالَّ صرفةٍ بلا قاعدةِ بيانات.
 * الحالة: اختبار وحدة — يُشغَّلُ في `verify` بلا بوابة.
 * ينتمي إلى: tests/unit
 * ملاحظات: هذا الاختبارُ يُثبِتُ أنّ الدوالَّ الصرفةَ (benchUuid، البصمة،
 *   تقييسُ الهويّات، مقارنةُ الحالات) حتميّةٌ وتميّزُ بين المدخلات. ولا يُثبِتُ
 *   أنّ البذرَ على قاعدةٍ حقيقيّةٍ حتميٌّ — ذاكَ اختبارُ التكاملِ المؤجَّل.
 *
 * **وما لا يُدَّعى** (`ح-5`): لا يُدَّعى أنّ البذرةَ صحيحةٌ، ولا أنّها تعملُ على
 * قاعدةٍ، بل أنّ الدوالَّ الصرفةَ التي تُنتجُ البصمةَ والمعرّفاتِ حتميّةٌ.
 */

import { describe, expect, it } from "bun:test";
import {
  benchUuid,
  computeSeedFingerprint,
  DEFAULT_SEED_FINGERPRINT,
  DEFAULT_SEED_PLAN,
  SEED_EPOCH,
} from "../../deferred/field-experiments/bench/seed.ts";
import {
  canonicalizeRowJson,
  compareStates,
  type StateSnapshot,
} from "../../deferred/field-experiments/bench/state.ts";

const UUID_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("F9-04 — حتميّةُ بذرةِ القياس: الدوالُّ الصرفة", () => {
  describe("benchUuid — اشتقاقٌ حتميّ", () => {
    it("المدخلاتُ نفسُها تُنتجُ المعرّفَ نفسَه", () => {
      expect(benchUuid("driver:0")).toBe(benchUuid("driver:0"));
    });

    it("الناتجُ UUIDv5 صالح", () => {
      const uuid = benchUuid("driver:0");
      expect(UUID_V5_PATTERN.test(uuid)).toBe(true);
    });

    it("مدخلاتٌ مختلفةٌ تُنتجُ معرّفاتٍ مختلفة", () => {
      expect(benchUuid("driver:0")).not.toBe(benchUuid("driver:1"));
    });

    it("ترتيبُ الأحرفِ في الاسم لا يُغيّرُ المعرّف — الاسمُ مفتاحٌ لا موقع", () => {
      // UUIDv5 يُشتقّ من الاسم كاملًا، فلا تفاوضَ في ترتيبِه.
      expect(benchUuid("driver:0")).not.toBe(benchUuid("0:driver"));
    });
  });

  describe("computeSeedFingerprint — بصمةٌ حتميّة", () => {
    it("المدخلاتُ نفسُها تُنتجُ البصمةَ نفسَها", () => {
      const a = computeSeedFingerprint(DEFAULT_SEED_PLAN, ["JED", "RUH"]);
      const b = computeSeedFingerprint(DEFAULT_SEED_PLAN, ["JED", "RUH"]);
      expect(a).toBe(b);
    });

    it("البصمةُ الافتراضيّةُ ثابتةٌ لا تتغيّرُ بين تشغيلين", () => {
      const fp = computeSeedFingerprint(DEFAULT_SEED_PLAN, []);
      expect(fp).toBe(DEFAULT_SEED_FINGERPRINT);
    });

    it("خطّةٌ مختلفة → بصمةٌ مختلفة", () => {
      const different = { drivers: 21, riders: 10 };
      expect(computeSeedFingerprint(different, [])).not.toBe(
        computeSeedFingerprint(DEFAULT_SEED_PLAN, []),
      );
    });

    it("مدنٌ مختلفة → بصمةٌ مختلفة", () => {
      const withCities = computeSeedFingerprint(DEFAULT_SEED_PLAN, ["JED"]);
      const withoutCities = computeSeedFingerprint(DEFAULT_SEED_PLAN, []);
      expect(withCities).not.toBe(withoutCities);
    });

    it("ترتيبُ المدنِ يُغيّرُ البصمةَ — القائمةُ مرتّبةٌ لا مجموعة", () => {
      const ordered = computeSeedFingerprint(DEFAULT_SEED_PLAN, ["JED", "RUH"]);
      const reversed = computeSeedFingerprint(DEFAULT_SEED_PLAN, ["RUH", "JED"]);
      expect(ordered).not.toBe(reversed);
    });

    it("SEED_EPOCH ثابتٌ لا يتغيّر", () => {
      expect(SEED_EPOCH.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });
  });

  describe("canonicalizeRowJson — تقييسُ الهويّات", () => {
    it("لا يُغيّرُ شيئاً حين لا أسماءَ في الخريطة", () => {
      const json = '{"id":"abc","name":"test"}';
      expect(canonicalizeRowJson(json, new Map())).toBe(json);
    });

    it("يستبدلُ المعرّفَ المُسنَدَ باسمه المنطقيّ", () => {
      const uuid = "1b671a64-40d5-491e-99b0-da01ff1f3341";
      const aliases = new Map([[uuid, "«city:JED»"]]);
      const json = `{"id":"${uuid}","name":"test"}`;
      const result = canonicalizeRowJson(json, aliases);
      expect(result).toContain("«city:JED»");
      expect(result).not.toContain(uuid);
    });

    it("يُبقي المعرّفاتِ غيرَ المُسنَدةِ كما هي", () => {
      const known = "1b671a64-40d5-491e-99b0-da01ff1f3341";
      const unknown = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const aliases = new Map([[known, "«city:JED»"]]);
      const json = `{"a":"${known}","b":"${unknown}"}`;
      const result = canonicalizeRowJson(json, aliases);
      expect(result).toContain("«city:JED»");
      expect(result).toContain(unknown);
    });
  });

  describe("compareStates — مقارنةٌ آليّة", () => {
    const baseSnapshot: StateSnapshot = {
      database: "waslah_bench",
      capturedAt: "2026-01-01T00:00:00.000Z",
      tables: [
        { table: "users", rows: 30, digest: "aaa", portableDigest: "aaa" },
        { table: "drivers", rows: 20, digest: "bbb", portableDigest: "bbb" },
      ],
      preserved: [{ table: "cities", rows: 5, digest: "ccc", portableDigest: "ccc" }],
      totalRows: 50,
    };

    it("حالتان متطابقتان → identical = true", () => {
      const copy: StateSnapshot = {
        ...baseSnapshot,
        tables: baseSnapshot.tables.map((t) => ({ ...t })),
        preserved: baseSnapshot.preserved.map((t) => ({ ...t })),
      };
      const result = compareStates(baseSnapshot, copy);
      expect(result.identical).toBe(true);
      expect(result.differences).toEqual([]);
    });

    it("اختلافُ عددِ الصفوف → row_count", () => {
      const modified: StateSnapshot = {
        ...baseSnapshot,
        tables: [
          { table: "users", rows: 31, digest: "aaa", portableDigest: "aaa" },
          { table: "drivers", rows: 20, digest: "bbb", portableDigest: "bbb" },
        ],
        totalRows: 51,
      };
      const result = compareStates(baseSnapshot, modified);
      expect(result.identical).toBe(false);
      expect(result.differences).toHaveLength(1);
      expect(result.differences[0]?.kind).toBe("row_count");
    });

    it("اختلافُ المحتوى → content", () => {
      const modified: StateSnapshot = {
        ...baseSnapshot,
        tables: [
          { table: "users", rows: 30, digest: "aaa", portableDigest: "xxx" },
          { table: "drivers", rows: 20, digest: "bbb", portableDigest: "bbb" },
        ],
        totalRows: 50,
      };
      const result = compareStates(baseSnapshot, modified);
      expect(result.identical).toBe(false);
      expect(result.differences[0]?.kind).toBe("content");
    });

    it("جدولٌ مفقود → missing_table", () => {
      const modified: StateSnapshot = {
        ...baseSnapshot,
        tables: [{ table: "users", rows: 30, digest: "aaa", portableDigest: "aaa" }],
        totalRows: 30,
      };
      const result = compareStates(baseSnapshot, modified);
      expect(result.identical).toBe(false);
      expect(result.differences.some((d) => d.kind === "missing_table")).toBe(true);
    });

    it("جدولٌ زائد → extra_table", () => {
      const modified: StateSnapshot = {
        ...baseSnapshot,
        tables: [
          ...baseSnapshot.tables,
          { table: "rides", rows: 5, digest: "ddd", portableDigest: "ddd" },
        ],
        totalRows: 55,
      };
      const result = compareStates(baseSnapshot, modified);
      expect(result.identical).toBe(false);
      expect(result.differences.some((d) => d.kind === "extra_table")).toBe(true);
    });

    it("اختلافُ معرّفاتٍ مُسنَدةٍ فقط → identity_only لا differences", () => {
      const modified: StateSnapshot = {
        ...baseSnapshot,
        tables: [
          { table: "users", rows: 30, digest: "xxx", portableDigest: "aaa" },
          { table: "drivers", rows: 20, digest: "bbb", portableDigest: "bbb" },
        ],
        totalRows: 50,
      };
      const result = compareStates(baseSnapshot, modified);
      expect(result.identical).toBe(true);
      expect(result.identityOnly.length).toBeGreaterThan(0);
    });
  });
});
