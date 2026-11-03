/**
 * `WR-33` — تنبيهُ التحويلاتِ الماليّةِ المسبقة في المِنِي آب: يظهرُ قبلَ الإرسالِ لكلِّ طلبٍ جديد
 * (مشوارٍ وتوصيل)، والإرسالُ لا يخرجُ إلّا من زرِّ إقرارِه، والإقرارُ يصلُ جسمَ الطلبِ إلى الخادمِ
 * الحقيقيِّ الذي يرفضُ ما سواه.
 *
 * لا بيئةَ DOM في المستودع: «الضغطُ» يُقاسُ بنداءِ مُعالِجِ الزرِّ من شجرةِ العُقَدِ التي يُرجِعُها
 * `RequestForm` (مكوّنٌ بلا خطّافاتٍ — حالتُه كلُّها في `RequestFormModel`)، والعرضُ بـ`renderToStaticMarkup`.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { requirePrepayWarningAck } from "../../../../../packages/application/transport/prepay-warning-guard.ts";
import type { RideRequestCommand } from "../../../../../packages/application/transport/ride-request-ports.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../../../../packages/infrastructure/identity/miniapp-session.ts";
import ar from "../../../../../packages/shared/i18n/miniapp/ar.json" with { type: "json" };
import en from "../../../../../packages/shared/i18n/miniapp/en.json" with { type: "json" };
import ur from "../../../../../packages/shared/i18n/miniapp/ur.json" with { type: "json" };
import { PREPAY_WARNING_ACK_VERSION } from "../../../../../packages/shared/prepay-warning/index.ts";
import { ok } from "../../../../../packages/shared/result/index.ts";
import { createServer } from "../../../../gateway/src/server.ts";
import type { RequestFormModel } from "./quote/QuoteScreen.tsx";
import type { RequestIntent } from "./quote/request-form.ts";

const sent: { path: string; idempotencyKey: unknown; body: Record<string, unknown> }[] = [];
const recordFetch = async (path: string, init: Record<string, unknown>) => {
  sent.push({
    path,
    idempotencyKey: init.idempotencyKey,
    body: init.body as Record<string, unknown>,
  });
  return { ok: true, accepted: true, orderId: "o", createdAt: "x", reused: false };
};

const { RequestForm } = await import("./quote/QuoteScreen.tsx");
const { PrepayWarningGate, PREPAY_WARNING_LINE_KEYS } = await import(
  "./quote/PrepayWarningGate.tsx"
);
const { requestByService } = await import("./search/request-by-service.ts");
const { rideErrorKey, isRetryableRideError } = await import("./search/search-view.ts");

const SCREEN = readFileSync(new URL("./quote/QuoteScreen.tsx", import.meta.url), "utf8");
const SEARCH = readFileSync(new URL("./search/SearchScreen.tsx", import.meta.url), "utf8");

const RESPONSE = {
  ok: true,
  accepted: true,
  city: { code: "MED", nameAr: "المدينة المنورة", nameEn: "Madinah" },
  distance: { kind: "STRAIGHT_LINE", meters: 4200 },
  eta: { kind: "UNAVAILABLE", reason: "PROVIDER_DOWN" },
  services: [
    { service: "transport", available: true },
    { service: "delivery", available: true },
  ],
} as const;
const PICKUP = { label: "البيت", lat: 24.5, lng: 39.58, cityCode: "MED" };
const DESTINATION = { label: "الحرم", lat: 24.467, lng: 39.611 };

interface Spy {
  pending: (RequestIntent | null)[];
  requests: Record<string, unknown>[];
}

function model(spy: Spy, over: Partial<RequestFormModel> = {}): RequestFormModel {
  const noop = () => {};
  return {
    notes: "صندوق كتب",
    setNotes: noop,
    pickupMode: "now",
    setPickupMode: noop,
    pickupClock: "",
    setPickupClock: noop,
    pickupError: false,
    setPickupError: noop,
    parcelError: null,
    setParcelError: noop,
    notesTooLong: false,
    setNotesTooLong: noop,
    offerMode: "open",
    setOfferMode: noop,
    offerText: "",
    setOfferText: noop,
    offerError: null,
    setOfferError: noop,
    pickedService: null,
    setPickedService: noop,
    prepayPending: null,
    setPrepayPending: (value) => spy.pending.push(value),
    ...over,
  };
}

function props(service: "transport" | "delivery", spy: Spy, over: Partial<RequestFormModel> = {}) {
  return {
    language: "ar" as const,
    response: RESPONSE as never,
    origin: { lat: PICKUP.lat, lng: PICKUP.lng },
    destination: DESTINATION,
    service,
    pickup: PICKUP,
    onChangePickup: () => {},
    onBack: () => {},
    onRequest: (intent: Record<string, unknown>) => spy.requests.push(intent),
    form: model(spy, over),
  };
}

type Node = { type?: unknown; props?: Record<string, unknown> } | null | undefined;

/** يمشي شجرةَ العُقَدِ (بلا توسيعِ المكوّنات) ويُرجِعُ أوّلَ عقدةٍ تحقّقُ الشرط. */
/** ينادي معالجًا مستخرَجًا من الشجرة، ويفشلُ صريحًا إن لم يكن دالّة. */
function invoke(handler: unknown): void {
  if (typeof handler !== "function") throw new Error("المعالجُ غائب");
  handler();
}

function find(
  node: unknown,
  match: (n: { type?: unknown; props: Record<string, unknown> }) => boolean,
): Node {
  if (node === null || node === undefined || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, match);
      if (hit) return hit;
    }
    return null;
  }
  const n = node as { type?: unknown; props?: Record<string, unknown> };
  if (n.props !== undefined && match({ type: n.type, props: n.props })) return n;
  return n.props === undefined ? null : find(n.props.children, match);
}

const ARABIC_LINES = PREPAY_WARNING_LINE_KEYS.map((key) => (ar as Record<string, string>)[key]);

describe("WR-33 — بوّابةُ التنبيهِ قبلَ الإرسال (مشوارٌ وتوصيل)", () => {
  for (const service of ["transport", "delivery"] as const) {
    it(`${service}: «اطلب» لا يُرسِل — يفتحُ البوّابةَ بالنيّة، والإرسالُ من زرِّ الإقرارِ وحدَه`, () => {
      const spy: Spy = { pending: [], requests: [] };
      const tree = RequestForm(props(service, spy) as never);
      // قبلَ الضغط: النموذجُ بلا بوّابة، والتنبيهُ لم يُرسَم بعد.
      const before = renderToStaticMarkup(tree as never);
      expect(before).toContain('class="qt__submit"');
      expect(before).not.toContain("qt__prepay");
      const submit = find(tree, (n) => n.props.className === "qt__submit");
      expect(submit).toBeTruthy();
      invoke(submit?.props?.onClick);
      // الضغطُ يُعلِّقُ النيّةَ ولا يُرسِلُها.
      expect(spy.requests).toHaveLength(0);
      expect(spy.pending).toHaveLength(1);
      const pending = spy.pending[0];
      if (pending === null || pending === undefined) throw new Error("لا نيّةَ معلَّقة");
      expect(pending.service).toBe(service);
      expect("prepayWarningAck" in pending).toBe(false);

      // البوّابةُ مكانَ النموذج: لا زرَّ إرسالٍ ولا حقول، والتنبيهُ بنقاطِه الأربعِ بترتيبِها.
      const gated = RequestForm(props(service, spy, { prepayPending: pending }) as never);
      const html = renderToStaticMarkup(gated as never);
      expect(html).not.toContain('class="qt__submit"');
      expect(html).not.toContain("qt__request");
      expect(html).toContain('role="alertdialog"');
      expect(html).toContain(ar["rider.quote.prepay.title"]);
      let cursor = html.indexOf(ar["rider.quote.prepay.title"]);
      for (const line of ARABIC_LINES) {
        const at = html.indexOf(line ?? "<missing>");
        expect(at).toBeGreaterThan(cursor);
        cursor = at;
      }
      expect(html.indexOf(ar["rider.quote.prepay.confirm"])).toBeGreaterThan(cursor);

      // الإقرارُ يُرسِلُ النيّةَ نفسَها (المفتاحُ نفسُه) ومعها رمزُ الإصدار.
      const gate = find(gated, (n) => n.type === PrepayWarningGate);
      invoke(gate?.props?.onConfirm);
      expect(spy.requests).toHaveLength(1);
      expect(spy.requests[0]).toMatchObject({
        service,
        idempotencyKey: pending.idempotencyKey,
        prepayWarningAck: PREPAY_WARNING_ACK_VERSION,
      });
      // «رجوع» يُغلقُ البوّابةَ ولا يُرسِل.
      invoke(gate?.props?.onCancel);
      expect(spy.pending.at(-1)).toBeNull();
      expect(spy.requests).toHaveLength(1);
    });
  }

  it("لكلِّ طلبٍ جديدٍ بوّابةٌ مغلقةٌ من جديد، ولا عرضَ أثناءَ متابعةِ الطلبِ نفسِه", () => {
    // الحالةُ تبدأُ `null` في كلِّ `QuoteScreen` (= كلِّ طلبٍ جديد)، وتُصفَّرُ مع كلِّ اقتباسٍ جديد.
    expect(SCREEN).toContain("useState<RequestIntent | null>(null)");
    expect(SCREEN).toMatch(
      /const ask = useCallback\(async \(\) => \{[\s\S]{0,400}setPrepayPending\(null\)/,
    );
    // لا مسارَ إرسالٍ آخرَ في الشاشة: `onRequest(` يُنادى من البوّابةِ وحدَها.
    const calls = SCREEN.match(/\bonRequest\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(SCREEN).toContain(
      "onRequest({ ...prepayPending, prepayWarningAck: PREPAY_WARNING_ACK_VERSION })",
    );
    // المتابعةُ (`SearchScreen`) تُعيدُ الإقرارَ مع النيّةِ في كلِّ محاولةٍ — ولا ترسمُ التنبيه.
    expect(SEARCH).toContain("prepayWarningAck: intent.prepayWarningAck");
    expect(SEARCH).not.toContain("PrepayWarningGate");
  });

  it("النصُّ في اللغاتِ الثلاث، والعربيّةُ تحملُ المعنى كاملًا بلا تخفيف", () => {
    const keys = [
      "rider.quote.prepay.title",
      ...PREPAY_WARNING_LINE_KEYS,
      "rider.quote.prepay.confirm",
      "rider.quote.prepay.back",
      "rider.search.error.prepayAck",
    ];
    for (const dict of [ar, en, ur] as Record<string, string>[]) {
      for (const key of keys) expect((dict[key] ?? "").trim().length).toBeGreaterThan(0);
    }
    const arabic = ARABIC_LINES.join(" ");
    expect(arabic).toContain("لا تحوّل أي مبلغ مقدمًا");
    expect(arabic).toContain("السائق");
    expect(arabic).toContain("لا تطلب منك");
    expect(arabic).toContain("ولا تستلم");
    expect(arabic).toContain("لا تتحمّل مسؤولية");
    expect(arabic).toContain("أبلغنا");
    // كلُّ نقطةٍ قصيرةٌ تُقرَأُ على الهاتفِ بنظرة — لا فقرةٌ طويلةٌ يضيعُ فيها التنبيه.
    for (const line of ARABIC_LINES) expect((line ?? "").length).toBeLessThanOrEqual(90);
  });

  it("رفضُ الخادمِ لغيابِ الإقرارِ رسالةٌ مفهومةٌ لا «تعذّرٌ» عامّ، ولا تُعادُ المحاولةُ آليًّا", () => {
    expect(rideErrorKey("PREPAY_WARNING_ACK_REQUIRED")).toBe("rider.search.error.prepayAck");
    expect(isRetryableRideError("PREPAY_WARNING_ACK_REQUIRED")).toBe(false);
  });
});

describe("WR-33 — الإقرارُ يصلُ الخادمَ الحقيقيَّ، والخادمُ يرفضُ ما سواه", () => {
  const SECRET = "test-only-session-signing-secret-0123456789";
  const NOW = new Date("2027-03-01T09:00:00.000Z");

  function server() {
    const created: { service: string; key: string; ack: unknown }[] = [];
    const inner: RideRequestCommand = {
      create: async (input) => {
        created.push({
          service: input.service,
          key: input.idempotencyKey,
          ack: input.prepayWarningAck,
        });
        return ok({
          accepted: true,
          ride: {
            orderId: "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f",
            createdAtMs: NOW.getTime(),
            reused: false,
          },
        });
      },
    };
    // الحارسُ كما يُركَّبُ في `apps/gateway/src/index.ts` (والتركيبُ نفسُه يحرسُه اختبارُ التركيب).
    const rides = requirePrepayWarningAck(inner);
    const sessions = createMiniAppSessionReader(SECRET);
    const now = () => NOW;
    const app = createServer({
      health: { now, startedAt: NOW, env: {} },
      webhook: {
        webhookSecret: "test-webhook-secret-value",
        handler: { handle: async () => true },
      },
      rides: { request: { sessions, rides, now } },
      deliveries: { request: { sessions, rides, now } } as never,
    });
    const issued = createMiniAppSessionIssuer({ secret: SECRET }).issue(
      {
        telegramUserId: "5550001",
        bot: "rider",
        authDateSeconds: Math.floor(NOW.getTime() / 1000),
      },
      NOW.getTime(),
    );
    if (!issued.ok) throw new Error("إصدار فاشل");
    const post = (path: string, key: string, body: Record<string, unknown>) =>
      app.fetch(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${issued.value.accessToken}`,
            "idempotency-key": key,
          },
          body: JSON.stringify(body),
        }),
      );
    return { created, post };
  }

  it("مشوارٌ وتوصيلٌ من النموذجِ عبرَ البوّابة ← جسمُ الطلب ← الخادم: يُنشآنِ بالإقرار", async () => {
    sent.length = 0;
    for (const service of ["transport", "delivery"] as const) {
      const spy: Spy = { pending: [], requests: [] };
      const tree = RequestForm(props(service, spy) as never);
      invoke(find(tree, (n) => n.props.className === "qt__submit")?.props?.onClick);
      const gated = RequestForm(
        props(service, spy, { prepayPending: spy.pending[0] ?? null }) as never,
      );
      invoke(find(gated, (n) => n.type === PrepayWarningGate)?.props?.onConfirm);
      const intent = spy.requests[0] as { notes?: string | null } & Record<string, unknown>;
      await requestByService({ ...intent, notes: intent.notes ?? "" } as never, recordFetch);
    }
    expect(sent.map((s) => s.path)).toEqual(["/v1/rides", "/v1/deliveries"]);
    for (const s of sent) expect(s.body.prepayWarningAck).toBe(PREPAY_WARNING_ACK_VERSION);

    const { created, post } = server();
    for (const s of sent) {
      const response = await post(s.path, String(s.idempotencyKey), s.body);
      expect(response.status).toBe(200);
    }
    expect(created.map((c) => c.service)).toEqual(["transport", "delivery"]);
    expect(created.every((c) => c.ack === PREPAY_WARNING_ACK_VERSION)).toBe(true);
  });

  it("لا تجاوزَ بمسارِ API مباشر: بلا إقرارٍ أو بإقرارٍ مزيّفٍ ← 400 ولا نداءَ للمنفذ", async () => {
    const { created, post } = server();
    const ride = {
      service: "transport",
      originLat: PICKUP.lat,
      originLng: PICKUP.lng,
      destinationLat: DESTINATION.lat,
      destinationLng: DESTINATION.lng,
    };
    const delivery = { ...ride, service: "delivery", notes: "صندوق كتب" };
    for (const [path, body] of [
      ["/v1/rides", ride],
      ["/v1/rides", { ...ride, prepayWarningAck: true }],
      ["/v1/rides", { ...ride, prepayWarningAck: "prepay-warning-v0" }],
      ["/v1/rides", delivery],
      ["/v1/deliveries", delivery],
      ["/v1/deliveries", { ...delivery, prepayWarningAck: "yes" }],
    ] as const) {
      const response = await post(path, `ride:bypass-${Math.random().toString(36).slice(2)}`, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: "PREPAY_WARNING_ACK_REQUIRED",
      });
    }
    expect(created).toHaveLength(0);
  });

  it("متابعةُ الطلبِ نفسِه (إعادةُ المحاولةِ بالمفتاحِ نفسِه) تحملُ الإقرارَ ولا تحتاجُ عرضًا ثانيًا؛ وطلبٌ جديدٌ يحتاجُه", async () => {
    const { created, post } = server();
    const body = {
      service: "transport",
      originLat: PICKUP.lat,
      originLng: PICKUP.lng,
      destinationLat: DESTINATION.lat,
      destinationLng: DESTINATION.lng,
      prepayWarningAck: PREPAY_WARNING_ACK_VERSION,
    };
    expect((await post("/v1/rides", "ride:same-intent-1", body)).status).toBe(200);
    expect((await post("/v1/rides", "ride:same-intent-1", body)).status).toBe(200);
    const { prepayWarningAck: _dropped, ...withoutAck } = body;
    expect((await post("/v1/rides", "ride:new-intent-2", withoutAck)).status).toBe(400);
    expect(created.map((c) => c.key)).toEqual(["ride:same-intent-1", "ride:same-intent-1"]);
  });
});
