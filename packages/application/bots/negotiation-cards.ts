/**
 * الغرض: `NEG-SELECT-01` — بطاقاتُ دورِ التفاوضِ عند الراكبِ في مكانٍ واحدٍ: بطاقةُ العرضِ
 *   (معلوماتُ السائقِ · اختيارُه · السائقُ التالي)، وبطاقةُ المعلوماتِ (اختيار · تجاهل)،
 *   وبطاقةُ المحادثةِ (تم الاتفاق · إعادةُ فتحِ الطلبِ لسائقٍ آخر). يبنيها المُخطِرُ حين
 *   يُفتَحُ الدورُ، ويُعيدُ بناءَها الحوارُ حين يضغطُ الراكبُ «تجاهل» — فلا تختلفُ النسختانِ.
 * الحالة: منفّذ فعلياً — 2026-10-03.
 * ينتمي إلى: application/bots
 * ملاحظات: بياناتُ الأزرارِ تحملُ موضعَ الدورِ لا معرّفَ المطالبةِ — حدُّ تيليجرام 64 بايتاً
 *   (`unsub:info:` + uuid + `:` + موضعٌ ≈ 50)، والموضعُ يكفي حارساً للبطاقةِ القديمةِ.
 */

import type { NegotiationDriverCard } from "../dispatch/rotate-negotiation-turn.ts";
import type { Keyboard } from "./types.ts";

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface NegotiationCard {
  readonly text: string;
  readonly keyboard: Keyboard;
}

/** بطاقةُ العرضِ: زرّانِ في الأعلى (المعلوماتُ · الاختيارُ) و«السائقُ التالي» تحتَهما. */
export function riderPresentationCard(
  tr: Translate,
  negotiationId: string,
  position: number,
  deadlineSeconds: number | null,
): NegotiationCard {
  const lines = [tr("negotiation.rider_presented", { position })];
  if (deadlineSeconds !== null) {
    lines.push(tr("negotiation.rider_presented_deadline", { seconds: deadlineSeconds }));
  }
  return {
    text: lines.join("\n"),
    keyboard: {
      kind: "inline",
      rows: [
        [
          {
            label: tr("negotiation.rider_info_button"),
            data: `unsub:info:${negotiationId}:${position}`,
          },
          {
            label: tr("negotiation.rider_select_button"),
            data: `unsub:sel:${negotiationId}:${position}`,
          },
        ],
        [
          {
            label: tr("negotiation.rider_next_button"),
            data: `unsub:next:${negotiationId}:${position}`,
          },
        ],
      ],
    },
  };
}

/** بطاقةُ معلوماتِ السائقِ: الاسمُ الأوّلُ، التقييمُ، السيارةُ، الرحلاتُ، سنةُ الانضمامِ. */
export function riderDriverInfoCard(tr: Translate, card: NegotiationDriverCard): NegotiationCard {
  const unknown = tr("negotiation.driver_info_unknown");
  const rating =
    card.ratingAverage === null
      ? tr("negotiation.driver_info_no_rating")
      : tr("negotiation.driver_info_rating", {
          average: card.ratingAverage.toFixed(1),
          count: card.ratingCount,
        });
  const vehicleParts = [
    card.vehicleType,
    card.vehicleYear === null ? null : String(card.vehicleYear),
  ].filter((part): part is string => part !== null && part.trim() !== "");
  const text = tr("negotiation.driver_info_card", {
    name: card.firstName ?? unknown,
    rating,
    vehicle: vehicleParts.length === 0 ? unknown : vehicleParts.join(" · "),
    trips: card.completedTrips,
    since: card.memberSinceYear === null ? unknown : String(card.memberSinceYear),
  });
  return {
    text,
    keyboard: {
      kind: "inline",
      rows: [
        [
          {
            label: tr("negotiation.rider_select_button"),
            data: `unsub:sel:${card.negotiationId}:${card.position}`,
          },
          {
            label: tr("negotiation.rider_ignore_button"),
            data: `unsub:ign:${card.negotiationId}:${card.position}`,
          },
        ],
      ],
    },
  };
}

/** بطاقةُ المحادثةِ بعدَ الاختيارِ: «جاري الاتفاق» وزرّا الحسمِ. */
export function riderChatCard(
  tr: Translate,
  negotiationId: string,
  position: number,
  deadlineSeconds: number,
): NegotiationCard {
  return {
    text: tr("negotiation.rider_chat_opened", { position, seconds: deadlineSeconds }),
    keyboard: {
      kind: "inline",
      rows: [
        [
          {
            label: tr("negotiation.rider_agree_button"),
            data: `unsub:agree:${negotiationId}`,
          },
        ],
        [
          {
            label: tr("negotiation.rider_reopen_button"),
            data: `unsub:reopen:${negotiationId}:${position}`,
          },
        ],
      ],
    },
  };
}

/** زرُّ «إنهاءِ الانتظارِ» تحتَ ردِّ السائقِ المنتظِرِ. */
export function driverLeaveKeyboard(tr: Translate, negotiationId: string): Keyboard {
  return {
    kind: "inline",
    rows: [
      [{ label: tr("negotiation.driver_leave_button"), data: `unsub:leave:${negotiationId}` }],
    ],
  };
}
