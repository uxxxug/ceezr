/**
 * الغرض: `F7-06` — سلوكُ حالةِ استخدامِ الأرشفةِ بمزدوجاتٍ: ترتيبُ الخطواتِ،
 *   وأنَّ الإسقاطَ لا يُنادى إلّا بعدَ اكتمالِ الرفعِ والتحقّقِ، وأنَّ عطلَ يومٍ
 *   لا يُوقِفُ الشوطَ. البند `F7-06`، `ADR-0075`.
 * الحالة: اختبار وحدة — لا قاعدةَ ولا شبكةَ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيُّ تعديلٍ على ترتيبِ خطواتِ الأرشفةِ.
 * ملاحظات مستقبلية: الحارسُ الحقيقيُّ (رفضُ الإسقاطِ) مقيسٌ على PostgreSQL
 *   حقيقيٍّ في `tests/integration/location-archive-retention.test.ts`، ولا
 *   يُغني هذا الملفُّ عنه: مزدوجٌ يُطيعُ ما يُلقَّنُ ولا يُثبِتُ شرطاً في قاعدةٍ.
 */

import { describe, expect, it } from "bun:test";
import {
  type ArchiveObjectStore,
  archiveDueLocationPartitions,
  archiveObjectName,
  type LocationArchiveCatalog,
} from "../../packages/application/geo/archive-location-partitions.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const CITY = "11111111-1111-4111-8111-111111111111";
const DAY = "2026-08-01";

interface CatalogState {
  readonly dropCalls: string[];
  readonly recorded: number[];
  readonly verified: number[];
}

function createCatalog(
  rows: number,
  overrides: Partial<LocationArchiveCatalog> = {},
): { catalog: LocationArchiveCatalog; state: CatalogState } {
  const state: CatalogState = { dropCalls: [], recorded: [], verified: [] };
  const catalog: LocationArchiveCatalog = {
    dueDays: async () =>
      ok([
        {
          day: DAY,
          partition: "driver_location_history_20260801",
          cities: [{ cityId: CITY, rows }],
        },
      ]),
    parts: async () => ok([]),
    readPage: async (_day, _cityId, offset, limit) => {
      const remaining = Math.max(0, Math.min(limit, rows - offset));
      return ok(
        Array.from({ length: remaining }, (_value, index) => ({
          city_id: CITY,
          driver_id: `d${offset + index}`,
          position: "SRID=4326;POINT(39 21)",
          recorded_at: `${DAY}T00:00:00.000+00`,
          written_at: `${DAY}T00:00:01.000+00`,
          accuracy_m: 10,
          quality: "good",
          source: "batch",
        })),
      );
    },
    recordPart: async (input) => {
      state.recorded.push(input.part);
      return ok(undefined);
    },
    markVerified: async (_cityId, _day, part) => {
      state.verified.push(part);
      return ok(undefined);
    },
    dropDay: async (day) => {
      state.dropCalls.push(day);
      return ok({ status: "dropped" as const, droppedRows: rows });
    },
    ...overrides,
  };
  return { catalog, state };
}

function createStore(overrides: Partial<ArchiveObjectStore> = {}): ArchiveObjectStore {
  const objects = new Map<string, Uint8Array>();
  return {
    upload: async (name, content) => {
      objects.set(name, content);
      return ok({ remoteFileId: name, bytes: content.byteLength });
    },
    download: async (remoteFileId) => {
      const stored = objects.get(remoteFileId);
      return stored === undefined ? err(new PortFailureError("test", "مفقودٌ")) : ok(stored);
    },
    ...overrides,
  };
}

/** ترميزٌ وبصمةٌ صريحانِ: البصمةُ طولُ المحتوى — يكفي لقياسِ الترتيبِ لا للأمانِ. */
const codec = {
  encode: (rows: readonly unknown[]): Uint8Array => new TextEncoder().encode(JSON.stringify(rows)),
  digest: (content: Uint8Array): string => `len:${content.byteLength}`,
};

describe("F7-06 — حالةُ استخدامِ أرشفةِ أقسامِ الموقعِ", () => {
  it("١) يُقسِّمُ الصفوفَ أجزاءً ويتحقّقُ من كلِّ جزءٍ قبلَ الإسقاطِ", async () => {
    const { catalog, state } = createCatalog(7);
    const report = await archiveDueLocationPartitions(
      { catalog, store: createStore(), codec },
      { hotDays: 14, maxDays: 3, partRows: 3 },
    );

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.partsUploaded).toBe(3);
    expect(report.value.rowsArchived).toBe(7);
    expect(state.recorded).toEqual([0, 1, 2]);
    expect(state.verified).toEqual([0, 1, 2]);
    expect(state.dropCalls).toEqual([DAY]);
    expect(report.value.partitionsDropped).toBe(1);
  });

  it("٢) **لا يُنادي الإسقاطَ ألبتّةَ** حينَ يسقطُ الرفعُ", async () => {
    const { catalog, state } = createCatalog(7);
    const store = createStore({
      upload: async () => err(new PortFailureError("test", "مخزنٌ ساقطٌ")),
    });

    const report = await archiveDueLocationPartitions(
      { catalog, store, codec },
      { hotDays: 14, maxDays: 3, partRows: 3 },
    );

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(state.dropCalls).toEqual([]);
    expect(report.value.partitionsDropped).toBe(0);
    expect(report.value.refused[0]?.reason).toContain("UPLOAD_FAILED");
  });

  it("٣) بصمةٌ لا تُطابِقُ تمنعُ التوسيمَ والإسقاطَ معاً", async () => {
    const { catalog, state } = createCatalog(3);
    const store = createStore({
      download: async () => ok(new TextEncoder().encode("غيرُ ما رُفِعَ تماماً")),
    });

    const report = await archiveDueLocationPartitions(
      { catalog, store, codec },
      { hotDays: 14, maxDays: 3, partRows: 3 },
    );

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(state.verified).toEqual([]);
    expect(state.dropCalls).toEqual([]);
    expect(report.value.refused[0]?.reason).toBe("DIGEST_MISMATCH");
  });

  it("٤) يتخطّى الأجزاءَ المُتحقَّقَ منها ولا يُعيدُ رفعَها", async () => {
    const { catalog, state } = createCatalog(7, {
      parts: async () =>
        ok([
          { part: 0, rowCount: 3, verified: true },
          { part: 1, rowCount: 3, verified: true },
        ]),
    });

    const report = await archiveDueLocationPartitions(
      { catalog, store: createStore(), codec },
      { hotDays: 14, maxDays: 3, partRows: 3 },
    );

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(state.recorded).toEqual([2]);
    expect(report.value.partsUploaded).toBe(1);
    expect(report.value.rowsArchived).toBe(1);
  });

  it("٥) الرفضُ من القاعدةِ يُسجَّلُ سبباً ولا يُعَدُّ إسقاطاً", async () => {
    const { catalog } = createCatalog(3, {
      dropDay: async () => ok({ status: "refused" as const, reason: "ARCHIVE_INCOMPLETE" }),
    });

    const report = await archiveDueLocationPartitions(
      { catalog, store: createStore(), codec },
      { hotDays: 14, maxDays: 3, partRows: 3 },
    );

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.partitionsDropped).toBe(0);
    expect(report.value.refused).toEqual([{ day: DAY, reason: "ARCHIVE_INCOMPLETE" }]);
  });

  it("٦) اسمُ الكائنِ مقروءٌ ومرتَّبٌ بالتاريخِ ثمَّ بالمدينةِ ثمَّ بالجزءِ", () => {
    expect(archiveObjectName(DAY, CITY, 7)).toBe(`location-archive/${DAY}/${CITY}-00007.ndjson`);
  });
});
