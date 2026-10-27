/**
 * الغرض: `LOAD-01` (CLAIM-SPLIT) — تفكيكُ زمنِ الالتقاطِ الجداريّ إلى ما قبلَ الخادمِ والتنفيذِ وما بعدَه،
 *   ومسبارُ حلقةِ الأحداث. رصدٌ فقط: الاستعلامُ الافتراضيُّ بنصِّه حينَ يكونُ التفكيكُ مطفأً.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import {
  notificationClaimSplitFromEnv,
  notificationClaimSplitLogFields,
} from "../../apps/workers/src/jobs/deliver-notifications.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createCalibratedClock,
  createLoopProbe,
} from "../../packages/infrastructure/notification/claim-split-probe.ts";
import {
  createNotificationOutboxPort,
  splitOfQuery,
} from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";

const DID = "0b9e3c0e-6a43-4c55-9d52-3b0a8b7f2a11";
const delivery = {
  delivery_id: DID,
  kind: "rider_trip_notice",
  city_id: "c",
  claim_token: "t",
  attempts: 1,
  max_attempts: 3,
  batch_limit: 8,
  payload: {},
};

/** `sql` مزيّف: يسجّلُ نصَّ كلِّ استعلامٍ ويُرجعُ صفوفًا بحسبه، ويقدّمُ الساعةَ المزيّفة. */
function fakeSql(opts: { delivery: boolean; clock: { t: number } }) {
  const texts: string[] = [];
  const fn = async (strings: TemplateStringsArray) => {
    const text = strings.join("$");
    texts.push(text);
    const stamped = text.includes("statement_timestamp");
    // الإصدار t، ثمّ يبدأُ الخادمُ بعدَ 3ms، وينفّذُ 2ms، وتعودُ النتيجةُ بعدَ 1ms.
    const st = opts.clock.t + 3;
    const ct = st + 2;
    opts.clock.t = ct + 1;
    const stamp = stamped ? { st_ms: st, ct_ms: ct } : {};
    if (text.includes("claim_notification_delivery")) {
      return [
        {
          result: { ok: true, delivery: opts.delivery ? delivery : null },
          ...stamp,
        },
      ];
    }
    return [{ request_id: null, ...stamp }];
  };
  return { sql: fn as unknown as Sql, texts };
}

describe("splitOfQuery", () => {
  test("الأجزاءُ الثلاثةُ تجمعُ الزمنَ الجداريّ؛ والقيمةُ السالبةُ تُعَدُّ skewed", () => {
    expect(splitOfQuery(100, 110, { st_ms: 103, ct_ms: 108 })).toEqual({
      preMs: 3,
      serverMs: 5,
      postMs: 2,
      skewed: 0,
    });
    expect(splitOfQuery(100, 110, { st_ms: 99, ct_ms: 108 }).skewed).toBe(1);
    expect(splitOfQuery(100, 110, { st_ms: 103, ct_ms: 111 }).skewed).toBe(1);
    expect(splitOfQuery(100, 110, undefined)).toEqual({
      preMs: 10,
      serverMs: 0,
      postMs: 0,
      skewed: 1,
    });
  });
});

describe("محوّلُ الصندوقِ مع CLAIM-SPLIT", () => {
  test("مطفأ: النصّانِ الافتراضيّانِ بلا ختمٍ ولا timing", async () => {
    const f = fakeSql({ delivery: true, clock: { t: 0 } });
    const r = await createNotificationOutboxPort(f.sql).claim();
    expect(r.ok && r.value.timing).toBeUndefined();
    expect(f.texts).toHaveLength(2);
    expect(f.texts[0]).toBe("select claim_notification_delivery() result");
    expect(f.texts.some((t) => t.includes("statement_timestamp"))).toBe(false);
  });

  test("مشعَل: استعلامانِ مختومانِ ⇒ timing بجمعِ الأجزاء؛ وبلا صفٍّ استعلامٌ واحد", async () => {
    const clock = { t: 1_000 };
    const f = fakeSql({ delivery: true, clock });
    const port = createNotificationOutboxPort(f.sql, { claimSplit: { realtimeMs: () => clock.t } });
    const r = await port.claim();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.delivery?.deliveryId).toBe(DID);
    expect(r.value.timing).toMatchObject({
      queries: 2,
      preMs: 6,
      serverMs: 4,
      postMs: 2,
      skewed: 0,
    });
    // CLAIM-WAIT: تفصيلٌ لكلِّ استعلام؛ والمزيّفُ لا يمرُّ بمراحلِ postgres.js فلا يُعَدُّ مرصودًا.
    expect(r.value.timing?.detail?.map((d) => [d.index, d.preMs, d.stamped, d.inflight])).toEqual([
      [1, 3, false, null],
      [2, 3, false, null],
    ]);
    expect(f.texts.every((t) => t.includes("statement_timestamp"))).toBe(true);
    expect(f.texts[0]).toContain("offset 0");

    const g = fakeSql({ delivery: false, clock });
    const e = await createNotificationOutboxPort(g.sql, {
      claimSplit: { realtimeMs: () => clock.t },
    }).claim();
    expect(e.ok && e.value.delivery).toBeNull();
    expect(e.ok && e.value.timing).toMatchObject({
      queries: 1,
      preMs: 3,
      serverMs: 2,
      postMs: 1,
      skewed: 0,
    });
    expect(e.ok && e.value.timing?.detail?.length).toBe(1);
  });
});

describe("الساعةُ المعايَرةُ ومسبارُ الحلقة", () => {
  test("المعايرةُ عندَ تبدّلِ Date.now() تضبطُ الفرقَ بدقّة", () => {
    let mono = 0;
    const monoNow = () => {
      mono += 0.25;
      return mono;
    };
    // الزمنُ الحقيقيُّ = 5000 + mono تمامًا، وDate.now() يقطعُه إلى ملّي ثانية.
    const dateNow = () => Math.floor(5_000 + mono);
    const c = createCalibratedClock({ dateNow, monoNow });
    const off = c.calibrate();
    expect(off).toBeGreaterThan(4_999.7);
    expect(off).toBeLessThanOrEqual(5_000);
    expect(Math.abs(c.realtimeMs() - (5_000 + mono))).toBeLessThan(0.5);
  });

  test("المسبار: start/read/stop تُرجعُ أعدادًا صحيحةً غيرَ سالبة", async () => {
    const p = createLoopProbe(10);
    p.start();
    await new Promise((r) => setTimeout(r, 30));
    const x = p.read();
    p.stop();
    for (const v of Object.values(x)) expect(Number.isInteger(v)).toBe(true);
    expect(x.delayMeanUs).toBeGreaterThanOrEqual(0);
    expect(x.delayMaxUs).toBeGreaterThanOrEqual(x.delayMeanUs);
    // -1 = غيرُ متاحٍ في وقتِ التشغيل (Bun)، وإلّا 0..1000.
    expect(x.eluPermille === -1 || (x.eluPermille >= 0 && x.eluPermille <= 1000)).toBe(true);
  });
});

describe("ضبطُ البيئةِ وحقولُ السطر", () => {
  test("NOTIFICATION_CLAIM_SPLIT: 1 يُشعل، والغيابُ/0 يُطفئ، وغيرُهما يُطفئُ ويُعلَن", () => {
    expect(notificationClaimSplitFromEnv({})).toEqual({ enabled: false, invalid: false });
    expect(notificationClaimSplitFromEnv({ NOTIFICATION_CLAIM_SPLIT: "0" })).toEqual({
      enabled: false,
      invalid: false,
    });
    expect(notificationClaimSplitFromEnv({ NOTIFICATION_CLAIM_SPLIT: "1" })).toEqual({
      enabled: true,
      invalid: false,
    });
    expect(notificationClaimSplitFromEnv({ NOTIFICATION_CLAIM_SPLIT: "yes" })).toEqual({
      enabled: false,
      invalid: true,
    });
  });

  test("حقولُ السطرِ قائمةٌ مغلقةٌ بأعدادٍ صحيحة", () => {
    const f = notificationClaimSplitLogFields(
      { timed: 10, queries: 19, preMs: 30.4, serverMs: 20.6, postMs: -0.2, skewed: 1 },
      { delayMeanUs: 1200, delayP99Us: 9000, delayMaxUs: 15000, eluPermille: 870 },
    );
    expect(f).toEqual([
      "claim_timed=10",
      "claim_queries=19",
      "claim_pre_ms=30",
      "claim_server_ms=21",
      "claim_post_ms=0",
      "claim_skewed=1",
      "el_delay_mean_us=1200",
      "el_delay_p99_us=9000",
      "el_delay_max_us=15000",
      "elu_permille=870",
    ]);
  });
});
