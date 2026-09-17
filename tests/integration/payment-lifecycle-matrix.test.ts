/**
 * الغرض: **مصفوفةُ أطوارِ دورةِ حياةِ الدفعِ** (البند `F8-06`) مقيسةً على
 *   PostgreSQL حقيقيٍّ: نجاحٌ، فشلٌ، معلّقٌ، مكرّرٌ، استرجاعٌ، تناقضٌ.
 * الحالة: منفَّذٌ فعليّاً — البند `F8-06`.
 * ينتمي إلى: tests/integration
 * يُستخدَمُ من: scripts/check-payment-lifecycle-matrix.ts (يُطابِقُ أسماءَ
 *   `it` حرفاً بحرفٍ مع `scripts/lib/payment-lifecycle-matrix.ts`).
 * الحاكم: ADR 0133 · ADR 0135 · docs/MASTER_DIRECTIVE.md ٠٫٦
 *
 * ## قاعدةُ هذا الملفِّ: **الأثرُ يُقرأُ من الجداولِ لا من الجوابِ**
 *
 * جوابُ الدالَّةِ دعوى، والصفُّ حقيقةٌ. فكلُّ حالةٍ ههنا تقرأُ **بعدَ** النداءِ:
 * حالَ `payment_transactions`، وعدَّ `ledger_entries`، وعدَّ الاشتراكاتِ
 * الفاعلةِ، وعدَّ `subscription_refunds`، وقيدَ المحفظةِ. **والغيابُ يُقاسُ بعدٍّ
 * صِفريٍّ** لا بسكوتٍ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يبذُرُ مزوّداً حقيقيّاً ولا ويبهوكاً**: الأطوارُ تُقادُ من دوالِّ
 *      القاعدةِ عينِها — وهيَ الكاتبُ الفعليُّ لحالةِ الدفعِ. مسارُ الويبهوكِ
 *      مقيسٌ في `tests/integration/payment-real-flow.test.ts` ولا يُكرَّرُ.
 *   ــ **ولا يبذُرُ إعداداً في `platform_settings`**: مِلفٌّ يُلوِّثُ إعداداً
 *      يُسقِطُ `settings-parity` في مِلفٍّ آخرَ. فما لا يُنظَّفُ لا يُبذَرُ.
 *   ــ **ولا يُنشئُ مدينةً**: يُقرأُ أوّلُ صفٍّ قائمٍ في `cities`.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
let sql: Sql;
let seq = 0;
const base = 7_600_000_000 + (Date.now() % 200_000_000);

interface Fixture {
  cityId: string;
  driverId: string;
  adminId: string;
}

async function fixture(): Promise<Fixture> {
  seq += 1;
  const city = (await sql<{ id: string }[]>`select id from cities order by code limit 1`)[0];
  if (!city) throw new Error("city missing");
  const driverUser = (
    await sql<
      { id: string }[]
    >`insert into users(city_id,telegram_id,full_name,phone,role) values(${city.id},${base + seq},${`طورٌ ${seq}`},${`+9665${String(base + seq).slice(-8)}`},'driver') returning id`
  )[0];
  const admin = (
    await sql<
      { id: string }[]
    >`insert into users(city_id,telegram_id,full_name,phone,role) values(${city.id},${base + 300_000 + seq},${`مديرُ طورٍ ${seq}`},${`+9665${String(base + 300_000 + seq).slice(-8)}`},'admin') returning id`
  )[0];
  if (!driverUser || !admin) throw new Error("user missing");
  const driver = (
    await sql<
      { id: string }[]
    >`insert into drivers(city_id,user_id,vehicle_type,plate_number) values(${city.id},${driverUser.id},'sedan',${`PLC-${base + seq}`}) returning id`
  )[0];
  if (!driver) throw new Error("driver missing");
  return { cityId: city.id, driverId: driver.id, adminId: admin.id };
}

interface Envelope {
  ok: boolean;
  error?: string;
  status?: string;
  already_confirmed?: boolean;
  stored?: boolean;
  checkout_url?: string;
  stored_provider_transaction_id?: string;
  transaction_id?: string;
  refund_id?: string;
}

async function call(query: Promise<{ result: Envelope }[]>): Promise<Envelope> {
  const rows = await query;
  const envelope = rows[0]?.result;
  if (envelope === undefined) throw new Error("envelope missing");
  return envelope;
}

/** دفعةٌ معلَّقةٌ جديدةٌ بمبلغٍ معلومٍ ووسمٍ صحيحٍ — نقطةُ بدءِ كلِّ طورٍ. */
async function pending(f: Fixture, tag: string, amountMinor = 1200): Promise<string> {
  const created = await call(sql<{ result: Envelope }[]>`
    select create_payment(${f.cityId}::uuid, ${f.driverId}::uuid, 'driver_subscription',
      ${amountMinor}, 'SAR', 'test', null, 'pending', ${`plc-${base}-${seq}-${tag}`},
      ${sql.json({ plan: "transport" })}) as result`);
  const id = created.transaction_id;
  if (id === undefined) throw new Error("transaction missing");
  return id;
}

async function statusOf(id: string): Promise<string | null> {
  const rows = await sql<
    { status: string }[]
  >`select status from payment_transactions where id=${id}::uuid`;
  return rows[0]?.status ?? null;
}

async function providerRefOf(id: string): Promise<string | null> {
  const rows = await sql<
    { provider_transaction_id: string | null }[]
  >`select provider_transaction_id from payment_transactions where id=${id}::uuid`;
  return rows[0]?.provider_transaction_id ?? null;
}

async function checkoutUrlOf(id: string): Promise<string | null> {
  const rows = await sql<
    { url: string | null }[]
  >`select metadata #>> '{checkout_url}' as url from payment_transactions where id=${id}::uuid`;
  return rows[0]?.url ?? null;
}

async function countOne(query: Promise<{ n: number }[]>): Promise<number> {
  const rows = await query;
  return rows[0]?.n ?? -1;
}

const ledgerCount = (id: string): Promise<number> =>
  countOne(
    sql<
      { n: number }[]
    >`select count(*)::int n from ledger_entries where transaction_id=${id}::uuid`,
  );

const activeSubscriptions = (driverId: string): Promise<number> =>
  countOne(
    sql<
      { n: number }[]
    >`select count(*)::int n from subscriptions where driver_id=${driverId}::uuid and status='active'`,
  );

const refundRows = (id: string): Promise<number> =>
  countOne(
    sql<
      { n: number }[]
    >`select count(*)::int n from subscription_refunds where payment_transaction_id=${id}::uuid`,
  );

const walletCredits = (id: string): Promise<number> =>
  countOne(
    sql<
      { n: number }[]
    >`select coalesce(sum(amount_minor),0)::int n from subscription_wallet_entries where source_payment_id=${id}::uuid and direction='credit'`,
  );

/** التأكيدُ بالحملِ الرباعيِّ — وهوَ مسارُ الويبهوكِ المُتحقِّقِ من المزوّدِ. */
const confirm4 = (id: string, ref: string, status: string): Promise<Envelope> =>
  call(
    sql<
      { result: Envelope }[]
    >`select confirm_payment(${id}::uuid, ${ref}, ${status}, 'test') as result`,
  );

/** والحملُ الثلاثيُّ — مسارُ الإنتاجِ بلا مزوّدٍ صريحٍ، ويُقاسُ لأنَّهُ حيٌّ. */
const confirm3 = (id: string, ref: string | null, status: string): Promise<Envelope> =>
  call(
    sql<{ result: Envelope }[]>`select confirm_payment(${id}::uuid, ${ref}, ${status}) as result`,
  );

beforeAll(() => {
  if (DATABASE_URL !== undefined) sql = createSql({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql.end();
});

describeIf("مصفوفةُ أطوارِ دورةِ حياةِ الدفعِ على PostgreSQL حقيقيٍّ", () => {
  it("الطورُ معلّقٌ: إنشاءُ دفعةٍ يكتبُ pending بلا دفترٍ ولا مرجعِ مزوّدٍ", async () => {
    const f = await fixture();
    const id = await pending(f, "01");
    expect(await statusOf(id)).toBe("pending");
    expect(await providerRefOf(id)).toBeNull();
    expect(await ledgerCount(id)).toBe(0);
    expect(await activeSubscriptions(f.driverId)).toBe(0);
    // الإيدمبوتنسي: المفتاحُ عينُه لا يُنشئُ صفّاً ثانياً.
    const again = await call(sql<{ result: Envelope }[]>`
      select create_payment(${f.cityId}::uuid, ${f.driverId}::uuid, 'driver_subscription',
        1200, 'SAR', 'test', null, 'pending', ${`plc-${base}-${seq}-01`},
        ${sql.json({ plan: "transport" })}) as result`);
    expect(again.ok).toBe(true);
    expect(again.transaction_id).toBe(id);
  });

  it("الطورُ ناجحٌ: التأكيدُ يكتبُ active ودفتراً واحداً واشتراكاً فاعلاً واحداً", async () => {
    const f = await fixture();
    const id = await pending(f, "02");
    const done = await confirm4(id, `ref-${base}-02`, "active");
    expect(done.ok).toBe(true);
    expect(await statusOf(id)).toBe("active");
    expect(await providerRefOf(id)).toBe(`ref-${base}-02`);
    expect(await ledgerCount(id)).toBe(1);
    expect(await activeSubscriptions(f.driverId)).toBe(1);
  });

  it("الطورُ فاشلٌ: failed لا يفتحُ اشتراكاً ولا يكتبُ دفتراً", async () => {
    const f = await fixture();
    const id = await pending(f, "03");
    const done = await confirm4(id, `ref-${base}-03`, "failed");
    expect(done.ok).toBe(true);
    expect(await statusOf(id)).toBe("failed");
    expect(await ledgerCount(id)).toBe(0);
    expect(await activeSubscriptions(f.driverId)).toBe(0);
  });

  it("الطورُ مكرّرٌ: تأكيدانِ متزامنانِ يُنتِجانِ دفتراً واحداً واشتراكاً واحداً", async () => {
    const f = await fixture();
    const id = await pending(f, "04");
    const ref = `ref-${base}-04`;
    const [a, b] = await Promise.all([confirm4(id, ref, "active"), confirm4(id, ref, "active")]);
    // واحدٌ ينجحُ والآخرُ يُرفَضُ رفضاً مُسمّى — ولا ثالثَ.
    expect([a.ok, b.ok].filter((ok) => ok === true)).toHaveLength(1);
    const rejected = a.ok ? b : a;
    expect(rejected.error).toBe("INVALID_STATUS_TRANSITION");
    expect(await statusOf(id)).toBe("active");
    expect(await ledgerCount(id)).toBe(1);
    expect(await activeSubscriptions(f.driverId)).toBe(1);
  });

  it("الطورُ استرجاعٌ: استردادٌ كاملٌ يكتبُ صفّاً واحداً ويضعُ refunded ويُقيِّدُ المحفظةَ", async () => {
    const f = await fixture();
    const id = await pending(f, "05");
    await confirm4(id, `ref-${base}-05`, "active");
    const input = sql<{ result: Envelope }[]>`
      select refund_subscription_payment(${id}::uuid, 1200, 'wallet_credit',
        ${f.adminId}::uuid, 'خطأٌ في التحصيلِ', ${`R-${base}-05`}) as result`;
    const refunded = await call(input);
    expect(refunded.ok).toBe(true);
    expect(await statusOf(id)).toBe("refunded");
    expect(await refundRows(id)).toBe(1);
    expect(await walletCredits(id)).toBe(1200);
  });

  it("الاستردادُ الجزئيُّ مرفوضٌ صريحاً: لا refunded كاملٌ لمبلغٍ ناقصٍ", async () => {
    const f = await fixture();
    const id = await pending(f, "06");
    await confirm4(id, `ref-${base}-06`, "active");
    const partial = await call(sql<{ result: Envelope }[]>`
      select refund_subscription_payment(${id}::uuid, 300, 'wallet_credit',
        ${f.adminId}::uuid, 'جزئيٌّ', ${`R-${base}-06`}) as result`);
    expect(partial.ok).toBe(false);
    expect(partial.error).toBe("REFUND_PARTIAL_UNSUPPORTED");
    // ولا أثرَ للمحاولةِ: الحالُ كما كانَ، ولا صفَّ استردادٍ، ولا قيدَ محفظةٍ.
    expect(await statusOf(id)).toBe("active");
    expect(await refundRows(id)).toBe(0);
    expect(await walletCredits(id)).toBe(0);
    // والكاملُ بعدَه يمرُّ: الرفضُ لم يُغلِقِ البابَ على المستحقِّ.
    const full = await call(sql<{ result: Envelope }[]>`
      select refund_subscription_payment(${id}::uuid, 1200, 'wallet_credit',
        ${f.adminId}::uuid, 'كاملٌ', ${`R-${base}-06-full`}) as result`);
    expect(full.ok).toBe(true);
    expect(await refundRows(id)).toBe(1);
  });

  it("الطورُ تناقضٌ: مرجعُ مزوّدٍ ثانٍ مختلفٌ لا يُستبدِلُ الأوّلَ", async () => {
    const f = await fixture();
    const id = await pending(f, "07");
    const first = await call(sql<{ result: Envelope }[]>`
      select record_payment_provider_reference(${id}::uuid, 'test', ${`A-${base}-07`}) as result`);
    expect(first.ok).toBe(true);
    expect(first.stored).toBe(true);
    const second = await call(sql<{ result: Envelope }[]>`
      select record_payment_provider_reference(${id}::uuid, 'test', ${`B-${base}-07`}) as result`);
    expect(second.ok).toBe(false);
    expect(second.error).toBe("PROVIDER_TRANSACTION_MISMATCH");
    expect(second.stored_provider_transaction_id).toBe(`A-${base}-07`);
    expect(await providerRefOf(id)).toBe(`A-${base}-07`);
    // والحملُ الثلاثيُّ كانَ ثقبَ الضمانةِ: يُقاسُ أنَّهُ صارَ يرفضُ كالكاتبِ عينِه.
    const viaConfirm = await confirm3(id, `B-${base}-07`, "pending");
    expect(viaConfirm.ok).toBe(false);
    expect(viaConfirm.error).toBe("PROVIDER_TRANSACTION_MISMATCH");
    expect(await providerRefOf(id)).toBe(`A-${base}-07`);
    // والمطابقُ يمرُّ، فالضمانةُ ليست منعاً لإعادةِ المحاولةِ.
    const same = await confirm3(id, `A-${base}-07`, "pending");
    expect(same.ok).toBe(true);
    expect(await providerRefOf(id)).toBe(`A-${base}-07`);
  });

  it("الطورُ تناقضٌ: دفعةٌ محسومةٌ لا تُعادُ إلى فاشلةٍ", async () => {
    const f = await fixture();
    const id = await pending(f, "08");
    await confirm4(id, `ref-${base}-08`, "active");
    const reverted = await confirm4(id, `ref-${base}-08`, "failed");
    expect(reverted.ok).toBe(false);
    expect(reverted.error).toBe("INVALID_STATUS_TRANSITION");
    // والحملُ الثلاثيُّ يردُّ برسالةٍ أخرى — **والمقيسُ الأثرُ لا الرسالةُ**:
    // لا ينقُضُ الحالَ ولا يزيدُ سطرَ دفترٍ.
    const viaThree = await confirm3(id, `ref-${base}-08`, "failed");
    expect(viaThree.already_confirmed).toBe(true);
    expect(viaThree.status).toBe("active");
    expect(await statusOf(id)).toBe("active");
    expect(await ledgerCount(id)).toBe(1);
    expect(await activeSubscriptions(f.driverId)).toBe(1);
  });

  it("الطورُ معلّقٌ: رابطُ الدفعِ يُحفَظُ للمعلّقةِ وحدَها", async () => {
    const f = await fixture();
    const id = await pending(f, "09");
    const url = `https://pay.example/${base}-09`;
    const stored = await call(sql<{ result: Envelope }[]>`
      select record_payment_checkout(${id}::uuid, ${url}) as result`);
    expect(stored.ok).toBe(true);
    expect(stored.stored).toBe(true);
    // الضغطةُ الثانيةُ تُعيدُ الأوّلَ ولا تكتبُ فوقَه.
    const again = await call(sql<{ result: Envelope }[]>`
      select record_payment_checkout(${id}::uuid, ${`${url}-other`}) as result`);
    expect(again.ok).toBe(true);
    expect(again.stored).toBe(false);
    expect(await checkoutUrlOf(id)).toBe(url);
    // وبعدَ الحسمِ لا رابطَ يُكتَبُ: نداءٌ على غيرِ pending يُرفَضُ ولا يُغيِّرُ عموداً.
    await confirm4(id, `ref-${base}-09`, "failed");
    const late = await call(sql<{ result: Envelope }[]>`
      select record_payment_checkout(${id}::uuid, ${`${url}-late`}) as result`);
    expect(late.ok).toBe(false);
    expect(late.error).toBe("TRANSACTION_NOT_PENDING");
    expect(await checkoutUrlOf(id)).toBe(url);
  });

  it("الطورُ فاشلٌ: past_due يبقى قابلاً للحسمِ ولا يفتحُ اشتراكاً", async () => {
    const f = await fixture();
    const id = await pending(f, "10");
    const due = await confirm4(id, `ref-${base}-10`, "past_due");
    expect(due.ok).toBe(true);
    expect(await statusOf(id)).toBe("past_due");
    expect(await ledgerCount(id)).toBe(0);
    expect(await activeSubscriptions(f.driverId)).toBe(0);
    // وهيَ الحالُ الوحيدةُ غيرُ النهائيّةِ بعدَ pending: الحسمُ بعدَها يمرُّ.
    const settled = await confirm4(id, `ref-${base}-10`, "active");
    expect(settled.ok).toBe(true);
    expect(await statusOf(id)).toBe("active");
    expect(await ledgerCount(id)).toBe(1);
    expect(await activeSubscriptions(f.driverId)).toBe(1);
  });

  it("الطورُ فاشلٌ: canceled نهائيّةٌ لا تُحسَمُ بعدَها", async () => {
    const f = await fixture();
    const id = await pending(f, "11");
    expect((await confirm4(id, `ref-${base}-11`, "canceled")).ok).toBe(true);
    expect(await statusOf(id)).toBe("canceled");
    const after = await confirm4(id, `ref-${base}-11`, "active");
    expect(after.ok).toBe(false);
    expect(after.error).toBe("INVALID_STATUS_TRANSITION");
    expect(await statusOf(id)).toBe("canceled");
    expect(await ledgerCount(id)).toBe(0);
    expect(await activeSubscriptions(f.driverId)).toBe(0);
  });

  it("الطورُ فاشلٌ: expired نهائيّةٌ لا تُحسَمُ بعدَها", async () => {
    const f = await fixture();
    const id = await pending(f, "12");
    expect((await confirm4(id, `ref-${base}-12`, "expired")).ok).toBe(true);
    expect(await statusOf(id)).toBe("expired");
    const after = await confirm4(id, `ref-${base}-12`, "active");
    expect(after.ok).toBe(false);
    expect(after.error).toBe("INVALID_STATUS_TRANSITION");
    expect(await statusOf(id)).toBe("expired");
    expect(await ledgerCount(id)).toBe(0);
    expect(await activeSubscriptions(f.driverId)).toBe(0);
  });
});
