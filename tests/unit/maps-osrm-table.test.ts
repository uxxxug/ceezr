/**
 * الغرض: إثبات عطب `table` في مزوّد OSRM (البند P1-8 من خط الأساس) ثم حمايته.
 *   العطب حسابيّ لا شبكيّ: نداءٌ ينجح، ورقمٌ يُعاد، والمصفوفة تخصّ وجهاتٍ أخرى.
 *   ولذلك لا يُكتشف بمراقبة أخطاء ولا بفحص صحّة: يحتاج قياس **ما يُطلب** فعلاً.
 * الحالة: منفّذ فعلياً — المرحلة ٩.
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: من يصل ETA بمزوّد آخر (المرحلة ١٥) يلزمه نفس هذه الحالات لمزوّده.
 */

import { describe, expect, it } from "bun:test";
import type { LatLng } from "../../packages/maps/core/types.ts";
import { createOsrmProvider } from "../../packages/maps/providers/osrm/osrm-provider.ts";

/** خادمٌ حقيقي يسجّل المسار المطلوب ويردّ بما نحدّده: العطب في بناء الطلب. */
async function withRecordingServer<T>(
  handler: (path: string) => unknown,
  fn: (baseUrl: string, paths: string[]) => Promise<T>,
): Promise<T> {
  const paths: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      paths.push(`${url.pathname}${url.search}`);
      return new Response(JSON.stringify(handler(`${url.pathname}${url.search}`)), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  try {
    return await fn(`http://localhost:${server.port}`, paths);
  } finally {
    server.stop(true);
  }
}

/** ثلاث نقاطٍ في جدة كمصادر، وثلاثٌ كوجهات — أصغر حجمٍ يُظهر العطب. */
const S: readonly LatLng[] = [
  { lat: 21.4858, lng: 39.1925 },
  { lat: 21.5169, lng: 39.2192 },
  { lat: 21.543, lng: 39.1728 },
];
const D: readonly LatLng[] = [
  { lat: 21.6, lng: 39.15 },
  { lat: 21.62, lng: 39.17 },
  { lat: 21.64, lng: 39.19 },
];

/** استجابةٌ صحيحة الشكل بمقاس 3×3، بأرقامٍ يُميّز بعضها بعضاً. */
const TABLE_3x3 = {
  code: "Ok",
  distances: [
    [1000, 2000, 3000],
    [1100, 2100, 3100],
    [1200, 2200, 3200],
  ],
  durations: [
    [100, 200, 300],
    [110, 210, 310],
    [120, 220, 320],
  ],
};

describe("maps: OSRM table — فهرسة الوجهات (P1-8)", () => {
  it("يطلب مدى الوجهات كاملاً لا وجهتين", async () => {
    await withRecordingServer(
      () => TABLE_3x3,
      async (baseUrl, paths) => {
        const provider = createOsrmProvider({ baseUrl });
        const result = await provider.table(S, D);
        expect(result.ok).toBe(true);

        const query = new URL(`http://x${paths[0]}`).searchParams;
        // ٣ مصادر (0;1;2) و٣ وجهات في المصفوفة المدمجة (3;4;5)
        expect(query.get("sources")).toBe("0;1;2");
        expect(query.get("destinations")).toBe("3;4;5");
      },
    );
  });

  it("لا يطلب فهرساً يشير إلى مصدرٍ على أنه وجهة", async () => {
    await withRecordingServer(
      () => TABLE_3x3,
      async (baseUrl, paths) => {
        const provider = createOsrmProvider({ baseUrl });
        await provider.table(S, D);

        const query = new URL(`http://x${paths[0]}`).searchParams;
        const destIdx = (query.get("destinations") ?? "").split(";").map(Number);
        const srcIdx = (query.get("sources") ?? "").split(";").map(Number);
        // الفهرس ٢ مصدرٌ في المصفوفة المدمجة؛ طلبُه وجهةً يُنتج عموداً لنقطةٍ خطأ
        for (const d of destIdx) {
          expect(srcIdx).not.toContain(d);
          expect(d).toBeGreaterThanOrEqual(S.length);
        }
      },
    );
  });

  it("وجهةٌ واحدة تُطلب عموداً واحداً لا عمودين", async () => {
    await withRecordingServer(
      () => ({ code: "Ok", distances: [[1000], [1100], [1200]], durations: [[100], [110], [120]] }),
      async (baseUrl, paths) => {
        const provider = createOsrmProvider({ baseUrl });
        const oneDest = [D[0] as LatLng];
        const result = await provider.table(S, oneDest);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const query = new URL(`http://x${paths[0]}`).searchParams;
        // القديم كان يبني "3;0": الوجهةَ الصحيحة، ثم **المصدر الأول** وجهةً ثانية
        expect(query.get("destinations")).toBe("3");
        for (const row of result.value.rows) {
          expect(row.elements).toHaveLength(1);
        }
      },
    );
  });

  it("مقاس المصفوفة المُعادة يطابق عدد المصادر والوجهات", async () => {
    await withRecordingServer(
      () => TABLE_3x3,
      async (baseUrl) => {
        const provider = createOsrmProvider({ baseUrl });
        const result = await provider.table(S, D);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.rows).toHaveLength(S.length);
        for (const row of result.value.rows) {
          expect(row.elements).toHaveLength(D.length);
        }
        // ترتيب الأعمدة هو ترتيب الوجهات كما سلّمها النداء.
        // وقراءةُ الرقم تمرّ بفحص `status` لأن النوع اتحادٌ مُميَّز: المُصرِّف نفسه
        // يمنع قراءة مسافةٍ من عنصرٍ لا طريقَ فيه — وهو الحَرَس المقصود.
        const far = result.value.rows[0]?.elements[2];
        expect(far?.status).toBe("ok");
        if (far?.status === "ok") expect(far.distanceMeters).toBe(3000);

        const near = result.value.rows[2]?.elements[0];
        expect(near?.status).toBe("ok");
        if (near?.status === "ok") expect(near.durationSeconds).toBe(120);
      },
    );
  });
});

/**
 * لماذا كان العطب صامتاً: الخادم الحقيقي يردّ بمصفوفةٍ **مطابقةٍ للسؤال الخاطئ**.
 * فلا حالة خطأ ولا استثناء — أرقامٌ معقولةٌ تخصّ مواضع أخرى. وهذه الحالات تُثبت
 * أن المصفوفة المُنزاحة تُرفض اليوم بدل أن تُسلَّم.
 */
describe("maps: OSRM table — سلامة الردّ", () => {
  it("يرفض مصفوفةً مقاسُها يخالف ما طُلب بدل أن يُعيدها ناقصة", async () => {
    // ردٌّ ٣×٢ على طلبِ ٣×٣ — بالضبط ما كان الخادم يردّه على الطلب المعطوب
    await withRecordingServer(
      () => ({
        code: "Ok",
        distances: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
        durations: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
      }),
      async (baseUrl) => {
        const provider = createOsrmProvider({ baseUrl });
        const result = await provider.table(S, D);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe("protocol");
        expect(result.error.detail).toContain("shape mismatch");
      },
    );
  });

  it("`null` من OSRM تعني «لا طريق» لا «وصولٌ فوري»", async () => {
    await withRecordingServer(
      () => ({
        code: "Ok",
        distances: [
          [null, 2000, 3000],
          [1100, 2100, 3100],
          [1200, 2200, 3200],
        ],
        durations: [
          [null, 200, 300],
          [110, 210, 310],
          [120, 220, 320],
        ],
      }),
      async (baseUrl) => {
        const provider = createOsrmProvider({ baseUrl });
        const result = await provider.table(S, D);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const unreachable = result.value.rows[0]?.elements[0];
        expect(unreachable?.status).toBe("no_route");
        // الحرَس الفعلي: لا صفرَ مُقنَّعاً ولا `null` في حقلٍ نوعُه رقم
        expect(JSON.stringify(unreachable)).not.toContain("0");
        expect(JSON.stringify(unreachable)).not.toContain("null");
        expect(Object.keys(unreachable ?? {})).toEqual(["status"]);

        // وبقيّة الصفّ سليمة: زوجٌ واحد لا طريقَ له لا يُفسد المصفوفة
        expect(result.value.rows[0]?.elements[1]?.status).toBe("ok");
      },
    );
  });

  it("غيابُ تعليقة المسافة يُعاد خطأً لا انهياراً", async () => {
    // خادمٌ بُنيت خريطتُه بلا `--annotations` يُسقط `distances` كلّياً
    await withRecordingServer(
      () => ({
        code: "Ok",
        durations: [
          [1, 2, 3],
          [1, 2, 3],
          [1, 2, 3],
        ],
      }),
      async (baseUrl) => {
        const provider = createOsrmProvider({ baseUrl });
        // القديم كان يُلقي TypeError خارج أي try — أي يخلف عقد Result بانهيار
        const result = await provider.table(S, D);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe("protocol");
      },
    );
  });

  it("مدخلاتٌ فارغة تُرفض قبل أي نداء شبكة", async () => {
    await withRecordingServer(
      () => TABLE_3x3,
      async (baseUrl, paths) => {
        const provider = createOsrmProvider({ baseUrl });
        const noDest = await provider.table(S, []);
        const noSrc = await provider.table([], D);
        expect(noDest.ok).toBe(false);
        expect(noSrc.ok).toBe(false);
        if (!noDest.ok) expect(noDest.error.kind).toBe("invalid_request");
        // القديم كان يبني `?sources=&destinations=0;-1` ويُطلق نداءً محكومَ الفشل
        expect(paths).toHaveLength(0);
      },
    );
  });

  it("إحداثيةٌ غير صالحة تُرفض قبل أي نداء شبكة", async () => {
    await withRecordingServer(
      () => TABLE_3x3,
      async (baseUrl, paths) => {
        const provider = createOsrmProvider({ baseUrl });
        const result = await provider.table([{ lat: Number.NaN, lng: 39.2 }], D);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.kind).toBe("invalid_request");
        // `NaN` كان يُبنى في المسار نصّاً: `NaN,39.2`
        expect(paths).toHaveLength(0);
      },
    );
  });
});
