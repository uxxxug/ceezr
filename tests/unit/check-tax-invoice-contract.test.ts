/**
 * الغرض: زرعُ حالةٍ سالبةٍ لكلِّ قاعدةٍ من قواعدِ عقدِ الفاتورةِ الضريبيّةِ الثمانِ
 *   وإثباتُ أنَّ الحاجزَ يلتقطُها — والقاعدةُ بلا سالبةٍ **غيرُ مُنفَذةٍ** (`ح-7`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit` وسلسلةُ `ci`.
 * يُتوقع أن يستخدمه لاحقاً: كلُّ قاعدةٍ تُزادُ في العقدِ — **تُزادُ معها سالبةٌ
 *   هنا في الالتزامِ نفسِه**.
 * يحرسُه: scripts/check-tax-invoice-contract.ts (المقيسُ نفسُه)
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ولِمَ الأساسُ مصنوعٌ لا مقروءٌ من المستودعِ: كي يُقاسَ **الحكمُ** لا الحالةُ
 * الراهنةُ. ومِلفٌّ يُقرأُ من القرصِ يجعلُ الاختبارَ يسقطُ بتغييرِ تعليقٍ.
 */

import { describe, expect, test } from "bun:test";
import { readRepository } from "../../scripts/check-tax-invoice-contract.ts";
import {
  getHandlerBodies,
  mappedStatusCodes,
  rejectionsFromSql,
  type TaxInvoiceContractInput,
  taxInvoiceContractProblems,
} from "../../scripts/lib/tax-invoice-contract.ts";

/** هجرةٌ صغيرةٌ صالحةٌ — تُعيدُ الرموزَ الثلاثةَ وتقسمُ قسمةً شاملةً. */
const VALID_MIGRATION = `
create table subscription_invoices (
  id bigserial primary key,
  city_id bigint not null references cities(id),
  total_incl_vat_minor integer not null
);
create function issue_subscription_tax_invoice(p_user bigint, p_txn uuid)
returns jsonb language plpgsql as $$
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  if not v_is_driver then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;
  if v_txn is null then
    return jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_FOUND');
  end if;
  v_vat_minor := round(v_txn.amount_minor::numeric * v_rate_bps / (10000 + v_rate_bps))::integer;
  return jsonb_build_object('ok', true);
end;
$$;
`;

/** موجِّهٌ صغيرٌ صالحٌ — `GET` يقرأُ و`POST` يُصدِرُ، وخريطةٌ شاملةٌ. */
const VALID_ROUTE = `
const STATUS_BY_ERROR: Record<string, number> = {
  USER_NOT_FOUND: 404,
  NOT_A_DRIVER: 403,
  TRANSACTION_NOT_FOUND: 404,
};

export function createDriverSubscriptionInvoiceRoutes(deps: Deps) {
  const app = new Hono();
  app.get("/v1/driver/subscription/payments/:transactionId", async (context) => {
    const outcome = await readSubscriptionPaymentStatus(deps.invoices, token);
    return context.json(outcome);
  });
  app.post("/v1/driver/subscription/payments/:transactionId/invoice", async (context) => {
    const outcome = await deps.invoices.store.issueInvoice(userId, transactionId);
    return context.json(outcome);
  });
  return app;
}
`;

function baseline(): TaxInvoiceContractInput {
  return {
    invoiceMigration: VALID_MIGRATION,
    allMigrations: { "supabase/migrations/0001_base.sql": VALID_MIGRATION },
    scopeFiles: { "packages/application/driver/subscription-invoice.ts": "export const X = 1;" },
    routeFile: VALID_ROUTE,
    storeRejections: ["NOT_A_DRIVER", "TRANSACTION_NOT_FOUND", "USER_NOT_FOUND"],
    publicErrorCodes: ["NOT_A_DRIVER", "TRANSACTION_NOT_FOUND", "USER_NOT_FOUND"],
  };
}

function problemsWith(patch: Partial<TaxInvoiceContractInput>): readonly string[] {
  return taxInvoiceContractProblems({ ...baseline(), ...patch });
}

describe("عقدُ الفاتورةِ الضريبيّةِ — الأساسُ الصالحُ", () => {
  test("لا شكوى على مدخلٍ صالحٍ — وإلّا كانَ الحاجزُ يمنعُ الصوابَ", () => {
    expect(taxInvoiceContractProblems(baseline())).toEqual([]);
  });

  test("المستودعُ الحقيقيُّ يمرُّ — القراءةُ والحكمُ موصولانِ فعلاً", () => {
    expect(taxInvoiceContractProblems(readRepository())).toEqual([]);
  });
});

describe("سالباتٌ مزروعةٌ — قاعدةٌ قاعدةً (`ح-7`)", () => {
  test("١ — عمودُ بياناتِ بطاقةٍ في الهجرةِ يُلتقَطُ", () => {
    const problems = problemsWith({
      invoiceMigration: `${VALID_MIGRATION}\nalter table subscription_invoices add column card_number text;`,
    });
    expect(problems.some((problem) => problem.startsWith("[بطاقة]"))).toBe(true);
  });

  test("١ب — حقلُ `cvv` في مِلفِّ نطاقٍ يُلتقَطُ كذلك", () => {
    const problems = problemsWith({
      scopeFiles: {
        "packages/application/driver/subscription-invoice.ts": "const cvv = input.cvv;",
      },
    });
    expect(problems.some((problem) => problem.includes("cvv"))).toBe(true);
  });

  test("٢ — تحديثُ فاتورةٍ في هجرةٍ يُلتقَطُ", () => {
    const problems = problemsWith({
      allMigrations: {
        "supabase/migrations/0002_fix.sql": "update subscription_invoices set seller_name = 'x';",
      },
    });
    expect(problems.some((problem) => problem.startsWith("[خلود]"))).toBe(true);
  });

  test("٢ب — حذفُ فاتورةٍ يُلتقَطُ", () => {
    const problems = problemsWith({
      allMigrations: {
        "supabase/migrations/0003_purge.sql": "delete from subscription_invoices where id = 1;",
      },
    });
    expect(problems.some((problem) => problem.includes("الإلغاءُ بوثيقةٍ مقابلةٍ"))).toBe(true);
  });

  test("٣ — إصدارٌ داخلَ مُعالِجِ `GET` يُلتقَطُ", () => {
    const problems = problemsWith({
      routeFile: VALID_ROUTE.replace(
        "const outcome = await readSubscriptionPaymentStatus(deps.invoices, token);",
        "const outcome = await deps.invoices.store.issueInvoice(userId, transactionId);",
      ),
    });
    expect(problems.some((problem) => problem.startsWith("[قراءة]"))).toBe(true);
  });

  test("٣ب — موجِّهٌ بلا `GET` أصلاً يُعلَنُ غيرَ مقيسٍ لا ناجحاً", () => {
    const problems = problemsWith({
      routeFile: VALID_ROUTE.replace(/app\.get\([\s\S]*?\}\);/, ""),
    });
    expect(problems.some((problem) => problem.includes("غيرُ مقيسةٍ"))).toBe(true);
  });

  test("٤ — رمزٌ تُعيدُه القاعدةُ وليسَ في الاتّحادِ يُلتقَطُ", () => {
    const problems = problemsWith({
      invoiceMigration: VALID_MIGRATION.replace(
        "'error', 'TRANSACTION_NOT_FOUND'",
        "'error', 'TRANSACTION_IS_REFUNDED'",
      ),
    });
    expect(problems.some((problem) => problem.includes("TRANSACTION_IS_REFUNDED"))).toBe(true);
  });

  // الإعفاءُ المشروطُ لرمزِ الكاتبِ الداخليِّ يُقاسُ **من وجهيه**: معَ ذراعِ
  // الترجمةِ يمرُّ، وبدونِها يُلتقَطُ — وإلّا كانَ الإعفاءُ باباً مفتوحاً.
  test("٤ج — رمزُ كاتبٍ داخليٌّ **معَ** ذراعِ ترجمةٍ يُعفى", () => {
    const problems = problemsWith({
      invoiceMigration: `${VALID_MIGRATION}\ncreate function w() returns jsonb as $$ begin
  return jsonb_build_object('ok', false, 'error', 'CONFIRMED_SUBSCRIPTION_PAYMENT_REQUIRED');
end; $$;
create function t() returns jsonb as $$ begin
  return case v_result->>'error'
    when 'CONFIRMED_SUBSCRIPTION_PAYMENT_REQUIRED' then jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_FOUND')
    else v_result end;
end; $$;`,
    });
    expect(
      problems.some((problem) => problem.includes("CONFIRMED_SUBSCRIPTION_PAYMENT_REQUIRED")),
    ).toBe(false);
  });

  test("٤د — رمزُ كاتبٍ داخليٌّ **بلا** ذراعِ ترجمةٍ يُلتقَطُ", () => {
    const problems = problemsWith({
      invoiceMigration: `${VALID_MIGRATION}\ncreate function w() returns jsonb as $$ begin
  return jsonb_build_object('ok', false, 'error', 'CONFIRMED_SUBSCRIPTION_PAYMENT_REQUIRED');
end; $$;`,
    });
    expect(
      problems.some((problem) => problem.includes("CONFIRMED_SUBSCRIPTION_PAYMENT_REQUIRED")),
    ).toBe(true);
  });

  test("٤ب — رمزٌ في الاتّحادِ لا تُعيدُه دالّةٌ يُلتقَطُ", () => {
    const problems = problemsWith({
      storeRejections: ["USER_NOT_FOUND", "NOT_A_DRIVER", "TRANSACTION_NOT_FOUND", "GHOST_CODE"],
    });
    expect(problems.some((problem) => problem.includes("GHOST_CODE"))).toBe(true);
  });

  test("٥ — رمزٌ عامٌّ بلا حالةِ HTTP يُلتقَطُ", () => {
    const problems = problemsWith({
      publicErrorCodes: [
        "USER_NOT_FOUND",
        "NOT_A_DRIVER",
        "TRANSACTION_NOT_FOUND",
        "TAX_IDENTITY_NOT_CONFIGURED",
      ],
    });
    expect(problems.some((problem) => problem.startsWith("[حالة]"))).toBe(true);
  });

  test("٦ — قسمةٌ على 10000 وحدَها (ضريبةٌ مُضافةٌ) تُلتقَطُ", () => {
    const problems = problemsWith({
      invoiceMigration: VALID_MIGRATION.replace(
        "v_rate_bps / (10000 + v_rate_bps)",
        "v_rate_bps / 10000",
      ),
    });
    expect(problems.some((problem) => problem.startsWith("[شمول]"))).toBe(true);
  });

  test("٧ — بذرةُ رقمٍ ضريبيٍّ مُختَرَعٍ تُلتقَطُ", () => {
    const problems = problemsWith({
      allMigrations: {
        "supabase/migrations/0004_seed.sql":
          "insert into platform_settings (city_id, key, value, value_type)\n" +
          "select c.id, 'tax_seller_vat_number', to_jsonb('300000000000003'::text), 'string' from cities c;",
      },
    });
    expect(problems.some((problem) => problem.startsWith("[هويّة]"))).toBe(true);
  });

  test("٨ — معرِّفُ المزوِّدِ في جسمٍ عامٍّ يُلتقَطُ", () => {
    const problems = problemsWith({
      routeFile: `${VALID_ROUTE}\nconst body = { providerTransactionId: row.provider_transaction_id };`,
    });
    expect(problems.some((problem) => problem.startsWith("[كتمان]"))).toBe(true);
  });
});

describe("القارئاتُ المُساعِدةُ — تُقاسُ وحدَها لا بأثرِها", () => {
  test("اقتطاعُ أجسامِ `GET` يفصلُ مُعالِجاً عن مُعالِجٍ", () => {
    const bodies = getHandlerBodies(VALID_ROUTE);
    expect(bodies.length).toBe(1);
    expect(bodies[0]).toContain("readSubscriptionPaymentStatus");
    expect(bodies[0]).not.toContain("issueInvoice");
  });

  test("رموزُ الرفضِ تُقرأُ من الهجرةِ مُرتَّبةً بلا تكرارٍ", () => {
    expect(rejectionsFromSql(VALID_MIGRATION)).toEqual([
      "NOT_A_DRIVER",
      "TRANSACTION_NOT_FOUND",
      "USER_NOT_FOUND",
    ]);
  });

  test("خريطةُ الحالاتِ تُقرأُ من كتلتِها وحدَها", () => {
    expect(mappedStatusCodes(VALID_ROUTE)).toEqual([
      "NOT_A_DRIVER",
      "TRANSACTION_NOT_FOUND",
      "USER_NOT_FOUND",
    ]);
  });
});
