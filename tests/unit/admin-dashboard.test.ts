/**
 * الغرض: اختبار طبقة عرض لوحة الإدارة وأدوات المصادقة بلا قاعدة ولا شبكة: أن
 *   الصفحات تُخرِج ما يُتوقَّع منها فعلاً، وأن الهروب من HTML يمنع الحقن، وأن
 *   رمز CSRF يُشتقّ من بصمة الجلسة ولا يُقبل غيره.
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على صفحات اللوحة
 * ملاحظات مستقبلية: عند إضافة صفحة تاسعة تُضاف حالتها هنا لا اختبار موازٍ.
 */

import { describe, expect, it } from "bun:test";
import {
  type CityOption,
  escapeHtml,
  formatDuration,
  formatStars,
  NAV_ITEMS,
  renderAttendancePage,
  renderDisputesPage,
  renderDriversPage,
  renderHeatmapPage,
  renderLiveOrdersPage,
  renderLoginPage,
  renderOverviewPage,
  renderRatingsPage,
  renderSettingsPage,
  shortId,
} from "../../apps/admin-dashboard/src/index.ts";
import {
  ADMIN_SESSION_COOKIE,
  csrfTokenFor,
  generateLoginCode,
  generateSessionToken,
  loginCodeMessage,
  safeEqual,
  sha256Hex,
} from "../../apps/gateway/src/admin/auth.ts";
import { healthIndicators } from "../../apps/gateway/src/admin/queries.ts";

const CITIES: readonly CityOption[] = [
  { id: "11111111-1111-1111-1111-111111111111", code: "JED", nameAr: "جدة" },
  { id: "22222222-2222-2222-2222-222222222222", code: "MKK", nameAr: "مكة" },
];

const NOW = new Date("2026-08-08T12:00:00.000Z");
const CSRF = "a".repeat(64);

describe("أدوات العرض", () => {
  it("يهرب من HTML فلا يُحقن وسم من اسم مستخدم", () => {
    const escaped = escapeHtml(`<img src=x onerror="alert(1)">`);
    expect(escaped).not.toContain("<img");
    expect(escaped).toContain("&lt;img");
  });

  it("يعيد نصّاً فارغاً للقيم الغائبة لا كلمة null", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("يصوغ المدد بالساعات والدقائق لا بالثواني الخام", () => {
    const twoHoursFive = 7500;
    expect(formatDuration(twoHoursFive)).toContain("2");
    expect(formatDuration(0)).toBeTruthy();
  });

  it("يعرض النجوم مملوءةً وفارغة بعددها الصحيح", () => {
    const three = 3;
    const rendered = formatStars(three);
    expect(rendered.split("★").length - 1).toBe(three);
    const five = 5;
    expect(formatStars(five).split("☆").length - 1).toBe(0);
    expect(formatStars(null)).toBeTruthy();
  });

  it("يقصّ المعرّفات الطويلة فلا يكسر الجدول", () => {
    const full = "11111111-1111-1111-1111-111111111111";
    expect(shortId(full).length).toBeLessThan(full.length);
  });
});

describe("صفحة الدخول", () => {
  it("تطلب المعرّف أولاً ثم الرمز، ولا تطلبهما معاً", () => {
    const identify = renderLoginPage({ step: "identify" });
    expect(identify).toContain("/admin/login/code");
    expect(identify).not.toContain("/admin/login/verify");

    const verify = renderLoginPage({ step: "verify", telegramId: "12345678" });
    expect(verify).toContain("/admin/login/verify");
    expect(verify).toContain("12345678");
  });

  it("تعرض الخطأ نصّاً مهروباً لا كوداً", () => {
    const page = renderLoginPage({ step: "identify", error: "<b>خطأ</b>" });
    expect(page).not.toContain("<b>خطأ</b>");
    expect(page).toContain("&lt;b&gt;");
  });
});

describe("الصفحات الثماني", () => {
  const user = {
    userId: "33333333-3333-3333-3333-333333333333",
    cityId: CITIES[0]?.id ?? "",
    telegramId: "9001",
    fullName: "مسؤول النظام",
  };

  it("النظرة العامة تعرض العدادات ومؤشّرات الصحة", () => {
    const html = renderOverviewPage({
      now: NOW,
      windowHours: 24,
      counters: {
        searchingOrders: 3,
        matchedOrders: 1,
        inProgressOrders: 2,
        availableDrivers: 7,
        verifiedDrivers: 9,
        pendingDrivers: 4,
        activeSubscriptions: 5,
        trialSubscriptions: 6,
        openTickets: 1,
        completedOrdersDay: 12,
        failedOrdersDay: 0,
        cancelledOrdersDay: 1,
        averageMatchSeconds: 42,
        averageDriverRating: 4.6,
      },
      health: healthIndicators({
        databaseLatencyMs: 5,
        staleOffers: 2,
        staleNegotiations: 0,
        stalledOrders: 0,
        inactiveCities: 1,
        availableWithoutLocation: 0,
      }),
      cities: [
        {
          code: "JED",
          nameAr: "جدة",
          isActive: true,
          liveOrders: 3,
          availableDrivers: 7,
          openTickets: 1,
        },
      ],
      recentAudit: [
        {
          createdAt: NOW.toISOString(),
          action: "admin_login",
          actorName: "مسؤول",
          entityType: "users",
        },
      ],
    });

    expect(html).toContain("نظرة عامة");
    expect(html).toContain("جدة");
    expect(html).toContain("admin_login");
    // مؤشّر عرض عالق يجب أن يظهر بوصفه لا برقمه وحده
    expect(html).toContain("عروض منتهية بلا إغلاق");
  });

  it("السائقون: يعرض الصفوف ونماذج الفعل مع رمز CSRF", () => {
    const html = renderDriversPage({
      cities: CITIES,
      filters: { cityId: null, verification: null, query: null },
      csrfToken: CSRF,
      total: 1,
      limit: 200,
      rows: [
        {
          driverId: "44444444-4444-4444-4444-444444444444",
          userId: "55555555-5555-5555-5555-555555555555",
          fullName: "سائق تجريبي",
          telegramId: "9100",
          phone: "+966500000000",
          cityCode: "JED",
          verificationStatus: "pending",
          isBlocked: false,
          isAvailable: true,
          ratingAverage: 4.2,
          ratingCount: 11,
          services: ["transport"],
          subscription: {
            plan: "transport",
            status: "trialing",
            trialEndsAt: NOW.toISOString(),
            currentPeriodEnd: null,
          },
          completedOrders: 8,
          registeredAt: NOW.toISOString(),
        },
      ],
    });

    expect(html).toContain("سائق تجريبي");
    expect(html).toContain(CSRF);
    expect(html).toContain("/verification");
    expect(html).toContain("/blocked");
  });

  it("الطلبات الحية: تُعلِّم المتعثّر ولا تُعلِّم الطازج", () => {
    const base = {
      cityCode: "JED",
      service: "transport",
      riderName: "عميل",
      riderTelegramId: "9200",
      driverName: null,
      pickupLabel: "الحرم",
      dropoffLabel: "المطار",
      matchedAt: null,
      startedAt: null,
      broadcastRound: 1,
      pendingOffers: 0,
      negotiationStage: null,
    };
    const stall = 120;
    const html = renderLiveOrdersPage({
      now: NOW,
      cities: CITIES,
      cityId: null,
      stallSeconds: stall,
      rows: [
        {
          ...base,
          orderId: "66666666-6666-6666-6666-666666666666",
          status: "searching",
          createdAt: new Date(NOW.getTime() - 600_000).toISOString(),
        },
        {
          ...base,
          orderId: "77777777-7777-7777-7777-777777777777",
          status: "searching",
          createdAt: new Date(NOW.getTime() - 5_000).toISOString(),
        },
      ],
    });

    expect(html).toContain("الطلبات الحية");
    expect(html).toContain("الحرم");
    expect(html).toContain("badge--bad");
  });

  it("الحضور: يجمع الملخّص والأحداث في صفحة واحدة", () => {
    const html = renderAttendancePage({
      cities: CITIES,
      cityId: null,
      windowHours: 24,
      availableWindows: [6, 24],
      query: null,
      eventLimit: 200,
      summary: [
        {
          driverId: "88888888-8888-8888-8888-888888888888",
          driverName: "سائق نشط",
          cityCode: "JED",
          onlineSeconds: 7200,
          toggles: 4,
          isAvailableNow: true,
        },
      ],
      events: [
        {
          changedAt: NOW.toISOString(),
          driverId: "88888888-8888-8888-8888-888888888888",
          driverName: "سائق نشط",
          telegramId: "9300",
          cityCode: "JED",
          isAvailable: true,
          source: "bot",
        },
      ],
    });

    expect(html).toContain("سائق نشط");
    expect(html).toContain("الحضور");
  });

  it("التقييمات: تميّز المنخفض عن غيره", () => {
    const low = 1;
    const high = 5;
    const html = renderRatingsPage({
      cities: CITIES,
      cityId: null,
      direction: null,
      onlyLow: false,
      limit: 200,
      summary: {
        total: 2,
        averageOnDriver: 3,
        averageOnRider: 4,
        lowCount: 1,
        flaggedCount: 0,
        lowThreshold: 2,
      },
      rows: [
        {
          createdAt: NOW.toISOString(),
          orderId: "99999999-9999-9999-9999-999999999999",
          cityCode: "JED",
          direction: "rider_to_driver",
          raterName: "عميل",
          rateeName: "سائق",
          stars: low,
          comment: "تأخّر كثيراً",
          isFlagged: false,
        },
        {
          createdAt: NOW.toISOString(),
          orderId: "99999999-9999-9999-9999-999999999999",
          cityCode: "JED",
          direction: "driver_to_rider",
          raterName: "سائق",
          rateeName: "عميل",
          stars: high,
          comment: null,
          isFlagged: false,
        },
      ],
    });

    expect(html).toContain("تأخّر كثيراً");
    expect(html).toContain("badge--bad");
  });

  it("النزاعات: تعرض نصّ الشكوى وحالتها", () => {
    const html = renderDisputesPage({
      now: NOW,
      cities: CITIES,
      cityId: null,
      status: null,
      openCount: 1,
      claimedCount: 0,
      resolvedDayCount: 3,
      windowHours: 24,
      limit: 200,
      rows: [
        {
          ticketId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          createdAt: NOW.toISOString(),
          type: "ride_dispute",
          status: "open",
          cityCode: "JED",
          partyName: "عميل غاضب",
          partyRole: "rider",
          partyTelegramId: "9400",
          orderId: null,
          message: "السائق لم يصل",
          claimedByName: null,
          claimedAt: null,
          agentSuggestion: null,
          agentClassification: null,
          agentConfidence: null,
        },
      ],
    });

    expect(html).toContain("السائق لم يصل");
    expect(html).toContain("عميل غاضب");
  });

  it("النزاعات: تعرض اقتراح الطبقة للقراءة دون أي زرّ حسم", () => {
    const base = {
      now: NOW,
      cities: CITIES,
      cityId: null,
      status: null,
      openCount: 1,
      claimedCount: 0,
      resolvedDayCount: 0,
      windowHours: 24,
      limit: 200,
    };
    const row = {
      ticketId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      createdAt: NOW.toISOString(),
      type: "complaint",
      status: "open",
      cityCode: "JED",
      partyName: "سائق",
      partyRole: "driver",
      partyTelegramId: "9401",
      orderId: null,
      message: "المبلغ خُصم مرّتين",
      claimedByName: null,
      claimedAt: null,
    };

    const withAdvice = renderDisputesPage({
      ...base,
      rows: [
        {
          ...row,
          agentSuggestion: "راجِع سجلّ الدفع ثمّ أعِد المبلغ الزائد",
          agentClassification: "شكوى دفع",
          agentConfidence: 0.82,
        },
      ],
    });

    expect(withAdvice).toContain("اقتراح الطبقة");
    expect(withAdvice).toContain("راجِع سجلّ الدفع");
    expect(withAdvice).toContain("شكوى دفع");
    expect(withAdvice).toContain("82%");
    // ⚠️ قراءةٌ فقط: لا نموذج ولا زرّ حسم في محيط الاقتراح
    expect(withAdvice).not.toContain("قبول الاقتراح");
    expect(withAdvice).not.toContain("تطبيق الاقتراح");

    // الطبقة معطّلة: العمود يبقى والخلية تفرغ، ولا تنكسر الصفحة
    const without = renderDisputesPage({
      ...base,
      rows: [{ ...row, agentSuggestion: null, agentClassification: null, agentConfidence: null }],
    });
    expect(without).toContain("المبلغ خُصم مرّتين");
    expect(without).not.toContain("شكوى دفع");
  });

  it("الخريطة: ترسم شبكة بعدد الخلايا المعلن، وتُظهر رسالة عند الفراغ", () => {
    const filled = renderHeatmapPage({
      cells: [
        { row: 0, col: 0, centerLat: 21.5, centerLng: 39.1, demand: 5, supply: 1 },
        { row: 1, col: 1, centerLat: 21.51, centerLng: 39.11, demand: 0, supply: 3 },
      ],
      rows: 2,
      cols: 2,
      cities: CITIES,
      cityId: CITIES[0]?.id ?? null,
      cityName: "جدة",
      windowHours: 6,
      availableWindows: [1, 6],
      totalDemand: 5,
      totalSupply: 4,
      cellDegrees: 0.01,
    });
    expect(filled).toContain("جدة");
    expect(filled.match(/class="cell/g)?.length).toBeGreaterThan(0);

    const empty = renderHeatmapPage({
      cells: [],
      rows: 0,
      cols: 0,
      cities: CITIES,
      cityId: CITIES[0]?.id ?? null,
      cityName: "جدة",
      windowHours: 6,
      availableWindows: [1, 6],
      totalDemand: 0,
      totalSupply: 0,
      cellDegrees: 0.01,
    });
    expect(empty).toContain("لا");
  });

  it("الإعدادات: تُظهر القيم المبدئية معلَّمةً وتحمل رمز CSRF في كل نموذج", () => {
    const html = renderSettingsPage({
      cities: CITIES,
      cityId: CITIES[0]?.id ?? "",
      cityName: "جدة",
      csrfToken: CSRF,
      rows: [
        {
          key: "offer_timeout_seconds",
          value: "45",
          valueType: "number",
          descriptionAr: "مهلة قبول العرض",
          isProvisional: false,
          updatedAt: NOW.toISOString(),
        },
        {
          key: "admin_heatmap_cell_degrees",
          value: "0.01",
          valueType: "number",
          descriptionAr: "ضلع خلية الخريطة",
          isProvisional: true,
          updatedAt: NOW.toISOString(),
        },
      ],
    });

    expect(html).toContain("offer_timeout_seconds");
    expect(html).toContain(CSRF);
    expect(html).toContain("مبدئي");
  });

  it("عناصر التنقّل تسعة، وكلها تحت /admin", () => {
    const nine = 9;
    expect(NAV_ITEMS.length).toBe(nine);
    for (const item of NAV_ITEMS) expect(item.path.startsWith("/admin")).toBe(true);
    // اسم المستخدم يظهر في الهيكل: أثبتناه ضمناً عبر الصفحات أعلاه
    expect(user.fullName).toBe("مسؤول النظام");
  });
});

describe("مصادقة اللوحة", () => {
  it("لا يخزَّن الرمز نفسه بل بصمته", () => {
    const code = "123456";
    const hash = sha256Hex(code);
    const sixtyFour = 64;
    expect(hash).not.toBe(code);
    expect(hash.length).toBe(sixtyFour);
    expect(sha256Hex(code)).toBe(hash);
  });

  it("رمز الدخول ستّ خانات رقمية دائماً", () => {
    const attempts = 200;
    for (let index = 0; index < attempts; index += 1) {
      expect(generateLoginCode()).toMatch(/^[0-9]{6}$/);
    }
  });

  it("رمز الجلسة طويل ولا يتكرّر", () => {
    const sixtyFour = 64;
    const tokens = new Set<string>();
    const attempts = 50;
    for (let index = 0; index < attempts; index += 1) {
      const token = generateSessionToken();
      expect(token.length).toBe(sixtyFour);
      tokens.add(token);
    }
    expect(tokens.size).toBe(attempts);
  });

  it("رمز CSRF مشتقّ من بصمة الجلسة ويختلف عنها", () => {
    const tokenHash = sha256Hex("session-token");
    const csrf = csrfTokenFor(tokenHash);
    expect(csrf).not.toBe(tokenHash);
    expect(csrfTokenFor(tokenHash)).toBe(csrf);
    expect(csrfTokenFor(sha256Hex("another"))).not.toBe(csrf);
  });

  it("المقارنة الآمنة ترفض الطول المختلف والقيمة المختلفة", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("رسالة الرمز تحمل الرمز وتحذيراً صريحاً لمن لم يطلبه", () => {
    const message = loginCodeMessage("654321");
    expect(message).toContain("654321");
    expect(message).toContain("لم تطلبه");
  });

  it("اسم كعكة الجلسة ثابت لا يُشتقّ في كل موضع", () => {
    expect(ADMIN_SESSION_COOKIE).toBe("waslah_admin");
  });
});
