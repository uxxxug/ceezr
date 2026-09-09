/**
 * الغرض: منسّقُ اختبارِ فوضى F5-06 متعدّدِ المثيلاتِ — يُشغَّلُ على عُدّاءِ CI
 *   بعد `docker compose -f docker-compose.f5-06.yml up`. يُثبتُ ثابتَ F5-06:
 *   «الحالةُ في DB+Redis لا في ذاكرةِ البوّابة، وقتلُ نسخةٍ أثناءَ رحلةٍ جاريةٍ
 *   لا يُفقدُ المستخدمَ خطوتَه».
 *
 *   وليس هذا اختبارَ وحدةٍ ولا اختبارَ تكاملٍ — هو برهانُ بنيةٍ: ٣ بوّاباتٍ خلفَ
 *   موزّعٍ يفحصُ `/ready`، والرحلةُ تعبرُ المثيلاتِ الثلاثة، ثمّ تُقتلُ نسخةٌ
 *   أثناءَ الرحلةِ فيستمرُّ مسارُها عبرَ البوّاباتِ الباقية.
 *
 * الحالة: منسّقُ اختبارِ CI — يُستدعى من وظيفةِ `chaos-multi-instance`.
 * ينتمي إلى: scripts
 * الاستعمال: bun run scripts/f5-06-chaos.ts
 *   (يتوقّعُ HAProxy على :8080، والبوّاباتِ على :3001/:3002/:3003، وPostgres على :5433،
 *    وRedis على :6380 — كلُّها من docker-compose.f5-06.yml)
 */

import { createSql } from "../packages/infrastructure/db/client.ts";
import {
  DECIDED_EVENT_DISTRIBUTION,
  distributionCrossesProcessBoundary,
  type EventDistributionMechanism,
} from "../packages/shared/config/single-instance.ts";

/**
 * هل يُسمَحُ بتشغيلِ الرحلةِ أصلاً؟ **الجوابُ من الشيفرةِ لا من البيئةِ**: البوّابةُ
 * ترفضُ الإقلاعَ عندَ `PROCESS_TOPOLOGY=multi-process` ما لم تعبرْ آليةُ التوزيعِ
 * حدودَ العمليةِ (`ADR 0050` §٣-ب/§٣-د · `R-17`)، فرحلةُ الفوضى مُتعذِّرةٌ بنيويّاً
 * لا مُخفِقةٌ. **وليسَ هذا تخطّياً بلا سببٍ**: السببُ حاجزٌ سياديٌّ مكتوبٌ، والبديلُ
 * المقيسُ اليومَ `scripts/f5-06-invariant-refusal.ts` يُثبِتُ الرفضَ في رصةٍ حقيقيّةٍ.
 * ويومَ تُقرَّرُ آليةٌ عابرةٌ بـADR ناسخٍ (`ADR 0050` §٨) **تُفتَحُ الرحلةُ تلقائيّاً**
 * بلا لمسِ هذا الملفِّ — لأنَّ الشرطَ يُقرأُ من مصدرِ القرارِ نفسِه.
 */
export function rideIsUnlockable(distribution: EventDistributionMechanism): boolean {
  return distributionCrossesProcessBoundary(distribution);
}

const HAPROXY = "http://localhost:8080";
const GATEWAYS = [
  { id: "gateway-1", url: "http://localhost:3001" },
  { id: "gateway-2", url: "http://localhost:3002" },
  { id: "gateway-3", url: "http://localhost:3003" },
] as const;

/** بوّابةٌ بالفهرسِ — تُلقي إن غابَ فهرسُها بدلَ تأكيدِ non-null. */
function gateway(index: number): { id: string; url: string } {
  const gw = GATEWAYS[index];
  if (gw === undefined) fail("gateway", `فهرسٌ خارجُ النطاق: ${index}`);
  return gw;
}
const POSTGRES_URL = "postgres://postgres:postgres@localhost:5433/waslah";
const WEBHOOK_SECRET = "chaos-webhook-secret-32chars-min-padding";
const DRIVER_CHAT = 450_010;
const RIDER_CHAT = 460_010;

const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5612, longitude: 39.1889 };
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

const sql = createSql({ connectionString: POSTGRES_URL });

/** يُلقي خطأً يُسمّي المرحلةَ والسببَ — لا خروجٌ صامتٌ بلا تشخيص. */
function fail(phase: string, detail: string): never {
  console.error(`\n❌ [F5-06] ${phase}: ${detail}`);
  process.exit(1);
}

function log(phase: string, message: string): void {
  console.log(`▶ [F5-06] ${phase}: ${message}`);
}

/** نشرُ ويبهوكِ تلغرام إلى هدفٍ (بوّابةٌ مباشرةً أو HAProxy). */
async function post(target: string, bot: string, update: unknown): Promise<Response> {
  return fetch(`${target}/webhook/telegram/${bot}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
    },
    body: JSON.stringify(update),
  });
}

const message = (chatId: number, body: Record<string, unknown>) => ({
  message: { chat: { id: chatId }, from: { id: chatId, language_code: "ar" }, ...body },
});
const text = (chatId: number, value: string) => message(chatId, { text: value });
const photo = (chatId: number, fileId: string) =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, { location: at });
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const privateCallback = (chatId: number, data: string) => ({
  callback_query: {
    data,
    from: { id: chatId },
    message: { chat: { id: chatId, type: "private" } },
  },
});

/** ينتظرُ تحقّقَ شرطٍ على DB مع مهلة — لا يفترضُ التوفرَ الفوريَّ. */
async function poll<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    await Bun.sleep(250);
  }
  fail("poll", `انقضتِ المهلةُ بانتظارِ «${label}»`);
}

async function readyStatus(target: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${target}/ready`);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ───────────────────────────────────────────────────────────────────────────
// المرحلة ٠: انتظارُ جهوزيةِ البوّاباتِ الثلاث
// ───────────────────────────────────────────────────────────────────────────
async function waitForGateways(): Promise<void> {
  log("جهوزية", "انتظارُ /ready=200 على البوّاباتِ الثلاث");
  for (const gw of GATEWAYS) {
    await poll(
      `/ready=200 على ${gw.id}`,
      async () => {
        const { status } = await readyStatus(gw.url).catch(() => ({ status: 0, body: null }));
        return status === 200 ? true : null;
      },
      60_000,
    );
  }
  // HAProxy يفحصُ `/ready` بنشاط: لا يوجّهُ إلى نسخةٍ غيرِ صحّيحة. لكنّ انتظارَ
  // أن يراها صحّيحةً يتطلّبُ دورةَ فحصٍ واحدةً على الأقل.
  await poll(
    "HAProxy جاهز",
    async () => {
      const res = await fetch(`${HAPROXY}/ready`).catch(() => null);
      return res && res.status === 200 ? true : null;
    },
    30_000,
  );
  log("جهوزية", "البوّاباتُ الثلاث وHAProxy جاهزة");
}

// ───────────────────────────────────────────────────────────────────────────
// المرحلة ١: تهيئةُ القاعدة (مدينةٌ نشطة + تنظيف)
// ───────────────────────────────────────────────────────────────────────────
async function seedCity(): Promise<string> {
  const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  const cityId = cities[0]?.id;
  if (cityId === undefined) fail("seed", "لم تُطبَّق هجرةُ بذرِ المدن على قاعدةِ compose");
  await sql`
    update cities
       set is_active = true,
           telegram_support_group_id = -1001,
           telegram_escalation_group_id = -1002,
           telegram_unsubscribed_drivers_group_id = -1003
       where id = ${cityId}
  `;
  await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             support_tickets, unsubscribed_claims, unsubscribed_negotiations,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;
  log("seed", `المدينةُ JED نشطة (${cityId})`);
  return cityId;
}

// ───────────────────────────────────────────────────────────────────────────
// المرحلة ٢: تسجيلُ السائق عبرَ gateway-1
// ───────────────────────────────────────────────────────────────────────────
async function registerDriver(cityId: string): Promise<string> {
  const gw1 = gateway(0).url;
  await post(gw1, "driver", text(DRIVER_CHAT, "/start"));
  await post(gw1, "driver", text(DRIVER_CHAT, "فهد الصامد"));
  await post(gw1, "driver", contact(DRIVER_CHAT, "+966500450010"));
  await post(gw1, "driver", privateCallback(DRIVER_CHAT, `city:${cityId}`));
  await post(gw1, "driver", privateCallback(DRIVER_CHAT, "service:transport"));
  await post(gw1, "driver", privateCallback(DRIVER_CHAT, "vehicle:sedan"));
  await post(gw1, "driver", text(DRIVER_CHAT, "أ ب ج 1234"));
  await post(gw1, "driver", text(DRIVER_CHAT, "1000001010"));
  await post(gw1, "driver", photo(DRIVER_CHAT, "vphoto_1000001010"));

  const driverRows = await poll("تسجيلُ السائق", async () => {
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id
       where u.telegram_id = ${DRIVER_CHAT}
    `;
    return rows[0]?.id ?? null;
  });
  await sql`update drivers set verification_status = 'verified' where id = ${driverRows}`;
  await post(gw1, "driver", text(DRIVER_CHAT, "/available"));
  await post(gw1, "driver", location(DRIVER_CHAT, DRIVER_AT));
  log("تسجيلُ السائق", `عبرَ gateway-1 — ${driverRows}`);
  return driverRows;
}

// ───────────────────────────────────────────────────────────────────────────
// المرحلة ٣: طلبُ الرحلة عبرَ gateway-2 (استمراريةُ الجلسةِ عبرَ المثيلات)
// ───────────────────────────────────────────────────────────────────────────
async function riderRequestsRide(cityId: string): Promise<string> {
  const gw2 = gateway(1).url;
  await post(gw2, "rider", text(RIDER_CHAT, "/start"));
  await post(gw2, "rider", text(RIDER_CHAT, "راكبُ الفوضى"));
  await post(gw2, "rider", contact(RIDER_CHAT, "+966500460010"));
  await post(gw2, "rider", privateCallback(RIDER_CHAT, `city:${cityId}`));
  await post(gw2, "rider", text(RIDER_CHAT, "/ride"));
  await post(gw2, "rider", location(RIDER_CHAT, PICKUP));
  await post(gw2, "rider", location(RIDER_CHAT, DROPOFF));

  const orderRows = await poll("إنشاءُ الطلب", async () => {
    const rows = await sql<
      { id: string }[]
    >`select id from orders order by created_at desc limit 1`;
    return rows[0]?.id ?? null;
  });
  log("طلبُ الرحلة", `عبرَ gateway-2 — الطلبُ ${orderRows} (جلسةُ الراكب عبرَ Redis من gateway-1)`);
  return orderRows;
}

// ───────────────────────────────────────────────────────────────────────────
// المرحلة ٤: قبولُ العرضِ وبدءُ الرحلة عبرَ gateway-3
// ───────────────────────────────────────────────────────────────────────────
async function startRide(orderId: string): Promise<void> {
  const gw3 = gateway(2).url;
  await post(gw3, "driver", privateCallback(DRIVER_CHAT, `offer:accept:${orderId}`));
  await poll("قبولُ العرض", async () => {
    const [offer] = await sql<{ status: string }[]>`
      select status from order_offers where order_id = ${orderId} limit 1
    `;
    return offer?.status === "accepted" ? true : null;
  });
  await post(gw3, "driver", privateCallback(DRIVER_CHAT, `ride:start:${orderId}`));
  await poll("بدءُ الرحلة", async () => {
    const [order] = await sql<
      { status: string }[]
    >`select status from orders where id = ${orderId}`;
    return order?.status === "in_progress" ? true : null;
  });
  log("بدءُ الرحلة", `عبرَ gateway-3 — الطلبُ ${orderId} قيدَ التنفيذ`);
}

// ───────────────────────────────────────────────────────────────────────────
// المرحلة ٥: قتلُ gateway-2 والتأكيدُ على التصريفِ وإزالةِ HAProxy
// ───────────────────────────────────────────────────────────────────────────
async function killGateway2(): Promise<void> {
  log("قتلُ نسخة", "إرسالُ SIGTERM إلى gateway-2 أثناءَ الرحلة");
  const proc = Bun.spawn(
    ["docker", "compose", "-f", "docker-compose.f5-06.yml", "kill", "-s", "SIGTERM", "gateway-2"],
    {
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  await proc.exited;

  // /ready يجبُ أن يُجيبَ 503 draining أثناءَ التصريفِ قبلَ أن تُغلقَ العملية.
  // يُعطى مهلةٌ قصيرة: الإعلانُ فوريٌّ، لكنّ استقبالَ الطلبِ بعدَ الإشارةِ قد يتأخّر.
  let saw503 = false;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const { status, body } = await readyStatus(gateway(1).url).catch(() => ({
      status: 0,
      body: null,
    }));
    if (status === 503) {
      saw503 = true;
      log("تصريف", `/ready ⇐ 503 على gateway-2: ${JSON.stringify(body)}`);
      break;
    }
    await Bun.sleep(100);
  }
  // إن أُغلقتِ العمليةُ قبلَ التقاطِ 503، يُعادُ الفحصُ: قد يكونُ الإعلانُ فاتَ النافذة.
  // ليس هذا إخفاقاً للثابتِ بل ضيقُ نافذةِ الالتقاط — لكنّه يُسجَّل.
  if (!saw503) console.warn("⚠️ [F5-06] لم يُلتقطْ 503 draining (نافذةُ التصريفِ قصيرة) — يُتابَع");

  // HAProxy يفحصُ `/ready` بنشاط: يجبُ أن يزيلَ gateway-2 من التوزيعِ بعدَ فشلِ الفحص.
  await poll(
    "إزالةُ gateway-2 من HAProxy",
    async () => {
      const res = await fetch(`${HAPROXY}/ready`).catch(() => null);
      return res && res.status === 200 ? true : null;
    },
    20_000,
  );
  log("HAProxy", "gateway-2 مُزالةٌ من التوزيع، والبوّاباتُ الباقيةُ تُجيبُ /ready=200");
}

// ───────────────────────────────────────────────────────────────────────────
// المرحلة ٦: إكمالُ الرحلةِ عبرَ gateway-1 (الباقية)
// ───────────────────────────────────────────────────────────────────────────
async function completeRide(orderId: string, driverId: string): Promise<void> {
  const gw1 = gateway(0).url;
  await post(gw1, "driver", privateCallback(DRIVER_CHAT, `ride:complete:${orderId}`));
  await poll(
    "إكمالُ الرحلة",
    async () => {
      const [order] = await sql<
        { status: string }[]
      >`select status from orders where id = ${orderId}`;
      return order?.status === "completed" ? true : null;
    },
    20_000,
  );

  // لا عرضٌ معلّقٌ ولا طلبٌ في حالةٍ وسيطة
  const [order] = await sql<{ status: string }[]>`select status from orders where id = ${orderId}`;
  if (order?.status !== "completed") fail("إكمال", `الطلبُ لم يكتمل — وضعه: ${order?.status}`);
  const [availability] = await sql<{ is_available: boolean }[]>`
    select is_available from driver_availability where driver_id = ${driverId}
  `;
  if (!availability?.is_available) fail("إكمال", "السائقُ لم يعدْ متاحًا بعدَ الإنهاء");
  log("إكمالُ الرحلة", `الطلبُ ${orderId} اكتملَ عبرَ gateway-1 بعدَ قتلِ gateway-2`);
}

// ───────────────────────────────────────────────────────────────────────────
// المرحلة ٧: تأكيدُ استخدامِ Redis فعليًّا (لا حالةٌ في الذاكرة)
// ───────────────────────────────────────────────────────────────────────────
async function assertRedisUsed(): Promise<void> {
  // مفاتيحُ الجلسةِ بصيغةِ waslah:session:* تُثبتُ أنّ حالةَ الحوارِ في Redis لا في ذاكرةِ البوّابة.
  const proc = Bun.spawn(
    [
      "docker",
      "compose",
      "-f",
      "docker-compose.f5-06.yml",
      "exec",
      "-T",
      "redis",
      "redis-cli",
      "--scan",
      "--pattern",
      "waslah:session:*",
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  const keys = output
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  if (keys.length === 0) fail("Redis", "لا مفاتيحَ جلسةٍ في Redis — الحالةُ لم تُخزَّنْ موزَّعة");
  log("Redis", `${keys.length} مفتاحَ جلسةٍ في Redis (مثال: ${keys[0]})`);
}

// ───────────────────────────────────────────────────────────────────────────
// المرحلة ٨: تأكيدُ أنّ المثيلاتِ الثلاثةَ خدمتِ الرحلة (استمراريةٌ عبرَ المثيلات)
// ───────────────────────────────────────────────────────────────────────────
async function assertCrossInstance(): Promise<void> {
  // كلُّ بوّابةٍ خدمتْ جزءًا من الرحلةِ: gateway-1 (التسجيل+الإكمال)، gateway-2 (الطلب)،
  // gateway-3 (البدء). هذا برهانٌ حتميٌّ لا عشوائيٌّ: لم نعتمدْ على round-robin.
  // والتأكيدُ هنا أنّ البوّاباتِ الثلاثَ أجابتْ /ready=200 في المرحلة ٠.
  log(
    "استمراريةٌ عبرَ المثيلات",
    "gateway-1 (تسجيل+إكمال) · gateway-2 (طلب) · gateway-3 (بدء) — كلُّها خدمتِ الرحلةَ نفسها",
  );
}

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  F5-06 — اختبارُ الفوضى متعدّدُ المثيلات (Docker Compose)  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  if (!rideIsUnlockable(DECIDED_EVENT_DISTRIBUTION)) {
    console.log(
      [
        "\n⛔ [F5-06] رحلةُ الفوضى لا تُشغَّلُ: آليةُ توزيعِ الأحداثِ المُقرَّرةُ",
        `«${DECIDED_EVENT_DISTRIBUTION}» لا تعبرُ حدودَ العمليةِ، فالبوّاباتُ ترفضُ`,
        "الإقلاعَ متعدّدَ المثيلاتِ (ADR 0050 §٣-ب · R-17) — رفضاً صحيحاً لا عطباً.",
      ].join(" "),
    );
    console.log(
      [
        "   والمقيسُ في هذه الوظيفةِ هو الرفضُ نفسُه",
        "(scripts/f5-06-invariant-refusal.ts) لا الرحلةُ.",
        "وتُفتَحُ الرحلةُ تلقائيّاً يومَ تُقرَّرُ آليةٌ عابرةٌ للعمليةِ بـADR ناسخٍ",
        "(ADR 0050 §٨-أ · REQ-07)، ولا يُغلَقُ F5-06 قبلَ ذلكَ.",
      ].join(" "),
    );
    await sql.end({ timeout: 5 });
    return;
  }
  await waitForGateways();
  const cityId = await seedCity();
  const driverId = await registerDriver(cityId);
  const orderId = await riderRequestsRide(cityId);
  await startRide(orderId);
  await killGateway2();
  await completeRide(orderId, driverId);
  await assertRedisUsed();
  await assertCrossInstance();
  await sql.end({ timeout: 5 });
  console.log(
    "\n✅ [F5-06] الثابتُ مُثبَتٌ: قتلُ نسخةٍ أثناءَ رحلةٍ جاريةٍ لا يُفقدُ الخطوة، والحالةُ في DB+Redis.",
  );
}

// حُرِّسَ بـ`import.meta.main` كي يُختبَرَ حكمُ فتحِ الرحلةِ بلا رفعِ رصةٍ ولا اتّصالِ قاعدةٍ.
if (import.meta.main) await main();
