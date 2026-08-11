/**
 * الغرض: البند 6.4 — صفحة تفاصيل السائق: أن ملفّ التسجيل كاملاً ورحلاته وتقييمه
 *   وتذاكره تُعرض فعلاً، وأن حدود الصفحة تُميَّز (معرّف غير صالح، سائق غير موجود،
 *   انحراف المتوسّط المخزَّن عن المحسوب)، وأن زرّ الحظر صار يحظر بعد أن كان لا يفعل.
 * الحالة: اختبار وحدة فعلي — البند 6.4 من التوجيه التنفيذي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على صفحة السائق أو على مسارها
 *
 * خلفية العطب الرابع: كان مسار `/admin/users/:id/blocked` يقرأ `blocked === "1"`
 * بينما نموذج صفحة السائقين يُرسل "true" — فزرّ «حظر» في اللوحة لم يكن يحظر أحداً
 * قطّ. واختبار التكامل القائم لم يمسكه لأنه يُرسل "1" مباشرة لا ما يُرسله الزرّ.
 */

import { describe, expect, it } from "bun:test";
import {
  type DriverDetailOrder,
  type DriverDetailProfile,
  type DriverDetailTicket,
  renderDriverDetailPage,
  renderDriversPage,
} from "../../apps/admin-dashboard/src/index.ts";
import type { AdminAuthPort } from "../../apps/gateway/src/admin/auth.ts";
import {
  ADMIN_SESSION_COOKIE,
  csrfTokenFor,
  sha256Hex,
} from "../../apps/gateway/src/admin/auth.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import { ok } from "../../packages/shared/result/index.ts";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const CSRF = "a".repeat(64);
const DRIVER_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";

function profile(overrides: Partial<DriverDetailProfile> = {}): DriverDetailProfile {
  return {
    driverId: DRIVER_ID,
    userId: USER_ID,
    fullName: "سائق تجريبي",
    telegramId: "9100",
    telegramUsername: "driver_test",
    phone: "+966500000000",
    languageCode: "ar",
    cityCode: "JED",
    cityNameAr: "جدة",
    verificationStatus: "verified",
    isBlocked: false,
    isAvailable: true,
    availabilityChangedAt: "2026-08-11T09:00:00.000Z",
    nationalId: "1234567890",
    vehicleType: "سيدان",
    plateNumber: "ا ب ج 1234",
    vehiclePhotoFileId: "AgACAgQAAx0",
    preferredAreaLabel: "حي الصفا",
    preferredArea: { lat: 21.5433, lng: 39.1728 },
    lastLocation: { lat: 21.4858, lng: 39.1925 },
    lastLocationAt: "2026-08-11T11:30:00.000Z",
    storedRatingAverage: 4.5,
    storedRatingCount: 10,
    liveRatingAverage: 4.5,
    liveRatingCount: 10,
    flaggedRatingCount: 0,
    services: ["transport"],
    subscription: {
      plan: "transport",
      status: "trialing",
      trialEndsAt: "2026-09-10T00:00:00.000Z",
      currentPeriodEnd: null,
      priceAmount: null,
      currency: null,
    },
    completedOrders: 3,
    cancelledOrders: 1,
    registeredAt: "2026-07-01T08:00:00.000Z",
    ...overrides,
  };
}

const ORDER: DriverDetailOrder = {
  orderId: "66666666-6666-6666-6666-666666666666",
  service: "transport",
  pickupLabel: "شارع التحلية",
  dropoffLabel: "مطار الملك عبدالعزيز",
  matchedAt: "2026-08-10T10:00:00.000Z",
  startedAt: "2026-08-10T10:05:00.000Z",
  completedAt: "2026-08-10T10:40:00.000Z",
  createdAt: "2026-08-10T09:58:00.000Z",
  riderName: "راكب تجريبي",
  riderStars: 5,
};

const TICKET: DriverDetailTicket = {
  ticketId: "77777777-7777-7777-7777-777777777777",
  type: "ride_dispute",
  status: "open",
  message: "السائق تأخّر ساعة",
  orderId: ORDER.orderId,
  createdAt: "2026-08-10T11:00:00.000Z",
  resolvedAt: null,
  resolution: null,
  claimedByName: null,
  linkKind: "about_driver_order",
  counterpartName: "راكب تجريبي",
};

function render(
  overrides: {
    profile?: Partial<DriverDetailProfile>;
    orders?: readonly DriverDetailOrder[];
    tickets?: readonly DriverDetailTicket[];
  } = {},
): string {
  return renderDriverDetailPage({
    now: NOW,
    profile: profile(overrides.profile ?? {}),
    orders: overrides.orders ?? [ORDER],
    tickets: overrides.tickets ?? [TICKET],
    ticketsLimit: 20,
    csrfToken: CSRF,
  });
}

describe("صفحة تفاصيل السائق — ما تعرضه", () => {
  it("تعرض بيانات التسجيل كاملة لا عمودين منها", () => {
    const html = render();

    // ما لم يكن في القائمة العريضة أصلاً: الهوية واللوحة ونوع المركبة والصورة
    expect(html).toContain("1234567890");
    expect(html).toContain("ا ب ج 1234");
    expect(html).toContain("سيدان");
    expect(html).toContain("AgACAgQAAx0");
    expect(html).toContain("driver_test");
    expect(html).toContain("+966500000000");
    expect(html).toContain("جدة");
    expect(html).toContain("العربية");
    // والمعرّفان: بلا أحدهما لا تُراجَع صفوف القاعدة عند شكوى
    expect(html).toContain(DRIVER_ID);
    expect(html).toContain(USER_ID);
  });

  it("المنطقة المفضّلة وآخر موقع: رابط خريطة لا رقمان يُنسخان بالمؤشّر", () => {
    const html = render();

    expect(html).toContain("حي الصفا");
    expect(html).toContain("https://maps.google.com/?q=21.543300,39.172800");
    expect(html).toContain("https://maps.google.com/?q=21.485800,39.192500");
  });

  it("الحقول الناقصة تُعلَّم «ناقص» لا تُترك شرطة تُقرأ كأنها قرار", () => {
    const html = render({
      profile: {
        nationalId: null,
        vehicleType: null,
        plateNumber: null,
        vehiclePhotoFileId: null,
        services: [],
      },
    });

    expect(html).toContain("ناقص");
    expect(html).toContain("ناقصة");
    expect(html).toContain("لا خدمة");
  });

  it("غياب آخر موقع يُقال صراحةً بأثره: لا يظهر في المطابقة بالقُرب", () => {
    const html = render({ profile: { lastLocation: null, lastLocationAt: null } });

    expect(html).toContain("لا يظهر في المطابقة بالقُرب");
    expect(html).not.toContain("maps.google.com/?q=0.000000,0.000000");
  });

  it("غياب المنطقة المفضّلة يُقال بمعناه لا بفراغ", () => {
    const html = render({ profile: { preferredAreaLabel: null, preferredArea: null } });

    expect(html).toContain("يُرتَّب بالقرب اللحظي وحده");
  });

  it("الرحلات المكتملة تُعرض بتقييم الراكب لكل رحلة", () => {
    const html = render();

    expect(html).toContain("شارع التحلية");
    expect(html).toContain("مطار الملك عبدالعزيز");
    expect(html).toContain("راكب تجريبي");
    expect(html).toContain("★★★★★");
    expect(html).toContain("3 رحلة مكتملة");
  });

  it("رحلةٌ بلا تقييم تُميَّز عن رحلةٍ بتقييم صفر", () => {
    const html = render({ orders: [{ ...ORDER, riderStars: null }] });

    expect(html).toContain("لم يُقيَّم");
  });

  it("تذكرة فتحها راكب عن طلبٍ أُسنِد إلى السائق تظهر ومُميَّزة عن تذكرة فتحها هو", () => {
    const html = render();

    expect(html).toContain("السائق تأخّر ساعة");
    expect(html).toContain("عن طلبٍ أُسنِد إليه");
    expect(html).not.toContain("فتحها السائق");

    const own = render({
      tickets: [{ ...TICKET, linkKind: "filed_by_driver", type: "subscription" }],
    });
    expect(own).toContain("فتحها السائق");
    expect(own).toContain("اشتراك");
  });

  it("لا رحلة ولا تذكرة: نصٌّ يقول ذلك لا جدولٌ فارغ", () => {
    const html = render({ orders: [], tickets: [] });

    expect(html).toContain("لا رحلة مكتملة لهذا السائق.");
    expect(html).toContain("لا تذكرة مرتبطة بهذا السائق.");
  });

  it("يهرب من HTML في الاسم ورسالة التذكرة فلا يُحقن وسم", () => {
    const html = render({
      profile: { fullName: `<img src=x onerror="alert(1)">` },
      tickets: [{ ...TICKET, message: "<script>alert(2)</script>" }],
    });

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(2)");
    expect(html).toContain("&lt;img");
  });
});

describe("صفحة تفاصيل السائق — متوسّط التقييم", () => {
  it("تعرض المحسوب الآن والمخزَّن معاً، وتقول إنهما متطابقان", () => {
    const html = render();

    expect(html).toContain("متوسّط التقييم (محسوب الآن)");
    expect(html).toContain("المتوسّط المخزَّن");
    expect(html).toContain("المخزَّن يطابق المحسوب.");
  });

  it("انحراف المخزَّن عن المحسوب يُعلَن — وهو ما تُرتِّب به المطابقة", () => {
    const html = render({
      profile: {
        storedRatingAverage: 4.8,
        storedRatingCount: 10,
        liveRatingAverage: 3.2,
        liveRatingCount: 9,
        flaggedRatingCount: 1,
      },
    });

    expect(html).toContain("يخالف المحسوب الآن");
    expect(html).toContain("تقييمات مُعلَّمة كمُسيئة");
  });

  it("سائقٌ بلا تقييم بعد: لا انحراف يُعلَن ولا صفرٌ يُعرض كأنه تقييم", () => {
    const html = render({
      profile: {
        storedRatingAverage: null,
        storedRatingCount: 0,
        liveRatingAverage: null,
        liveRatingCount: 0,
      },
    });

    expect(html).toContain("لا تقييم بعد.");
    expect(html).not.toContain("يخالف المحسوب الآن");
  });
});

describe("الوصول إلى الصفحة", () => {
  it("اسم السائق في القائمة رابطٌ إلى صفحته — وإلا لم يصلها أحد", () => {
    const html = renderDriversPage({
      cities: [{ id: "11111111-1111-1111-1111-111111111111", code: "JED", nameAr: "جدة" }],
      filters: { cityId: null, verification: null, query: null },
      csrfToken: CSRF,
      total: 1,
      limit: 200,
      rows: [
        {
          driverId: DRIVER_ID,
          userId: USER_ID,
          fullName: "سائق تجريبي",
          telegramId: "9100",
          phone: null,
          cityCode: "JED",
          verificationStatus: "pending",
          isBlocked: false,
          isAvailable: false,
          ratingAverage: null,
          ratingCount: 0,
          services: [],
          subscription: null,
          completedOrders: 0,
          registeredAt: NOW.toISOString(),
        },
      ],
    });

    expect(html).toContain(`href="/admin/drivers/${DRIVER_ID}"`);
  });

  it("الأفعال في صفحة التفاصيل تعود إليها لا إلى القائمة", () => {
    const html = render();

    expect(html).toContain(`name="back" value="/admin/drivers/${DRIVER_ID}"`);
    expect(html).toContain(`/admin/drivers/${DRIVER_ID}/verification`);
    expect(html).toContain(`/admin/users/${USER_ID}/blocked`);
  });
});

// ---------------------------------------------------------------------------
// المسار: حدوده، وزرّ الحظر الذي لم يكن يحظر
// ---------------------------------------------------------------------------

const SESSION_TOKEN = "session-token-for-detail-test";
const SESSION_HASH = sha256Hex(SESSION_TOKEN);

function authDouble(): AdminAuthPort {
  const unused = async (): Promise<never> => {
    throw new Error("لم يكن ينبغي نداؤه");
  };
  return {
    issueCode: unused,
    consumeCode: unused,
    openSession: unused,
    closeSession: async () => ok({ ok: true as const, value: 1 }),
    touchSession: async () =>
      ok({
        ok: true as const,
        value: {
          userId: "62798701-aaa5-494b-a7dd-04bab10c9101",
          cityId: "11111111-1111-1111-1111-111111111111",
          telegramId: "9001",
          fullName: "مسؤول",
        },
      }),
  } as unknown as AdminAuthPort;
}

interface Harness {
  readonly app: ReturnType<typeof createAdminUiRoutes>;
  readonly blockedCalls: boolean[];
}

/**
 * `sql` هنا دالّة وسم حقيقية لا كائن مزيّف: مسار الحظر يُنادي دالّة القاعدة
 * الذرّية، والمطلوب إثباتُ **القيمة** التي تصل إليها لا أن النداء وقع.
 */
function harness(): Harness {
  const blockedCalls: boolean[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: readonly unknown[]) => {
    const query = strings.join("?");
    if (query.includes("admin_set_user_blocked")) {
      blockedCalls.push(values[2] === true);
      return Promise.resolve([{ result: { ok: true } }]);
    }
    return Promise.resolve([]);
  }) as never;

  const app = createAdminUiRoutes({
    sql,
    auth: authDouble(),
    codeSender: { send: async () => true },
  });
  return { app, blockedCalls };
}

async function postBlocked(app: Harness["app"], blocked: string): Promise<Response> {
  const body = new FormData();
  body.set("csrf", csrfTokenFor(SESSION_HASH));
  body.set("blocked", blocked);
  return app.request(`/users/${USER_ID}/blocked`, {
    method: "POST",
    body,
    headers: { cookie: `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}` },
  });
}

describe("مسار الحظر — العطب الذي كان يُسقط الفعل صامتاً", () => {
  it('القيمة التي يُرسلها زرّ اللوحة فعلاً ("1") تحظر', async () => {
    const { app, blockedCalls } = harness();

    const response = await postBlocked(app, "1");

    expect(response.status).toBe(303);
    expect(blockedCalls).toEqual([true]);
  });

  it('"true" تحظر أيضاً — فالنموذج القديم لا يسقط صامتاً بعد الإصلاح', async () => {
    const { app, blockedCalls } = harness();

    await postBlocked(app, "true");

    expect(blockedCalls).toEqual([true]);
  });

  it('"0" ترفع الحظر لا تحظر', async () => {
    const { app, blockedCalls } = harness();

    await postBlocked(app, "0");

    expect(blockedCalls).toEqual([false]);
  });

  it("قيمة لا تُفهم تُردّ بـ 422 ولا تمسّ القاعدة — لا تُحمَل على «لا تحظر»", async () => {
    const { app, blockedCalls } = harness();

    const response = await postBlocked(app, "yes-please");

    expect(response.status).toBe(422);
    expect(blockedCalls).toEqual([]);
  });
});

describe("مسار تفاصيل السائق — حدوده", () => {
  it("معرّف ليس UUID يُردّ بـ 422 قبل مسّ القاعدة لا بـ 500", async () => {
    const { app } = harness();

    const response = await app.request("/drivers/not-a-uuid", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}` },
    });

    expect(response.status).toBe(422);
  });

  it("سائق غير موجود يُردّ بـ 404 لا بصفحةٍ فارغة تُقرأ كسائق بلا بيانات", async () => {
    const { app } = harness();

    const response = await app.request(`/drivers/${DRIVER_ID}`, {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}` },
    });

    expect(response.status).toBe(404);
  });
});
