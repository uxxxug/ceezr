/**
 * الغرض: سيناريو عمل — طلبُ رحلةٍ حقيقيٍّ بموقعٍ جغرافيّ، وبثُّه على السائقين المؤهّلين،
 *        بعملاءَ مستقلّين متزامنين.
 * الحالة: منفّذ فعلياً — وحدة 2-5.
 * ينتمي إلى: bench/scenarios/catalog
 * يُتوقع أن يستخدمه لاحقاً: مشغّلُ السيناريوهات، وقياسُ حملِ الإسناد لاحقاً.
 * ملاحظات مستقبلية: سيناريو التوصيل (delivery) يُبنى على نفس التهيئة بمدخلاتٍ أخرى.
 */

import { waitingVariants } from "../../../packages/application/bots/waiting-lines.ts";
import { translate } from "../../../packages/shared/i18n/index.ts";
import {
  type ActorRun,
  type CheckResult,
  check,
  expectEqual,
  type ScenarioContext,
  type ScenarioDefinition,
} from "../contract.ts";
import { locationUpdate, textUpdate } from "../updates.ts";
import {
  ADMIN_VERIFY_MOCK,
  arrangeAvailableDriver,
  JED_PICKUP,
  nudge,
  registerRider,
  SCENARIO_RIDER_BASE,
} from "./support.ts";

/** سائقو التهيئة: عددُهم مساوٍ لعددِ العملاء كي لا يكون شحُّ السائقين هو ما يُقاس. */
const ARRANGED_DRIVERS = 5;

/** بدائلُ سطرِ البحث كما يُرسلها النطاق فعلاً — تُقرأ من مصدرِها لا تُنسَخ. */
const SEARCHING_LINES: readonly string[] = waitingVariants("riderSearching", "ar");

const orderIdOf = (actor: ActorRun): string => String(actor.produced.orderId ?? "");
const chatIdOf = (actor: ActorRun): number => Number(actor.produced.telegramId);

const offersOfOrder = async (context: ScenarioContext, orderId: string): Promise<number> => {
  const [row] = await context.sql<{ n: string }[]>`
    select count(*)::text as n from public.order_offers where order_id = ${orderId}
  `;
  return Number(row?.n ?? "0");
};

export const rideDispatchScenario: ScenarioDefinition = {
  id: "ride-dispatch",
  title: "طلبُ رحلةٍ حقيقيٍّ وبثُّه على السائقين المؤهّلين",
  service: "transport",

  initialState: [
    "قاعدةُ قياسٍ معزولةٌ والجداولُ التشغيليةُ فارغة، ومدينةُ جدة مُفعَّلةٌ بقروباتها.",
    `${ARRANGED_DRIVERS} سائقين مسجَّلين بالمسار الحقيقيّ، موثَّقين إداريّاً، متاحين بمواقعَ حقيقيةٍ قربَ نقطةِ الانطلاق.`,
    "لا طلبَ ولا عرضَ في القاعدة قبل التشغيل.",
  ],
  userInputs: [
    "/start ثمّ الاسم ثمّ اختيارُ المدينة (تسجيلُ العميل)",
    "/ride",
    "موقعُ الانطلاق (زرّ الموقع)",
    "/skip بدلاً من موقعِ الوصول",
  ],
  steps: [
    "يُسجّل العميلُ نفسَه في بوت العملاء عبر الويبهوك الحقيقي.",
    "يطلب رحلةً ويُرسل موقعَه الحقيقيَّ ثمّ يتجاوز موقعَ الوصول.",
    "يُنشئ النظامُ الطلبَ بإحداثيةٍ جغرافيةٍ ويحسب المؤهّلين ويبثُّ عليهم.",
    "كلُّ العملاءِ يُطلَقون معاً، كلٌّ بموقعٍ مختلفٍ قليلاً.",
  ],
  expectedSystemResponse: [
    "سطرُ انتظارٍ من عائلةِ `waiting.rider_search_*` للعميل (أحدُ أربعةِ بدائلَ يُختار بالبذرة).",
    "ثمّ إمّا `rider.drivers_notified` بعددٍ **مطابقٍ** لعددِ العروضِ المكتوبةِ لطلبه،",
    "أو `rider.no_driver_found` إن لم يكن ثمّة مؤهّلٌ — ولا حالةَ ثالثةَ صامتة.",
    "ولكلِّ سائقٍ أُرسل إليه عرضٌ: رسالةٌ فيها زرُّ `offer:accept:<orderId>`.",
  ],
  expectedBusinessOutcome: [
    "لكلِّ عميلٍ طلبٌ واحدٌ في حالةِ البحث بإحداثيتِه التي أرسلها.",
    "كلُّ طلبٍ إمّا بُثَّ على سائقٍ واحدٍ على الأقلّ، وإمّا أُبلِغ صاحبُه بعدمِ وجودِ سائق.",
    "لا طلبَ مُسنَدٌ ولا عرضٌ مقبولٌ في هذه المرحلة — البثُّ ليس إسناداً.",
  ],

  concurrency: {
    count: 5,
    mode: "independent",
    rationale:
      "خمسةُ عملاءَ مستقلّين على خمسةِ سائقين: عددٌ صغيرٌ (§15) يكفي لكشفِ تداخلِ البثِّ بين " +
      "طلباتٍ متزامنةٍ تتنافس على نفس بِركةِ السائقين، ولا يُدّعى أنّه قياسُ سعة.",
  },
  mocks: [ADMIN_VERIFY_MOCK],
  proves: [
    "أنّ الطلبَ يُكتب بإحداثيةٍ جغرافيةٍ حقيقيةٍ مطابقةٍ لما أرسله العميل.",
    "أنّ البثَّ يُنتج عروضاً مكتوبةً بمسافةٍ محسوبةٍ فعلاً، ورسائلَ فيها زرُّ قبولٍ للطلبِ نفسِه.",
    "أنّ ما يُقال للعميلِ يطابق ما في القاعدة: عددُ من أُشعِر = عددُ العروض.",
    "أنّ الطلباتَ المتزامنةَ لا تُنتج طلباً صامتاً بلا بثٍّ وبلا إبلاغ.",
  ],
  doesNotProve: [
    "أنّ العرضَ وصل السائقَ عبر تلغرام فعلاً (الناقلُ مزدوج).",
    "سلوكَ الدوراتِ التالية للبثِّ ولا انتهاءَ مهلةِ العرض — ذاك يحتاج زمناً وعاملاً دوريّاً، وهو مُطفأٌ هنا.",
    "سعةَ الإسنادِ في الإنتاج: خمسةُ طلباتٍ ليست حملاً.",
  ],
  metrics: [
    "waslah_dispatch_requests_total",
    "waslah_dispatch_offers_sent_total",
    "waslah_dispatch_no_driver_total",
    "waslah_dispatch_offers_accepted_total",
  ],

  failureConditions: [
    {
      code: "SILENT_ORDER",
      description: "طلبٌ لم يُبَثَّ ولم يُبلَّغ صاحبُه بشيء — أسوأُ من رفضٍ صريح.",
      detect: async (context, actors) => {
        const silent: string[] = [];
        for (const actor of actors) {
          const orderId = orderIdOf(actor);
          if (orderId === "") continue;
          const offers = await offersOfOrder(context, orderId);
          if (offers > 0) continue;
          const texts = context.messagesTo(chatIdOf(actor)).map((message) => message.text);
          if (!texts.includes(translate("ar", "rider.no_driver_found"))) {
            silent.push(orderId);
          }
        }
        return silent.length === 0 ? null : `طلباتٌ صامتة: ${silent.join(", ")}`;
      },
    },
    {
      code: "PREMATURE_ASSIGNMENT",
      description: "طلبٌ صار مُسنَداً بلا قبولِ سائقٍ — إسنادٌ من حيث لا يُدرى.",
      detect: async (context) => {
        const [row] = await context.sql<{ n: string }[]>`
          select count(*)::text as n from public.orders where assigned_driver_id is not null
        `;
        const assigned = Number(row?.n ?? "0");
        return assigned === 0 ? null : `${assigned} طلباً مُسنَدٌ بلا قبول.`;
      },
    },
    {
      code: "OFFER_TO_INELIGIBLE_DRIVER",
      description: "عرضٌ أُرسل إلى سائقٍ غيرِ موثَّقٍ أو غيرِ متاحٍ أو بلا قدرةِ نقل.",
      detect: async (context) => {
        const [row] = await context.sql<{ n: string }[]>`
          select count(*)::text as n
            from public.order_offers o
            join public.drivers d on d.id = o.driver_id
           where d.verification_status <> 'verified'
              or not exists (
                select 1 from public.driver_availability a
                 where a.driver_id = d.id and a.is_available = true
              )
              or not exists (
                select 1 from public.driver_capabilities c
                 where c.driver_id = d.id and c.service = 'transport' and c.is_enabled = true
              )
        `;
        const bad = Number(row?.n ?? "0");
        return bad === 0 ? null : `${bad} عرضاً لسائقٍ غيرِ مؤهّل.`;
      },
    },
  ],

  arrange: async (context) => {
    const notes: string[] = [];
    for (let index = 0; index < ARRANGED_DRIVERS; index += 1) {
      const driver = await arrangeAvailableDriver(context, index, nudge(JED_PICKUP, index));
      notes.push(
        `سائقٌ متاحٌ ${driver.chatId} عند (${driver.at.latitude.toFixed(4)}, ${driver.at.longitude.toFixed(4)})`,
      );
    }
    return notes;
  },

  preconditions: async (context) => {
    const results: CheckResult[] = [];
    const [available] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.driver_availability a
        join public.drivers d on d.id = a.driver_id
       where a.is_available = true and d.verification_status = 'verified'
         and d.last_location is not null
    `;
    results.push(
      expectEqual(
        "precondition",
        "سائقون موثَّقون متاحون بمواقعَ مسجَّلة",
        Number(available?.n ?? "0"),
        ARRANGED_DRIVERS,
      ),
    );

    const [orders] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.orders
    `;
    results.push(expectEqual("precondition", "لا طلبات قبل التشغيل", Number(orders?.n ?? "0"), 0));

    const [offers] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.order_offers
    `;
    results.push(expectEqual("precondition", "لا عروض قبل التشغيل", Number(offers?.n ?? "0"), 0));
    return results;
  },

  runActor: async (context, actor) => {
    const chatId = SCENARIO_RIDER_BASE + actor.index;
    const at = nudge(JED_PICKUP, actor.index + ARRANGED_DRIVERS);
    const statuses: number[] = [];

    await registerRider(context, chatId, `عميل سيناريو ${actor.index + 1}`);

    const send = async (update: unknown): Promise<void> => {
      const response = await context.post("rider", update);
      statuses.push(response.status);
    };
    await send(textUpdate(chatId, "/ride"));
    await send(locationUpdate(chatId, at));
    await send(textUpdate(chatId, "/skip"));

    const [order] = await context.sql<{ id: string }[]>`
      select o.id from public.orders o
        join public.riders r on r.id = o.rider_id
        join public.users u on u.id = r.user_id
       where u.telegram_id = ${chatId}
    `;

    return {
      index: actor.index,
      telegramIds: [chatId],
      produced: {
        telegramId: chatId,
        orderId: order?.id ?? null,
        latitude: at.latitude,
        longitude: at.longitude,
      },
      httpStatuses: statuses,
    };
  },

  systemResponse: async (context, actors) => {
    const results: CheckResult[] = [];
    let searchingTold = 0;
    let matchedCount = 0;
    let noDriverTold = 0;

    for (const actor of actors) {
      const texts = context.messagesTo(chatIdOf(actor)).map((message) => message.text);
      /**
       * المقارنةُ بعائلةِ سطورِ الانتظار لا بمفتاحٍ واحد: النظامُ يختار أحدَ أربعةِ
       * بدائلَ بالبذرة (`waiting-lines.ts`)، فتوكيدٌ على نصٍّ بعينه كان سيفشل لأربعةِ
       * أخماسِ الطلبات — وهو فشلُ التوكيدِ لا فشلُ العمل. والقائمةُ تُقرأ من مصدرِها
       * لا تُنسَخ هنا، كي لا تبقى نسخةٌ خضراءُ على بديلٍ حُذف من الإنتاج.
       */
      if (texts.some((value) => SEARCHING_LINES.includes(value))) searchingTold += 1;

      const offers = await offersOfOrder(context, orderIdOf(actor));
      if (offers > 0) {
        /**
         * العددُ المُبلَّغُ يُقارَن بالقاعدة لا بثابتٍ في السيناريو: هذا هو الفرقُ بين
         * «أُرسلت رسالةٌ» و«قِيل للعميلِ الصحيحُ». ورسالةٌ تقول ٣ والقاعدةُ فيها عرضان
         * عطبُ عملٍ لا عطبُ صياغة.
         */
        if (texts.includes(translate("ar", "rider.drivers_notified", { count: offers }))) {
          matchedCount += 1;
        }
      } else if (texts.includes(translate("ar", "rider.no_driver_found"))) {
        noDriverTold += 1;
      }
    }

    results.push(
      expectEqual("system_response", "كلُّ عميلٍ أُبلِغ ببدءِ البحث", searchingTold, actors.length),
    );
    results.push(
      expectEqual(
        "system_response",
        "العددُ المُبلَّغُ للعميلِ يطابق عددَ العروضِ في القاعدة",
        matchedCount + noDriverTold,
        actors.length,
      ),
    );

    results.push(
      check(
        "system_response",
        "عدّادُ طلباتِ الإسناد تحرّك بعددِ الطلبات",
        context.metricDelta("waslah_dispatch_requests_total") === actors.length,
        `الفرق=${context.metricDelta("waslah_dispatch_requests_total")} · المتوقّع=${actors.length}`,
      ),
    );

    const offerButtons = context
      .allMessages()
      .filter((message) => JSON.stringify(message.markup ?? "").includes("offer:accept:")).length;
    const [totalOffers] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.order_offers
    `;
    results.push(
      expectEqual(
        "system_response",
        "لكلِّ عرضٍ في القاعدة رسالةٌ للسائقِ فيها زرُّ قبولٍ للطلبِ نفسِه",
        offerButtons,
        Number(totalOffers?.n ?? "0"),
      ),
    );
    return results;
  },

  businessOutcome: async (context, actors) => {
    const results: CheckResult[] = [];

    const [searching] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.orders where status = 'searching'
    `;
    results.push(
      expectEqual(
        "business_outcome",
        "لكلِّ عميلٍ طلبٌ واحدٌ في حالةِ البحث",
        Number(searching?.n ?? "0"),
        actors.length,
      ),
    );

    let broadcast = 0;
    for (const actor of actors) {
      if ((await offersOfOrder(context, orderIdOf(actor))) > 0) broadcast += 1;
    }
    results.push(
      check(
        "business_outcome",
        "بُثَّ على الأقلِّ طلبٌ واحد — وإلّا لم يُختبَر الإسنادُ أصلاً",
        broadcast > 0,
        `طلباتٌ بُثَّت=${broadcast} من ${actors.length}`,
      ),
    );

    const [distances] = await context.sql<{ min_km: string | null; max_km: string | null }[]>`
      select min(distance_km)::text as min_km, max(distance_km)::text as max_km
        from public.order_offers
    `;
    results.push(
      check(
        "business_outcome",
        "المسافةُ في كلِّ عرضٍ محسوبةٌ فعلاً (> 0)",
        distances?.min_km !== null && Number(distances?.min_km) > 0,
        `أصغرُ مسافة=${distances?.min_km ?? "—"}km · أكبرُها=${distances?.max_km ?? "—"}km`,
      ),
    );
    return results;
  },

  databaseState: async (context, actors) => {
    const results: CheckResult[] = [];
    let coordinatesMatch = 0;
    let firstRound = 0;

    for (const actor of actors) {
      const [order] = await context.sql<
        { lat: string; lng: string; broadcast_round: number; city_id: string }[]
      >`
        select st_y(pickup::geometry)::text as lat, st_x(pickup::geometry)::text as lng,
               broadcast_round, city_id
          from public.orders where id = ${orderIdOf(actor)}
      `;
      if (order === undefined) continue;
      const sameLat = Math.abs(Number(order.lat) - Number(actor.produced.latitude)) < 1e-6;
      const sameLng = Math.abs(Number(order.lng) - Number(actor.produced.longitude)) < 1e-6;
      if (sameLat && sameLng && order.city_id === context.cityId) coordinatesMatch += 1;
      if (order.broadcast_round === 1) firstRound += 1;
    }

    results.push(
      expectEqual(
        "database_state",
        "إحداثيةُ كلِّ طلبٍ مطابقةٌ لما أرسله صاحبُه، ومدينتُه صحيحة",
        coordinatesMatch,
        actors.length,
      ),
    );
    results.push(
      expectEqual("database_state", "كلُّ طلبٍ في دورةِ البثِّ الأولى", firstRound, actors.length),
    );

    const [pending] = await context.sql<{ n: string; total: string }[]>`
      select count(*) filter (where status = 'pending')::text as n,
             count(*)::text as total
        from public.order_offers
    `;
    results.push(
      check(
        "database_state",
        "كلُّ العروضِ المكتوبةِ في حالةِ الانتظار",
        pending !== undefined && pending.n === pending.total,
        `منتظِرة=${pending?.n ?? "?"} من ${pending?.total ?? "?"}`,
      ),
    );
    return results;
  },

  transitions: async (context, actors) => {
    const results: CheckResult[] = [];
    const [statuses] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.orders where status <> 'searching'
    `;
    results.push(
      check(
        "transition",
        "الانتقالُ: (لا طلب) → searching، ولا انتقالَ إلى matched قبل القبول",
        Number(statuses?.n ?? "0") === 0,
        `طلباتٌ خارجَ searching=${statuses?.n ?? "?"} · الفاعلون=${actors.length}`,
      ),
    );

    const [audit] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.audit_log where action like 'order.claim%'
    `;
    results.push(
      expectEqual("transition", "لا أثرَ إسنادٍ في سجلِّ التدقيق", Number(audit?.n ?? "0"), 0),
    );
    return results;
  },

  invariants: async (context, actors) => {
    const results: CheckResult[] = [];

    const [duplicate] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from (
        select order_id, driver_id from public.order_offers
         group by order_id, driver_id having count(*) > 1
      ) as many
    `;
    results.push(
      expectEqual(
        "invariant",
        "لا عرضَ مكرّرٌ لنفسِ السائقِ على نفسِ الطلب",
        Number(duplicate?.n ?? "0"),
        0,
      ),
    );

    const [accepted] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.order_offers where status = 'accepted'
    `;
    results.push(
      expectEqual("invariant", "لا عرضَ مقبولٌ قبل أن يقبل أحد", Number(accepted?.n ?? "0"), 0),
    );

    const [orphan] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.order_offers o
       where not exists (select 1 from public.orders r where r.id = o.order_id)
    `;
    results.push(expectEqual("invariant", "لا عرضَ بلا طلبٍ يملكه", Number(orphan?.n ?? "0"), 0));

    const [cityMismatch] = await context.sql<{ n: string }[]>`
      select count(*)::text as n
        from public.order_offers o
        join public.orders r on r.id = o.order_id
        join public.drivers d on d.id = o.driver_id
       where d.city_id <> r.city_id
    `;
    results.push(
      expectEqual(
        "invariant",
        "لا عرضَ عبرَ المدن — سائقُ كلِّ عرضٍ في مدينةِ الطلب",
        Number(cityMismatch?.n ?? "0"),
        0,
      ),
    );

    results.push(
      check(
        "invariant",
        "كلُّ فاعلٍ أنتج طلباً (لا فاعلَ بلا نتيجة)",
        actors.every((actor) => orderIdOf(actor) !== ""),
        `فاعلون بلا طلب=${actors.filter((actor) => orderIdOf(actor) === "").length}`,
      ),
    );
    return results;
  },

  idempotency: {
    description:
      "إعادةُ إرسالِ موقعِ الانطلاقِ نفسِه بعد اكتمالِ الطلب — كإعادةِ محاولةٍ من تلغرام " +
      "أو ضغطِ العميلِ زرَّ الموقعِ مرّتين. لا يجوز أن تُنشئ طلباً ثانياً ولا بثّاً ثانياً.",
    replay: async (context, actors) => {
      for (const actor of actors) {
        await context.post(
          "rider",
          locationUpdate(chatIdOf(actor), {
            latitude: Number(actor.produced.latitude),
            longitude: Number(actor.produced.longitude),
          }),
        );
      }
    },
    expectation: async (context, actors) => {
      const results: CheckResult[] = [];
      const [orders] = await context.sql<{ n: string }[]>`
        select count(*)::text as n from public.orders
      `;
      results.push(
        expectEqual(
          "idempotency",
          "الإعادةُ لم تُنشئ طلباً ثانياً",
          Number(orders?.n ?? "0"),
          actors.length,
        ),
      );
      return results;
    },
  },
};
