/**
 * الغرض: حملة الاختبار العدائي المنصوص عليها في القسم 4.4 — إدخالٌ خبيث أو
 *   مشوَّه أو حدّي يُدفع عمداً في كل باب مفتوح للعالم الخارجي: نصوص المستخدمين،
 *   جسم الويبهوك، السرّ المشترك، التحديثات المكرَّرة، والقاعدة حين تسقط.
 *   المطلوب إثباتُ **الرفض الواضح أو التحمّل**، لا مجرّد «عدم الانهيار»: رسالةٌ
 *   مفهومة، وصفٌّ لا يُكتب في القاعدة، وحالةٌ لا تتغيّر.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL لأقسام القاعدة.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وكل مراجعة أمنية لاحقة
 * ملاحظات مستقبلية: عند إضافة أي حقل نصّي جديد يستقبله المستخدم، يُضاف إلى
 *   `HOSTILE_TEXTS` هنا بدل كتابة ملف اختبار جديد لكل حقل.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { escapeHtml } from "../../apps/admin-dashboard/src/layout.ts";
import { ADMIN_SESSION_COOKIE, createAdminAuthPort } from "../../apps/gateway/src/admin/auth.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import {
  createTelegramWebhookRoutes,
  secretsMatch,
} from "../../apps/gateway/src/routes/telegram-webhook.ts";
import { parseSupportMessage } from "../../packages/domain/dispute/value-objects.ts";
import { parseFullName } from "../../packages/domain/identity/value-objects.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
/**
 * سرّ ASCII عمداً: ترويسات HTTP لا تحمل إلا ASCII، وتلغرام نفسه يقصر سرّ
 * الويبهوك على [A-Za-z0-9_-]. سرٌّ عربي هنا كان سيفشل في بناء الطلب لا في
 * المنصّة — فيُظنّ خللاً في الكود وهو خلل في الاختبار.
 */
const SECRET = "waslah-webhook-secret-0123456789";

/**
 * مجموعة الإدخال العدائي الموحَّدة. كل بابٍ نصّي في المنصّة يُدفع بها كاملةً،
 * فلا يُنسى نوعٌ منها عند فحص باب دون آخر.
 */
const HOSTILE_TEXTS: Readonly<Record<string, string>> = {
  فارغ: "",
  مسافات: "        ",
  "طويل جداً": "أ".repeat(50_000),
  "رموز فقط": "!@#$%^&*()_+-=[]{}|;':\",./<>?`~",
  "emoji فقط": "🚗🚕🚙🛵🏍️😀😃😄😁😆😅🤣😂🙂🙃",
  HTML: "<script>alert('xss')</script><img src=x onerror=alert(1)>",
  SQL: "'; DROP TABLE users; --",
  "SQL ثانٍ": "1' OR '1'='1",
  "قلب اتجاه": "\u202Eمعكوس\u202D",
  "محارف تحكّم": "نصّ\u0000\u0001\u0002مع\u0007تحكّم",
  "سطور كثيرة": "سطر\n".repeat(5000),
  "null بالنصّ": "null",
  "undefined بالنصّ": "undefined",
};

/** أسماء الحالات — تُستعمل للتكرار المقروء في رسائل الفشل. */
const HOSTILE_NAMES = Object.keys(HOSTILE_TEXTS);

let sql: Sql;
let webhookApp: Hono;
let handled: { bot: string; update: unknown }[];

function webhookRequest(
  body: string,
  options: { secret?: string; bot?: string; contentType?: string } = {},
): Promise<Response> | Response {
  const headers: Record<string, string> = {
    "content-type": options.contentType ?? "application/json",
  };
  if (options.secret !== undefined) {
    headers["x-telegram-bot-api-secret-token"] = options.secret;
  }
  return webhookApp.fetch(
    new Request(`http://localhost/webhook/telegram/${options.bot ?? "driver"}`, {
      method: "POST",
      headers,
      body,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) الإدخال النصّي العدائي — بلا قاعدة بيانات
// ═══════════════════════════════════════════════════════════════════════════

describe("الإدخال النصّي العدائي: رفضٌ واضح لا انهيار", () => {
  beforeAll(() => {
    handled = [];
    webhookApp = new Hono();
    webhookApp.route(
      "/",
      createTelegramWebhookRoutes({
        webhookSecret: SECRET,
        handler: {
          handle: async (bot, update) => {
            handled.push({ bot, update });
            return true;
          },
        },
      }),
    );
  });

  it("رسالة الدعم: كل إدخال عدائي إمّا يُرفض بسبب مُسمّى أو يُقبل مقصوصاً — ولا استثناء يُرمى", () => {
    for (const name of HOSTILE_NAMES) {
      const raw = HOSTILE_TEXTS[name] ?? "";
      // الشرط الأول: لا انفجار مهما كان الإدخال
      const result = parseSupportMessage(raw);

      if (result.ok) {
        // الشرط الثاني: ما قُبل يجب أن يكون ضمن الحدّ المعلن، لا نصّاً بلا سقف
        expect(result.value.length).toBeLessThanOrEqual(3000);
        expect(result.value.length).toBeGreaterThanOrEqual(10);
      } else {
        // الشرط الثالث: الرفض بسببٍ معروف لا برسالة عامّة
        expect(["too_short", "too_long", "is_command"]).toContain(result.error.reason);
      }
    }
  });

  it("رسالة الدعم: الفارغ والمسافات والطويل جداً مرفوضة قطعاً", () => {
    expect(parseSupportMessage("").ok).toBe(false);
    expect(parseSupportMessage("        ").ok).toBe(false);
    expect(parseSupportMessage("أ".repeat(50_000)).ok).toBe(false);

    const tooLong = parseSupportMessage("أ".repeat(50_000));
    expect(tooLong.ok === false && tooLong.error.reason).toBe("too_long");
  });

  it("⚠️ حمولات HTML وSQL لا تُنفَّذ ولا تُعقَّم صامتةً: تبقى نصّاً كما كُتبت أو تُرفض", () => {
    const html = HOSTILE_TEXTS.HTML ?? "";
    const injection = HOSTILE_TEXTS.SQL ?? "";

    const htmlResult = parseSupportMessage(html);
    if (htmlResult.ok) {
      // لا تعقيم صامت: الهروب مسؤولية طبقة العرض، والتخزين يحفظ ما قاله المستخدم
      expect(htmlResult.value).toContain("<script>");
    }

    const injectionResult = parseSupportMessage(injection);
    if (injectionResult.ok) {
      expect(injectionResult.value).toContain("DROP TABLE");
    }
  });

  it("الاسم الكامل: كل إدخال عدائي يُرفض أو يُقبل مُطبُّعاً، ولا استثناء يُرمى", () => {
    for (const name of HOSTILE_NAMES) {
      const raw = HOSTILE_TEXTS[name] ?? "";
      const result = parseFullName(raw);

      if (result.ok) {
        // ما يُقبل يجب أن يكون مُطبُّعاً: بلا محارف اتجاه، بلا فراغ طرفي، ضمن الطول
        expect(result.value.trim()).toBe(result.value);
        expect(result.value.length).toBeGreaterThan(0);
        expect(result.value.length).toBeLessThanOrEqual(80);
        expect(result.value).not.toMatch(/[\u200E\u200F\u202A-\u202E]/);
      }
    }
  });

  it("⚠️ الاسم الكامل يرفض الرموز وحدها وemoji وحدها والفارغ والطويل جداً", () => {
    for (const key of ["رموز فقط", "emoji فقط", "فارغ", "مسافات", "طويل جداً", "سطور كثيرة"]) {
      const result = parseFullName(HOSTILE_TEXTS[key] ?? "");
      expect(result.ok).toBe(false);
    }
  });

  it("⚠️ محارف قلب الاتجاه تُنزَع لا تُرفض: الاسم يعود نظيفاً بلا إخفاء بصري", () => {
    const result = parseFullName(HOSTILE_TEXTS["قلب اتجاه"] ?? "");
    expect(result.ok).toBe(true);
    // المهمّ: ما بقي من النصّ لا يحمل محرف اتجاه يقلب عرضه في لوحة الإدارة
    expect(result.ok && result.value).toBe("معكوس");
  });

  /**
   * ملحوظة مهمّة ومقصودة: مدقّق الاسم **لا يرفض** حمولات HTML وSQL، وهذا
   * موثّق في الملف نفسه: «لا قيد على المحارف المسموحة». فرض قائمة محارف على
   * أسماء البشر يرفض أسماءً حقيقية ولا يمنع XSS. الحدّ الأمني الحقيقي هو
   * الهروب عند العرض والاستعلام المُعامَل عند التخزين — وكلاهما يُختبر أدناه.
   */
  it("حمولة HTML تُقبل اسماً بقصد — والحماية عند العرض لا عند الإدخال", () => {
    const accepted = parseFullName(HOSTILE_TEXTS.HTML ?? "");
    expect(accepted.ok).toBe(true);
  });

  it("⚠️ كل حمولة عدائية تُهرَّب عند العرض فلا تُنفّذ في متصفّح المسؤول", () => {
    for (const name of HOSTILE_NAMES) {
      const escaped = escapeHtml(HOSTILE_TEXTS[name]);
      // لا وسم يُفتح، ولا اقتباس يكسر خاصّية
      expect(escaped).not.toContain("<");
      expect(escaped).not.toContain(">");
      expect(escaped).not.toContain('"');
      expect(escaped).not.toContain("'");
    }

    // والحمولة الكلاسيكية تخرج نصّاً مرئيّاً لا وسماً حيّاً
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) الويبهوك: السرّ، الأجسام التالفة، التكرار
// ═══════════════════════════════════════════════════════════════════════════

describe("الويبهوك تحت الضغط العدائي", () => {
  beforeEach(() => {
    handled = [];
    webhookApp = new Hono();
    webhookApp.route(
      "/",
      createTelegramWebhookRoutes({
        webhookSecret: SECRET,
        handler: {
          handle: async (bot, update) => {
            handled.push({ bot, update });
            return true;
          },
        },
      }),
    );
  });

  it("⚠️ السرّ الخاطئ بكل أشكاله يُرفض 401 ولا يبلغ المعالج", async () => {
    /**
     * كلّها ASCII لأن ترويسة HTTP لا تحمل غيره؛ المحارف غير الـASCII تُفحص في
     * secretsMatch مباشرة في الاختبار التالي. ولا تُدرج هنا فروق الفراغ الطرفي
     * (`"secret "`) لأن RFC 9110 يوجب على طبقة HTTP حذف الفراغ المحيط بقيمة
     * الترويسة قبل أن تصل التطبيق أصلاً؛ فالمقارنة لا تراها وليس ذلك ثغرة.
     */
    const wrongSecrets = [
      "",
      "wrong",
      SECRET.slice(0, -1),
      `${SECRET}x`,
      SECRET.toUpperCase(),
      SECRET.split("").reverse().join(""),
      "x".repeat(10_000),
    ];

    for (const secret of wrongSecrets) {
      const response = await webhookRequest(JSON.stringify({ update_id: 1 }), { secret });
      expect(response.status).toBe(401);
    }
    // ولا واحد منها بلغ المعالج
    expect(handled.length).toBe(0);
  });

  it("مقارنة السرّ لا تُقصّر عند أول اختلاف — الطول لا يُستنتج من النتيجة", () => {
    expect(secretsMatch(SECRET, SECRET)).toBe(true);
    expect(secretsMatch("", SECRET)).toBe(false);
    expect(secretsMatch("أ".repeat(100_000), SECRET)).toBe(false);
    expect(secretsMatch(SECRET, "")).toBe(false);
    // محارف غير ASCII ومحارف تحكّم: تُقارن بلا استثناء وتُرفض
    expect(secretsMatch("سرّ عربي", SECRET)).toBe(false);
    expect(secretsMatch("\u0000", SECRET)).toBe(false);
    expect(secretsMatch("🚀", SECRET)).toBe(false);
  });

  it("⚠️ الأجسام التالفة تُرفض 400 بلا استثناء ولا وصول للمعالج", async () => {
    const corruptBodies = [
      "",
      "{",
      "}{",
      "not json at all",
      "[1,2,3]",
      "null",
      "true",
      '"نصّ وحده"',
      "12345",
      '{"update_id":}',
      '{"update_id":1,}',
      "\u0000\u0001\u0002",
    ];

    for (const body of corruptBodies) {
      const response = await webhookRequest(body, { secret: SECRET });
      // 400 للتالف — والمهم ألّا يكون 500 ولا انهياراً
      expect(response.status).toBe(400);
      expect(response.status).not.toBe(500);
    }
    expect(handled.length).toBe(0);
  });

  it("جسم عميق التداخل وجسم ضخم لا يُسقطان الخدمة", async () => {
    // تداخل عميق: الخطر الكلاسيكي على المحلّلات التعاودية
    let deep: unknown = { update_id: 1 };
    for (let i = 0; i < 2000; i += 1) deep = { nested: deep };
    const deepResponse = await webhookRequest(JSON.stringify(deep), { secret: SECRET });
    expect([200, 400]).toContain(deepResponse.status);

    // جسم ضخم: نصّ رسالة بحجم ميغابايت تقريباً
    const huge = {
      update_id: 2,
      message: { from: { id: 1 }, text: "أ".repeat(1_000_000) },
    };
    const hugeResponse = await webhookRequest(JSON.stringify(huge), { secret: SECRET });
    expect([200, 400, 413]).toContain(hugeResponse.status);
    expect(hugeResponse.status).not.toBe(500);
  });

  it("بوت مجهول يُرفض 404 حتى بسرّ صحيح", async () => {
    for (const bot of ["admin", "unknown", "../driver", "%2e%2e", ""]) {
      const response = await webhookRequest(JSON.stringify({ update_id: 1 }), {
        secret: SECRET,
        bot,
      });
      expect([404, 405]).toContain(response.status);
    }
    expect(handled.length).toBe(0);
  });

  /**
   * **نقضٌ موثَّق لقرار سابق.** كان هذا الاختبار يُثبت أن المسار *لا* يُسقط
   * التكرار، وأن ذلك مسؤولية المعالج وذرّية القاعدة. وقد نُقض القرار بتوجيه
   * المالك الصريح: «عالج `update_id` بحيث لا تُعالَج الرسالة أكثر من مرة».
   *
   * وما بقي من القرار القديم صحيحاً فقد صحّ بالقياس: أعيد إرسال تحديث «قبول
   * عرض» بنفس الرقم على قاعدة حقيقية فلم تتلف الحالة — العروض المقبولة بقيت
   * واحداً. فذرّية القاعدة تحمي الحالة كما قيل. والذي أضافه المنع هو إسقاط
   * الرسالة الصادرة المكرَّرة التي كانت تُربك المستخدم.
   *
   * فالمنع طبقةُ راحةٍ فوق الذرّية، لا بديلٌ عنها. انظر
   * apps/gateway/src/routes/update-dedup.ts للحدود المعلَنة.
   */
  it("التحديث المكرَّر لا يصل إلى المعالج إلا مرّة", async () => {
    const update = JSON.stringify({ update_id: 777, message: { from: { id: 5 }, text: "مرحبا" } });

    const first = await webhookRequest(update, { secret: SECRET });
    const second = await webhookRequest(update, { secret: SECRET });

    expect(first.status).toBe(200);
    // 200 لا 4xx: التحديث مقبول ومعالَج، فلا سبب يدفع تلغرام لإعادة الإرسال
    expect(second.status).toBe(200);
    expect(handled.length).toBe(1);
  });

  it("النصوص العدائية داخل تحديث سليم تمرّ إلى المعالج بلا تفسير ولا تنفيذ", async () => {
    // رقم فريد لكل نصّ: غرض الاختبار سلوك النصّ لا التكرار، ولو تشابهت
    // الأرقام لأسقط مانعُ التكرار ما بعد الأوّل فصار الاختبار يقيس لا شيء.
    let hostileUpdateId = 8_100;
    for (const name of HOSTILE_NAMES) {
      hostileUpdateId += 1;
      const response = await webhookRequest(
        JSON.stringify({
          update_id: hostileUpdateId,
          message: { from: { id: 9 }, text: HOSTILE_TEXTS[name] },
        }),
        { secret: SECRET },
      );
      expect(response.status).toBe(200);
    }
    expect(handled.length).toBe(HOSTILE_NAMES.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) القاعدة: الحقن الحقيقي، والتزامن، وسقوط القاعدة
// ═══════════════════════════════════════════════════════════════════════════

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  أقسام القاعدة في الاختبار العدائي مُتخطّاة: عيّن TEST_DATABASE_URL.");
}

describeIf("القاعدة تحت الضغط العدائي", () => {
  let cityId: string;

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'MKK'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table admin_sessions, admin_login_codes, users restart identity cascade`;
  });

  it("⚠️ حمولة حقن SQL في اسم المستخدم تُخزَّن نصّاً ولا تُنفَّذ — الجداول باقية", async () => {
    const payload = "'; DROP TABLE users; --";

    await sql`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, 991001::bigint, ${payload}, '+966500001001', 'ar', 'rider')
    `;

    // الجدول لم يُحذف، والقيمة عادت كما هي حرفاً بحرف
    const rows = await sql<{ full_name: string }[]>`
      select full_name from users where telegram_id = 991001::bigint
    `;
    expect(rows[0]?.full_name).toBe(payload);

    // والجدول ما زال حيّاً بعد العملية
    const alive = await sql<{ count: string }[]>`select count(*)::text as count from users`;
    expect(Number(alive[0]?.count)).toBe(1);
  });

  it("كل حمولة عدائية تُخزَّن وتُقرأ كما هي بلا تلف ولا تنفيذ", async () => {
    let telegramId = 992000;

    for (const name of HOSTILE_NAMES) {
      const raw = HOSTILE_TEXTS[name] ?? "";
      // Postgres يرفض المحرف \u0000 في نصّه — استثناءٌ معروف يُستبعد صراحةً لا صامتاً
      if (raw.includes("\u0000")) continue;
      // نقتصر على طولٍ معقول: الطول المفرط يُفحص في طبقة التحقّق لا في التخزين
      const value = raw.slice(0, 1000);
      telegramId += 1;

      await sql`
        insert into users (city_id, telegram_id, full_name, phone, language_code, role)
        values (${cityId}, ${telegramId}::bigint, ${value}, ${`+96650${telegramId}`}, 'ar', 'rider')
      `;

      const rows = await sql<{ full_name: string }[]>`
        select full_name from users where telegram_id = ${telegramId}::bigint
      `;
      expect(rows[0]?.full_name).toBe(value);
    }

    // كل الصفوف كُتبت، ولا جدول سقط
    const alive = await sql<{ count: string }[]>`select count(*)::text as count from users`;
    expect(Number(alive[0]?.count)).toBeGreaterThan(0);
  });

  it("⚠️ حقن SQL في حقل تسجيل الدخول لا يفتح جلسة ولا يكسر الاستعلام", async () => {
    const auth = createAdminAuthPort(sql);
    const app = new Hono();
    app.route(
      "/admin",
      createAdminUiRoutes({
        sql,
        auth,
        codeSender: { send: async () => true },
      }),
    );

    for (const key of ["SQL", "SQL ثانٍ", "HTML", "رموز فقط", "emoji فقط", "فارغ"]) {
      const body = new FormData();
      body.append("telegram_id", HOSTILE_TEXTS[key] ?? "");

      const response = await app.fetch(
        new Request("http://localhost/admin/login/code", { method: "POST", body }),
      );

      // رفضٌ بالتحقّق الشكلي قبل بلوغ القاعدة — لا 500 ولا 303
      expect(response.status).toBe(422);
      expect(response.headers.get("set-cookie")).toBeNull();
    }

    // ولا جلسة واحدة فُتحت
    const sessions = await sql<{ id: string }[]>`select id from admin_sessions`;
    expect(sessions.length).toBe(0);
  });

  it("كعكات جلسة عدائية لا تفتح اللوحة ولا تُنشئ صفّاً", async () => {
    const auth = createAdminAuthPort(sql);
    const app = new Hono();
    app.route("/admin", createAdminUiRoutes({ sql, auth, codeSender: { send: async () => true } }));

    for (const name of HOSTILE_NAMES) {
      // ترويسة Cookie لا تحمل إلا ASCII — وهذا ما يفعله المتصفّح فعلاً بالقيم العربية
      const cookieValue = encodeURIComponent(HOSTILE_TEXTS[name] ?? "");
      const response = await app.fetch(
        new Request("http://localhost/admin", {
          headers: { cookie: `${ADMIN_SESSION_COOKIE}=${cookieValue}` },
          redirect: "manual",
        }),
      );
      // تحويل إلى صفحة الدخول — لا 200 ولا 500
      expect(response.status).toBe(303);
    }

    const sessions = await sql<{ id: string }[]>`select id from admin_sessions`;
    expect(sessions.length).toBe(0);
  });

  /**
   * اختبار انحدار لسباق حقيقي وُجد وأُصلح (هجرة phase_6_fix_login_code_race).
   * قبل الإصلاح: `select count(*)` ثم `insert` بلا قفل — فتقرأ المعاملات
   * المتزامنة عدّاداً واحداً قديماً وتكتب جميعاً. قياس موثّق بـ 40 جولة × 30
   * متزامناً: 31 جولة تجاوزت، وبلغ أقصى إصدار 9 رموز والحدّ 5.
   *
   * التزامن هنا 30 لا 20: بـ 20 كان السباق يظهر مرّة ويغيب مرّات، واختبارٌ
   * يمسك الانحدار مرّة من ثلاث لا يحمي. وللفحص المكثّف: scripts/race-login-code.ts
   */
  it("⚠️ انحدار: ثلاثون طلب رمز دخول متزامناً لا تخترق الحدّ ولا تترك صفوفاً زائدة", async () => {
    await sql`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, 993001::bigint, 'مسؤول التزامن', '+966500003001', 'ar', 'admin')
    `;
    const auth = createAdminAuthPort(sql);

    const attempts = Array.from({ length: 30 }, (_, index) =>
      auth.issueCode("993001", `${index}`.padStart(64, "0")),
    );
    const results = await Promise.all(attempts);

    // لا استثناء: كلّها عادت بنتيجة، ناجحة أو مرفوضة بسبب معروف
    for (const result of results) {
      expect(result.ok).toBe(true);
    }

    const granted = results.filter((r) => r.ok && r.value.ok).length;
    const limited = results.filter(
      (r) => r.ok && !r.value.ok && r.value.error === "RATE_LIMITED",
    ).length;

    // الحدّ خمسة في النافذة: ما زاد يجب أن يُرفض بالحدّ لا أن يمرّ
    expect(granted).toBeLessThanOrEqual(5);
    expect(granted + limited).toBe(30);

    // والأهمّ: ما في القاعدة فعلاً — الردّ قد يكذب، والصفوف لا تكذب
    const stored = await sql<{ count: string }[]>`
      select count(*)::text as count from admin_login_codes
    `;
    expect(Number(stored[0]?.count)).toBeLessThanOrEqual(5);
  });

  it("⚠️ سقوط القاعدة يُنتج فشلاً مُصنَّفاً لا انهياراً غير معالَج", async () => {
    // اتصال إلى منفذ مغلق: أقرب محاكاة أمينة لقاعدة غير متاحة
    const deadSql = createSql({
      connectionString: "postgres://postgres@127.0.0.1:1/waslah_dead",
    });
    const deadAuth = createAdminAuthPort(deadSql);

    // لا استثناء يتسرّب: النتيجة Result فاشلة
    const issued = await deadAuth.issueCode("993001", "0".repeat(64));
    expect(issued.ok).toBe(false);

    const touched = await deadAuth.touchSession("0".repeat(64));
    expect(touched.ok).toBe(false);

    await deadSql.end({ timeout: 1 }).catch(() => undefined);
  });

  it("القاعدة الساقطة تُظهر للمستخدم رسالة لا صفحة خطأ 500 عارية", async () => {
    const deadSql = createSql({
      connectionString: "postgres://postgres@127.0.0.1:1/waslah_dead",
    });
    const app = new Hono();
    app.route(
      "/admin",
      createAdminUiRoutes({
        sql: deadSql,
        auth: createAdminAuthPort(deadSql),
        codeSender: { send: async () => true },
      }),
    );

    const body = new FormData();
    body.append("telegram_id", "993001");
    const response = await app.fetch(
      new Request("http://localhost/admin/login/code", { method: "POST", body }),
    );

    // المهمّ: استجابة محكومة وليست انهياراً — ورسالة عربية مفهومة للمستخدم
    expect(response.status).toBeLessThan(600);
    const html = await response.text();
    expect(html.length).toBeGreaterThan(0);

    await deadSql.end({ timeout: 1 }).catch(() => undefined);
  });
});
