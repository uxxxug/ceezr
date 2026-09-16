/**
 * الغرض: إثباتُ حالةِ استخدامِ تحديثِ اللقطةِ ومحوّلِها (`F7-08` · `CAP-011`):
 *   نافذةٌ فاسدةٌ تُرفَضُ قبلَ لمسِ القاعدةِ، وحمولةٌ لا تُفهَمُ تُعلَنُ عطباً ولا
 *   تُرمَّمُ بساعةِ العاملِ، ورفضُ القاعدةِ يُصنَّفُ رفضاً لا عطبَ اتّصالٍ.
 * الحالة: منفَّذٌ فعليّاً — البند `F7-08`.
 * ينتمي إلى: tests/unit
 * يحرسُ: packages/application/admin/refresh-metric-snapshots.ts ·
 *   packages/infrastructure/admin/metric-snapshot-store.ts ·
 *   apps/workers/src/jobs/refresh-admin-metrics.ts
 * الحاكم: docs/adr/0128-an-aggregate-without-its-age-is-a-lie.md
 */

import { describe, expect, it } from "bun:test";
import { refreshAdminMetrics } from "../../apps/workers/src/jobs/refresh-admin-metrics.ts";
import {
  isMetricSnapshotRejection,
  type MetricSnapshotRefreshPort,
} from "../../packages/application/admin/metric-snapshot-ports.ts";
import { refreshMetricSnapshots } from "../../packages/application/admin/refresh-metric-snapshots.ts";
import { ADMIN_METRIC_WINDOW_HOURS } from "../../packages/domain/admin/metric-snapshot.ts";
import { createMetricSnapshotRefreshPort } from "../../packages/infrastructure/admin/metric-snapshot-store.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { ok } from "../../packages/shared/result/index.ts";

const NEVER_CALLED: MetricSnapshotRefreshPort = {
  refresh: () => {
    throw new Error("لا يجوزُ لمسُ القاعدةِ بنافذةٍ فاسدةٍ");
  },
};

function sqlReturning(payload: unknown): Sql {
  return (() => Promise.resolve([{ result: payload }])) as unknown as Sql;
}

function sqlThrowing(message: string): Sql {
  return (() => Promise.reject(new Error(message))) as unknown as Sql;
}

const GOOD_PAYLOAD = {
  ok: true,
  window_hours: ADMIN_METRIC_WINDOW_HOURS,
  computed_at: "2026-09-16T11:59:30.000Z",
  cities_written: 3,
};

describe("حالةُ الاستخدامِ: نافذةٌ فاسدةٌ تُرفَضُ قبلَ القاعدةِ", () => {
  for (const windowHours of [0, -1, 1.5, Number.NaN]) {
    it(`نافذةٌ ${String(windowHours)} تُرفَضُ ولا تُصلَحُ بنافذةٍ مُخترَعةٍ`, async () => {
      const result = await refreshMetricSnapshots({ port: NEVER_CALLED }, { windowHours });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isMetricSnapshotRejection(result.error)).toBe(true);
        if (isMetricSnapshotRejection(result.error)) {
          expect(result.error.rejection).toBe("INVALID_WINDOW_HOURS");
        }
      }
    });
  }

  it("نافذةٌ صالحةٌ تمرُّ إلى العقدِ بالرقمِ نفسِه لا بافتراضٍ", async () => {
    const seen: number[] = [];
    const port: MetricSnapshotRefreshPort = {
      refresh: async (windowHours) => {
        seen.push(windowHours);
        return ok({ windowHours, computedAt: GOOD_PAYLOAD.computed_at, citiesWritten: 3 });
      },
    };
    const result = await refreshMetricSnapshots({ port }, { windowHours: 48 });
    expect(result.ok).toBe(true);
    expect(seen).toEqual([48]);
  });

  it("مهمّةُ العاملِ لا تُغيّرُ الحكمَ — طبقةٌ رقيقةٌ لا سياسةٌ ثانيةٌ", async () => {
    const rejected = await refreshAdminMetrics({ port: NEVER_CALLED }, { windowHours: 0 });
    expect(rejected.ok).toBe(false);
  });
});

describe("المحوّلُ: زمنُ القياسِ من القاعدةِ وحدَها", () => {
  it("حمولةٌ سليمةٌ تُقرأُ كما هيَ", async () => {
    const port = createMetricSnapshotRefreshPort(sqlReturning(GOOD_PAYLOAD));
    const result = await port.refresh(ADMIN_METRIC_WINDOW_HOURS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.computedAt).toBe(GOOD_PAYLOAD.computed_at);
      expect(result.value.citiesWritten).toBe(3);
    }
  });

  it("زمنٌ غائبٌ ⇒ عطبٌ مُعلَنٌ **ولا يُرمَّمُ** بساعةِ العاملِ", async () => {
    const port = createMetricSnapshotRefreshPort(
      sqlReturning({ ok: true, cities_written: 3, window_hours: 24 }),
    );
    const result = await port.refresh(ADMIN_METRIC_WINDOW_HOURS);
    expect(result.ok).toBe(false);
    if (!result.ok && !isMetricSnapshotRejection(result.error)) {
      expect(result.error.reason).toBe("MALFORMED_RESULT");
    }
  });

  it("عدَدُ مدنٍ ليسَ رقماً ⇒ عطبٌ لا صفرٌ مفترضٌ", async () => {
    const port = createMetricSnapshotRefreshPort(
      sqlReturning({ ok: true, computed_at: GOOD_PAYLOAD.computed_at, cities_written: "ثلاثةٌ" }),
    );
    const result = await port.refresh(ADMIN_METRIC_WINDOW_HOURS);
    expect(result.ok).toBe(false);
  });

  it("رفضُ القاعدةِ يُصنَّفُ رفضاً لا عطبَ اتّصالٍ", async () => {
    const port = createMetricSnapshotRefreshPort(sqlThrowing("INVALID_WINDOW_HOURS: 0"));
    const result = await port.refresh(ADMIN_METRIC_WINDOW_HOURS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(isMetricSnapshotRejection(result.error)).toBe(true);
  });

  it("انقطاعُ الاتّصالِ يُصنَّفُ عطبَ مخزنٍ لا رفضاً", async () => {
    const port = createMetricSnapshotRefreshPort(sqlThrowing("connection terminated"));
    const result = await port.refresh(ADMIN_METRIC_WINDOW_HOURS);
    expect(result.ok).toBe(false);
    if (!result.ok && !isMetricSnapshotRejection(result.error)) {
      expect(result.error.reason).toBe("STORE_ERROR");
    }
  });
});
