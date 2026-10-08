/**
 * الغرض: قياسُ واجهةِ الراكبِ في `LOC-TRUST-01` (ADR 0247) بلا مُضيفِ Telegram:
 *   قراءةُ الجهازِ الحديثة (`maximumAge: 0`، الدقّةُ ووقتُ الالتقاط)، وشروطُ الاعتمادِ الصريح
 *   (الرديئةُ ممنوعة، والخشنةُ بإقرار)، وقراءةُ النصِّ الملصوق، وأنَّ أقربَ معلَمٍ وصفٌ لا اسم.
 * ينتمي إلى: tests/unit · يُستخدم من: CI.
 */
import { describe, expect, it } from "bun:test";
import { readBrowserFix } from "../../apps/miniapp/src/surfaces/rider/destination/browser-fix.ts";
import {
  confirmBlocker,
  formatPoint,
  landmarkPhrase,
  placeWire,
  readPastedPlace,
} from "../../apps/miniapp/src/surfaces/rider/destination/destination-view.ts";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const POINT = { lat: 24.4672, lng: 39.6111 };

describe("قراءةُ الجهازِ الحديثةُ والاعتمادُ الصريح", () => {
  it("تطلبُ قراءةً جديدةً (maximumAge: 0، دقّةٌ عالية) وتحفظُ الدقّةَ ووقتَ الالتقاط", async () => {
    let options: unknown = null;
    const fix = await readBrowserFix({
      getCurrentPosition(success, _failure, given) {
        options = given;
        success({ coords: { latitude: 24.5, longitude: 39.6, accuracy: 12 }, timestamp: NOW });
      },
    });
    expect(options).toMatchObject({ maximumAge: 0, enableHighAccuracy: true });
    expect(fix).toEqual({ ok: true, lat: 24.5, lng: 39.6, accuracyM: 12, capturedAtMs: NOW });
  });
  it("رفضُ المتصفّحِ أو غيابُه ⇒ null (فيُجرَّبُ Telegram) ولا يُختلَقُ موقع", async () => {
    expect(
      await readBrowserFix({ getCurrentPosition: (_s, failure) => failure({ code: 1 }) }),
    ).toBeNull();
    expect(await readBrowserFix(undefined)).toBeNull();
  });
  it("الاعتمادُ: الرديئةُ ممنوعة، والخشنةُ بإقرارٍ فقط، والجيّدةُ مباشرة", () => {
    const base = { source: "DEVICE" as const, linkConflict: false, notesTooLong: false };
    expect(
      confirmBlocker({
        ...base,
        acknowledged: true,
        assessment: { verdict: "UNRELIABLE", reasons: [] },
      }),
    ).toBe("rider.place.fix.unreliable");
    expect(
      confirmBlocker({
        ...base,
        acknowledged: false,
        assessment: { verdict: "COARSE", reasons: [] },
      }),
    ).toBe("rider.place.fix.ackRequired");
    expect(
      confirmBlocker({
        ...base,
        acknowledged: true,
        assessment: { verdict: "COARSE", reasons: [] },
      }),
    ).toBeNull();
    expect(
      confirmBlocker({
        ...base,
        acknowledged: false,
        assessment: { verdict: "GOOD", reasons: [] },
      }),
    ).toBeNull();
  });

  it("النصُّ الملصوق: إحداثيّاتٌ تُقرأُ نقطةً، ونصٌّ بلا رابطٍ يُرفَضُ بمفتاحِ نصّ", () => {
    expect(readPastedPlace("24.4672, 39.6111")).toEqual({ kind: "coordinates", ...POINT });
    const refused = readPastedPlace("hello");
    expect(refused).toEqual({ kind: "refused", messageKey: "rider.place.link.notALink" });
    const link = readPastedPlace("https://maps.app.goo.gl/AbCdEf12345");
    expect(link.kind === "link" && link.link.point).toBeNull();
  });
});

describe("أقربُ معلَمٍ وصفٌ لا اسم", () => {
  it("لا يتكرّرُ الصنفُ («مسجد مسجد»)، والنقطةُ تُعرَضُ بخمسِ منازل", () => {
    expect(landmarkPhrase("مسجد", "مسجد بلال بن رباح")).toBe("مسجد بلال بن رباح");
    expect(landmarkPhrase("حي", "العزيزية")).toBe("حي العزيزية");
    expect(formatPoint(24.4672, 39.6111)).toBe("24.46720, 39.61110");
  });

  it("حمولةُ السلكِ لا تحملُ اسماً: الاسمُ ما كتبَه الراكبُ فقط ويذهبُ في حقلِه", () => {
    const wire = placeWire({
      label: null,
      source: "DEVICE",
      accuracyM: 9,
      capturedAt: null,
      link: null,
      notes: null,
    });
    expect(Object.keys(wire)).not.toContain("label");
  });
});
