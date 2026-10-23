/**
 * الغرض: `SOAK-02` (إعادة 2026-10-23) — إثباتُ أنَّ تحويلَ استعلامِ دورةِ حياةِ العرضِ إلى
 *   الفهرسِ (`offer_id` بدلَ `order_id` غيرِ المفهرسِ) لم يغيّرْ حقولَ الحدثِ ولا عدّاداتِه:
 *   بنّاءُ الحدثِ نقّيٌّ ويُختبرُ هنا بالمدخلاتِ نفسِها التي كانت تُبنى قبلَ التحويلِ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit.
 */
import { describe, expect, test } from "bun:test";
import {
  buildOfferLifecycleEvent,
  outboxOfferIds,
  type OfferLifecycleOutboxRow,
  type OfferLifecycleRow,
} from "../../deploy/capacity-run/load/miniapp-load.ts";

const corr = { index: 42, orderId: "11111111-2222-3333-4444-555555555555" } as Parameters<
  typeof buildOfferLifecycleEvent
>[0];

const offers: OfferLifecycleRow[] = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    status: "expired",
    driver_id: "bbbbbbbb-0000-4000-8000-000000000001",
    round: 1,
    created_at: "2026-10-23T10:00:00Z",
    expires_at: "2026-10-23T10:00:30Z",
    responded_at: null,
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    status: "cancelled",
    driver_id: "bbbbbbbb-0000-4000-8000-000000000002",
    round: 2,
    created_at: "2026-10-23T10:01:00Z",
    expires_at: "2026-10-23T10:01:30Z",
    responded_at: "2026-10-23T10:01:10Z",
  },
];

const outbox: OfferLifecycleOutboxRow[] = [
  { status: "delivered", attempts: 1, delivered_at: "2026-10-23T10:00:01Z" },
  { status: "dead", attempts: 5, delivered_at: null },
];

describe("SOAK-02 rerun — بناءُ حدثِ دورةِ حياةِ العرض", () => {
  test("حقولُ الحدثِ وعدّاداتُه كما كانت قبلَ تحويلِ الاستعلامِ إلى الفهرسِ", () => {
    expect(buildOfferLifecycleEvent(corr, offers, outbox)).toEqual({
      index: 42,
      orderId: "11111111-2222-3333-4444-555555555555",
      offers: [
        {
          id: "aaaaaaaa",
          status: "expired",
          driver: "bbbbbbbb",
          round: 1,
          createdAt: "2026-10-23T10:00:00Z",
          expiresAt: "2026-10-23T10:00:30Z",
          respondedAt: null,
        },
        {
          id: "aaaaaaaa",
          status: "cancelled",
          driver: "bbbbbbbb",
          round: 2,
          createdAt: "2026-10-23T10:01:00Z",
          expiresAt: "2026-10-23T10:01:30Z",
          respondedAt: "2026-10-23T10:01:10Z",
        },
      ],
      outbox: [
        { status: "delivered", attempts: 1, deliveredAt: "2026-10-23T10:00:01Z" },
        { status: "dead", attempts: 5, deliveredAt: null },
      ],
    });
  });

  test("معرّفاتُ العروضِ لاستعلامِ الصادرِ — بترتيبِها، وفارغةٌ بلا عروضٍ (any(فارغ) لا يمسح)", () => {
    expect(outboxOfferIds(offers)).toEqual([
      "aaaaaaaa-0000-4000-8000-000000000001",
      "aaaaaaaa-0000-4000-8000-000000000002",
    ]);
    expect(outboxOfferIds([])).toEqual([]);
  });
});
