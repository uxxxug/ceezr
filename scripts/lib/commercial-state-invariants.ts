/**
 * الغرض: `F11-03` — حَكَمٌ نقيٌّ على **ثوابتِ الحالةِ التجاريّةِ** في لقطةٍ تُقرأ من
 *   PostgreSQL بعدَ أن يُقطَعَ Redis كلُّه وسطَ دورةِ رحلةٍ ثمَّ يعود.
 *
 *   ولماذا حَكَمٌ منفصلٌ لا توكيداتٌ مبعثرةٌ في الاختبارِ؟ لأنَّ «لا فسادَ» دعوى
 *   سلبيّةٌ: لا تُثبَتُ إلّا بقائمةٍ مسمّاةٍ من الثوابتِ يُحكَمُ بها، ولكلِّ ثابتٍ
 *   سالبةٌ مبذورةٌ (`ح-7`) تُثبِتُ أنَّه يسقطُ على لقطةٍ فاسدةٍ. فالقائمةُ ههنا هي
 *   تعريفُ «الفسادِ» المقيسِ، ومن أرادَ توسيعَه أضافَ قاعدةً لا توكيداً.
 *
 *   ومصدرُ الحقيقةِ واحدٌ: القاعدةُ. Redis في هذا النظامِ جلساتٌ وقنواتُ بثٍّ
 *   وحالةٌ ساخنةٌ ودلاءُ حدٍّ — لا يملكُ صفّاً تجاريّاً واحداً. فالمقيسُ أنَّ فقدانَه
 *   لا يُنتِجُ في القاعدةِ ما لا يُنتِجُه وجودُه.
 * الحالة: منفّذ فعلياً — `ADR 0193`.
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: `tests/real-redis/redis-loss-commercial-state-real.test.ts`،
 *   وأيُّ قياسِ فوضى لاحقٍ (`F11-01` · `F11-02`) يحكمُ على الحالةِ نفسِها.
 * ملاحظات مستقبلية: إن صارَ للرحلةِ أثرٌ ماليٌّ (عمولةٌ على الرحلةِ) فقاعدةُ
 *   `money.unmoved` تصيرُ «أثرٌ واحدٌ لكلِّ إقفالٍ» — تُشدَّدُ ولا تُحذَف.
 */

export const ORDER_STATUSES = [
  "searching",
  "matched",
  "in_progress",
  "completed",
  "cancelled",
  "failed",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const OFFER_STATUSES = ["pending", "accepted", "rejected", "expired", "cancelled"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** حالاتٌ يكونُ فيها السائقُ **مشغولاً** برحلةٍ — لا تجتمعُ اثنتانِ لسائقٍ واحدٍ. */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = ["matched", "in_progress"];

export interface OrderRow {
  readonly id: string;
  readonly riderId: string;
  readonly status: OrderStatus;
  readonly assignedDriverId: string | null;
}

export interface OfferRow {
  readonly orderId: string;
  readonly driverId: string;
  readonly status: OfferStatus;
}

/**
 * عددُ صفوفِ كلِّ جدولٍ ماليٍّ. يُقرأ قبلَ الدورةِ وبعدَها: الدورةُ لا تطلبُ حركةً
 * ماليّةً، فكلُّ فرقٍ أثرٌ لم يُطلَبْ.
 */
export type MoneyCounts = Readonly<Record<string, number>>;

export interface CommercialSnapshot {
  readonly orders: readonly OrderRow[];
  readonly offers: readonly OfferRow[];
  readonly moneyBefore: MoneyCounts;
  readonly moneyAfter: MoneyCounts;
  /**
   * أثرٌ ظاهرٌ للطرفِ الآخرِ يُعَدُّ بقالبِه: إخطارُ الراكبِ بالقبولِ وبالإقفالِ. وإعادةُ
   * التسليمِ التي تُكرِّرُه كذبٌ ثانٍ (`BUG-008`) وإن سلِمَت الصفوفُ.
   */
  readonly notices: Readonly<Record<string, number>>;
}

export interface CommercialExpectation {
  /** الراكبُ المقيسُ ومقدارُ ما طلبَه فعلاً من رحلاتٍ. */
  readonly riderId: string;
  readonly expectedOrders: number;
  /** الحالةُ التي يجبُ أن تبلغَها رحلتُه بعدَ العودةِ — ما طلبَه السائقُ آخرَ الأمرِ. */
  readonly expectedStatus: OrderStatus;
  /** كم أمراً قُطِعَ عندَ حدِّ العميلِ. صفرٌ يعني أنَّ الانقطاعَ لم يُحقَنْ قطُّ. */
  readonly cutCommands: number;
  /** عددُ ما يجبُ أن يصلَ من كلِّ أثرٍ ظاهرٍ — واحدٌ لكلِّ حدثٍ وقعَ. */
  readonly expectedNotices: Readonly<Record<string, number>>;
}

export interface Violation {
  readonly rule: string;
  readonly detail: string;
}

export interface Verdict {
  readonly ok: boolean;
  readonly violations: readonly Violation[];
}

export function judgeCommercialState(
  snapshot: CommercialSnapshot,
  expectation: CommercialExpectation,
): Verdict {
  const violations: Violation[] = [];
  const add = (rule: string, detail: string): void => {
    violations.push({ rule, detail });
  };

  // ── الانقطاعُ محقونٌ فعلاً: قياسٌ لم يُقطَعْ فيه أمرٌ لا يشهدُ على الفقدانِ.
  if (!(expectation.cutCommands > 0)) {
    add("redis.cut-injected", `أوامرُ مقطوعةٌ = ${expectation.cutCommands} — لم يُحقَنْ فقدانٌ`);
  }

  // ── طلبٌ واحدٌ لكلِّ ما طلبَه الراكبُ: لا مُكرَّرٌ من إعادةِ تسليمٍ ولا يتيمٌ من خطوةٍ
  //    لم تُحفَظْ.
  const riderOrders = snapshot.orders.filter((order) => order.riderId === expectation.riderId);
  if (riderOrders.length !== expectation.expectedOrders) {
    add("order.count", `طلباتُ الراكبِ ${riderOrders.length} والمطلوبُ ${expectation.expectedOrders}`);
  }

  for (const order of riderOrders) {
    if (order.status !== expectation.expectedStatus) {
      add("order.status", `${order.id}: ${order.status} والمطلوبُ ${expectation.expectedStatus}`);
    }
  }

  for (const order of snapshot.orders) {
    const offers = snapshot.offers.filter((offer) => offer.orderId === order.id);
    const accepted = offers.filter((offer) => offer.status === "accepted");

    // ── قبولٌ واحدٌ على الأكثرِ: السباقُ يحكمُه `claim_ride` في القاعدةِ لا ذاكرةُ Redis.
    if (accepted.length > 1) {
      add("offer.single-accepted", `${order.id}: ${accepted.length} عروضٍ مقبولةٍ`);
    }

    // ── المقبولُ هو المُسنَدُ، والمُسنَدُ هو المقبولُ.
    const acceptedDriver = accepted[0]?.driverId ?? null;
    if (accepted.length === 1 && acceptedDriver !== order.assignedDriverId) {
      add(
        "offer.accepted-is-assigned",
        `${order.id}: المقبولُ ${acceptedDriver} والمُسنَدُ ${order.assignedDriverId}`,
      );
    }
    const assignedStatuses: readonly OrderStatus[] = ["matched", "in_progress", "completed"];
    if (assignedStatuses.includes(order.status) && order.assignedDriverId === null) {
      add("order.assigned-driver", `${order.id}: ${order.status} بلا سائقٍ مُسنَدٍ`);
    }
    if (assignedStatuses.includes(order.status) && accepted.length === 0) {
      add("offer.accepted-is-assigned", `${order.id}: ${order.status} بلا عرضٍ مقبولٍ`);
    }

    // ── لا عرضَ معلَّقاً على طلبٍ خرجَ من البحثِ: سائقٌ ثانٍ يقبلُه فيُسنَدُ مرّتين.
    if (order.status !== "searching") {
      const pending = offers.filter((offer) => offer.status === "pending").length;
      if (pending > 0) {
        add("offer.no-pending-after-search", `${order.id}: ${order.status} و${pending} معلَّقٌ`);
      }
    }
  }

  // ── سائقٌ واحدٌ برحلةٍ نشطةٍ واحدةٍ على الأكثرِ.
  const activeByDriver = new Map<string, number>();
  for (const order of snapshot.orders) {
    if (order.assignedDriverId === null) continue;
    if (!ACTIVE_ORDER_STATUSES.includes(order.status)) continue;
    activeByDriver.set(
      order.assignedDriverId,
      (activeByDriver.get(order.assignedDriverId) ?? 0) + 1,
    );
  }
  for (const [driverId, count] of activeByDriver) {
    if (count > 1) add("driver.single-active", `${driverId}: ${count} رحلاتٍ نشطةٍ`);
  }

  // ── لا حركةَ ماليّةَ لم يُطلَبْ مثلُها: الدورةُ لا تمسُّ جدولاً ماليّاً.
  const tables = new Set([
    ...Object.keys(snapshot.moneyBefore),
    ...Object.keys(snapshot.moneyAfter),
  ]);
  if (tables.size === 0) add("money.unmoved", "لا جداولَ ماليّةً مقروءةً — القياسُ أعمى");
  for (const table of tables) {
    const before = snapshot.moneyBefore[table];
    const after = snapshot.moneyAfter[table];
    if (before === undefined || after === undefined) {
      add("money.unmoved", `${table}: غيرُ مقروءٍ في إحدى اللقطتين`);
    } else if (before !== after) {
      add("money.unmoved", `${table}: ${before} ← ${after}`);
    }
  }

  // ── أثرٌ ظاهرٌ واحدٌ لكلِّ حدثٍ: لا إخطارَ مُكرَّراً من إعادةِ تسليمٍ ولا مبتلَعاً.
  const noticeKinds = Object.keys(expectation.expectedNotices);
  if (noticeKinds.length === 0) add("notice.single-effect", "لا آثارَ ظاهرةً مطلوبةً — القياسُ أعمى");
  for (const kind of noticeKinds) {
    const seen = snapshot.notices[kind] ?? 0;
    const wanted = expectation.expectedNotices[kind] ?? 0;
    if (seen !== wanted) add("notice.single-effect", `${kind}: ${seen} والمطلوبُ ${wanted}`);
  }

  return { ok: violations.length === 0, violations };
}
