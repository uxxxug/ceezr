/**
 * يثبت على PostgreSQL حقيقي محفظة ائتمان الاشتراك، الدفتر، الاسترداد، الفاتورة والتسوية.
 * كل كتابة حرجة لها Promise.all متنافس؛ النجاح لا يعتمد على منطق تزامن TypeScript.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createSubscriptionWalletRpc } from "../../packages/infrastructure/financial/subscription-wallet-adapters.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
let sql: Sql;
let seq = 0;
const base = 7_100_000_000 + (Date.now() % 500_000_000);
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
    >`insert into users(city_id,telegram_id,full_name,phone,role) values(${city.id},${base + seq},${`مالية ${seq}`},${`+9665${String(base + seq).slice(-8)}`},'driver') returning id`
  )[0];
  const admin = (
    await sql<
      { id: string }[]
    >`insert into users(city_id,telegram_id,full_name,phone,role) values(${city.id},${base + 100000 + seq},${`مدير ${seq}`},${`+9665${String(base + 100000 + seq).slice(-8)}`},'admin') returning id`
  )[0];
  if (!driverUser || !admin) throw new Error("user missing");
  const driver = (
    await sql<
      { id: string }[]
    >`insert into drivers(city_id,user_id,vehicle_type,plate_number) values(${city.id},${driverUser.id},'sedan',${`FW-${base + seq}`}) returning id`
  )[0];
  if (!driver) throw new Error("driver missing");
  return { cityId: city.id, driverId: driver.id, adminId: admin.id };
}
/**
 * هويّةُ البائعِ **في الاختبارِ لا في هجرةٍ**: رقمٌ مبذورٌ في هجرةٍ يصيرُ
 * رقماً في فاتورةٍ حقيقيّةٍ لا يملكُه أحدٌ — ويمنعُه حاجزُ عقدِ الفاتورةِ
 * (القاعدةُ ٧). وفي الاختبارِ هوَ مُدخَلٌ لا دعوى إنتاجٍ.
 */
async function seedTaxIdentity(cityId: string): Promise<void> {
  await sql`insert into platform_settings(city_id,key,value,value_type,description_ar,is_provisional)
    values(${cityId},'tax_seller_name',${sql.json("منشأةٌ اختباريّةٌ")},'string','اسمُ بائعٍ للاختبارِ',true)
    on conflict (city_id,key) do update set value=excluded.value`;
  await sql`insert into platform_settings(city_id,key,value,value_type,description_ar,is_provisional)
    values(${cityId},'tax_seller_vat_number',${sql.json("300000000000003")},'string','رقمٌ ضريبيٌّ للاختبارِ',true)
    on conflict (city_id,key) do update set value=excluded.value`;
}
async function payment(f: Fixture, key: string, amount = 1200): Promise<string> {
  const created = await sql<
    { result: { transaction_id: string } }[]
  >`select create_payment(${f.cityId}::uuid,${f.driverId}::uuid,'driver_subscription',${amount},'SAR','test',null,'pending',${key},${sql.json({ plan: "transport" })}) as result`;
  const id = created[0]?.result.transaction_id;
  if (!id) throw new Error("payment missing");
  await sql`select confirm_payment(${id}::uuid,${`provider-${key}`},'active')`;
  return id;
}
beforeAll(async () => {
  if (DATABASE_URL) sql = createSql({ connectionString: DATABASE_URL });
});
afterAll(async () => {
  if (DATABASE_URL) await sql.end();
});
describeIf("financial subscription wallet on real database", () => {
  it("ينشئ محفظة واحدة تحت السباق ويقرأ مجموع دفترها", async () => {
    const f = await fixture();
    const rpc = createSubscriptionWalletRpc(sql);
    const [a, b] = await Promise.all([
      rpc.createWallet(f.driverId as never),
      rpc.createWallet(f.driverId as never),
    ]);
    expect(a.ok && b.ok && a.value.walletId).toBe(b.ok ? b.value.walletId : null);
    const balance = await rpc.getBalance(f.driverId as never);
    expect(balance.ok && balance.value.balanceMinor).toBe(0);
  });
  it("يضيف دفعة مؤكدة مرة واحدة تحت إعادة إرسال متزامنة", async () => {
    const f = await fixture();
    const rpc = createSubscriptionWalletRpc(sql);
    const id = await payment(f, `topup-${base}-${seq}`);
    const input = {
      driverId: f.driverId as never,
      paymentId: id as never,
      amountMinor: 1200,
      actorUserId: null,
      reason: null,
      reference: null,
      idempotencyKey: `topup-race-${base}-${seq}`,
    };
    const [a, b] = await Promise.all([rpc.topUp(input), rpc.topUp(input)]);
    expect(a.ok && a.value.ok).toBe(true);
    expect(b.ok && b.value.ok).toBe(true);
    const balance = await rpc.getBalance(f.driverId as never);
    expect(balance.ok && balance.value.balanceMinor).toBe(1200);
  });
  it("يسجل قرار ائتمان إداري موثق ولا يكرر المفتاح", async () => {
    const f = await fixture();
    const rpc = createSubscriptionWalletRpc(sql);
    const input = {
      driverId: f.driverId as never,
      paymentId: null,
      amountMinor: 77,
      actorUserId: f.adminId,
      reason: "خلل نظام",
      reference: `INC-${base}-${seq}`,
      idempotencyKey: `admin-topup-${base}-${seq}`,
    };
    const [a, b] = await Promise.all([rpc.topUp(input), rpc.topUp(input)]);
    expect(a.ok && a.value.ok).toBe(true);
    expect(b.ok && b.value.ok).toBe(true);
    const audit = await sql<
      { n: number }[]
    >`select count(*)::int n from audit_log where action='subscription_wallet.topped_up' and city_id=${f.cityId}`;
    expect(audit[0]?.n).toBeGreaterThan(0);
  });
  it("يرفض الزائد ويسترد الدفعة مرة واحدة إلى المحفظة تحت السباق", async () => {
    const f = await fixture();
    const rpc = createSubscriptionWalletRpc(sql);
    const id = await payment(f, `refund-${base}-${seq}`);
    const tooMuch = await rpc.refund({
      paymentId: id as never,
      amountMinor: 1201,
      destination: "wallet_credit",
      actorUserId: f.adminId,
      reason: "خطأ",
      reference: `R-${base}-${seq}`,
    });
    expect(tooMuch.ok && tooMuch.value.ok).toBe(false);
    const input = {
      paymentId: id as never,
      amountMinor: 1200,
      destination: "wallet_credit" as const,
      actorUserId: f.adminId,
      reason: "خطأ",
      reference: `R-${base}-${seq}`,
    };
    const [a, b] = await Promise.all([rpc.refund(input), rpc.refund(input)]);
    expect(a.ok && a.value.ok).toBe(true);
    expect(b.ok && b.value.ok).toBe(true);
    expect((a.ok && a.value.alreadyRefunded) || (b.ok && b.value.alreadyRefunded)).toBe(true);
    const count = await sql<
      { n: number }[]
    >`select count(*)::int n from subscription_refunds where payment_transaction_id=${id}::uuid`;
    expect(count[0]?.n).toBe(1);
  });
  // زيادةٌ بعدَ `F3-09` (`ح-8`): صارَ الكاتبُ يُفوتِرُ **ضريبيّاً**، والإصدارُ
  // **فشلٌ مغلقٌ** دونَ هويّةِ بائعٍ مُهَيّأةٍ. فيُقاسُ الوجهانِ: الغيابُ يمنعُ،
  // والتهيئةُ تُصدِرُ رقماً واحداً تحتَ السباقِ.
  it("يرفض الفاتورة دون هوية بائع ضريبية مهيأة", async () => {
    const f = await fixture();
    const rpc = createSubscriptionWalletRpc(sql);
    await sql`delete from platform_settings where city_id=${f.cityId} and key in ('tax_seller_name','tax_seller_vat_number')`;
    const id = await payment(f, `invoice-notax-${base}-${seq}`);
    const rejected = await rpc.issueInvoice(id as never);
    expect(rejected.ok && rejected.value.ok).toBe(false);
    const count = await sql<
      { n: number }[]
    >`select count(*)::int n from subscription_invoices where payment_transaction_id=${id}::uuid`;
    expect(count[0]?.n).toBe(0);
  });
  it("يصدر فاتورة فريدة للدفعة نفسها تحت السباق", async () => {
    const f = await fixture();
    const rpc = createSubscriptionWalletRpc(sql);
    await seedTaxIdentity(f.cityId);
    const id = await payment(f, `invoice-${base}-${seq}`);
    const [a, b] = await Promise.all([
      rpc.issueInvoice(id as never),
      rpc.issueInvoice(id as never),
    ]);
    expect(a.ok && a.value.ok).toBe(true);
    expect(b.ok && b.value.ok).toBe(true);
    expect(a.ok && b.ok && a.value.invoiceNumber).toBe(b.ok ? b.value.invoiceNumber : null);
    const count = await sql<
      { n: number }[]
    >`select count(*)::int n from subscription_invoices where payment_transaction_id=${id}::uuid`;
    expect(count[0]?.n).toBe(1);
    // والصفُّ فاتورةٌ ضريبيّةٌ تامّةٌ لا صفّاً بخاناتٍ فارغةٍ.
    const row = (
      await sql<
        {
          document_type: string;
          vat_amount_minor: number;
          total_excl_vat_minor: number;
          amount_minor: number;
          qr_tlv_base64: string;
        }[]
      >`select document_type,vat_amount_minor,total_excl_vat_minor,amount_minor,qr_tlv_base64 from subscription_invoices where payment_transaction_id=${id}::uuid`
    )[0];
    expect(row?.document_type).toBe("SIMPLIFIED_TAX_INVOICE");
    expect((row?.total_excl_vat_minor ?? 0) + (row?.vat_amount_minor ?? 0)).toBe(
      row?.amount_minor ?? -1,
    );
    expect((row?.qr_tlv_base64 ?? "").length).toBeGreaterThan(0);
  });
  it("يصصح خطأ نظام موثق مرة واحدة ويكتب audit_log", async () => {
    const f = await fixture();
    const rpc = createSubscriptionWalletRpc(sql);
    const input = {
      driverId: f.driverId as never,
      adjustmentMinor: 33,
      actorUserId: f.adminId,
      reason: "خلل نظام",
      reference: `INC-${base}-${seq}`,
      idempotencyKey: `settle-${base}-${seq}`,
    };
    const [a, b] = await Promise.all([rpc.settleSystemError(input), rpc.settleSystemError(input)]);
    expect(a.ok && a.value.ok).toBe(true);
    expect(b.ok && b.value.ok).toBe(true);
    const audit = await sql<
      { n: number }[]
    >`select count(*)::int n from audit_log where action='subscription_wallet.system_error_settled' and city_id=${f.cityId}`;
    expect(audit[0]?.n).toBeGreaterThan(0);
  });
});
