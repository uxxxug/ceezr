/**
 * الغرض: قواعدُ عقدِ الفاتورةِ الضريبيّةِ المبسَّطةِ — أحكامٌ نقيّةٌ تُقاسُ بمدخلاتٍ
 *   مصنوعةٍ (`F3-09` · `SD-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-tax-invoice-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: المرحلةُ الثانيةُ من الفَوترةِ الإلكترونيّةِ إن جاءَت —
 *   **تُزادُ قواعدُ ولا تُخفَّفُ هذه**: ختمُ `CSID` وإبلاغُ الأربعِ والعشرينَ ساعةً
 *   يزيدانِ التزاماً ولا يُلغيانِ واحداً.
 * يحرسُه: هو نفسُه حاجزٌ — وسالباتُه المزروعةُ في
 *   `tests/unit/check-tax-invoice-contract.test.ts` (`ح-7`).
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ## لماذا حاجزٌ خاصٌّ لوثيقةٍ ضريبيّةٍ
 *
 * لأنَّ الفاتورةَ **وثيقةٌ يحتجُّ بها على الدولةِ وعلى السائقِ معاً**، وخطؤها لا
 * يُقاسُ بتجربةٍ سيّئةٍ بل بمُخالفةٍ. والأخطرُ أنَّ كلَّ صنفٍ من عطبِها **صامتٌ
 * أمامَ المُصرِّفِ والاختبارِ**: عمودُ `card_number` يُصرَّفُ، و`update
 * subscription_invoices` يُصرَّفُ، ومسارُ `GET` الذي يُصدِرُ فاتورةً يُصرَّفُ ويمرُّ
 * أخضرَ — ولا يُكشَفُ إلّا حينَ يُدقَّقُ علينا أو يُعادُ زحفُ محرِّكِ بحثٍ على
 * مسارِ `GET` **فيُصدِرَ فواتيرَ لا يريدُها أحدٌ**.
 *
 * ## القواعدُ الثمانُ ولِمَ كلٌّ منها
 *
 *   ١. **لا مُفرداتِ بطاقةٍ عندَنا**: لا `pan` ولا `card_number` ولا `cvv` ولا
 *      `cvc` ولا `expiry_month` ولا `cardholder` ولا `track2` عموداً أو حقلاً أو
 *      مفتاحاً في نطاقِ الفاتورةِ. ونحنُ **لا نملكُ رخصةَ حملِ بياناتِ بطاقةٍ**،
 *      فأوّلُ عمودٍ منها يجعلُ نطاقَ `PCI DSS` كلَّه علينا بسطرٍ واحدٍ.
 *   ٢. **لا تحديثَ ولا حذفَ على `subscription_invoices`**: فاتورةٌ صُدِرَت لا تُعدَّلُ —
 *      تُلغى بوثيقةٍ مقابلةٍ. والقاعدةُ تُحرِّمُهما بمُحفِّزٍ، وهذا الحاجزُ
 *      يمنعُ أن يُكتَبَ نصُّ التحديثِ أصلاً فيُصطَدمَ به في الإنتاجِ.
 *   ٣. **لا إصدارَ في مسارِ `GET`**: الإصدارُ يُنشِئُ رقماً تسلسليّاً لا رجعةَ
 *      فيه؛ ومسارُ `GET` يُعادُ نداؤه بزحفٍ وبإعادةِ محاولةٍ تلقائيّةٍ. فالحدُّ
 *      عقديٌّ لا نيّةٌ.
 *   ٤. **تكافؤُ اتّحادِ الرفضِ**: كلُّ رمزٍ تُعيدُه دوالُّ القاعدةِ حاضرٌ في
 *      `TAX_INVOICE_STORE_REJECTIONS` وبالعكسِ. ورمزٌ في القاعدةِ بلا مقابلٍ في
 *      الاتّحادِ يُقرأُ في المخزنِ `STORE_ERROR` — أي «عطبٌ عندَنا» في حينَ أنَّه
 *      **حكمٌ مفهومٌ كانَ يجبُ أن يُقالَ للسائقِ**. واستثناءٌ واحدٌ مُعلَنٌ: رمزُ
 *      الكاتبِ الداخليِّ (`WRITER_INTERNAL_REJECTIONS`) يُعفى **بشرطٍ مقيسٍ** أن
 *      تكونَ في الهجرةِ نفسِها ذراعُ ترجمةٍ له (`when '<code>'`) — فالإعفاءُ
 *      **مشروطٌ بدليلٍ** لا بنيّةٍ، ورمزٌ لا يُترجَمُ ولا يُعلَنُ يبقى عطباً.
 *   ٥. **شمولُ خريطةِ الحالاتِ**: لكلِّ رمزٍ عامٍّ حالةُ `HTTP` مُعلَنةٌ. ورمزٌ
 *      بلا حالةٍ يخرجُ `500` — فيُقرأُ «خادمٌ معطوبٌ» في حينَ أنَّ الحقيقةَ
 *      «هويّةٌ ضريبيّةٌ غيرُ مُهيَّأةٍ».
 *   ٦. **الضريبةُ مستخرَجةٌ من مبلغٍ شاملٍ**: يجبُ أن تكونَ القسمةُ على
 *      `10000 + v_rate_bps`. ولو كُتِبَت `/ 10000` لكانَت الضريبةُ **مُضافةً**
 *      على مبلغٍ قُبِضَ شاملاً — فتُخالِفُ الفاتورةُ ما في `payment_transactions`
 *      وما رآهُ السائقُ في `F3-06`، ويُدفَعُ فرقٌ من جيبٍ لا يعلمُ به.
 *   ٧. **لا هويّةَ ضريبيّةً مزروعةً**: لا هجرةَ تُدخِلُ قيمةً لـ
 *      `tax_seller_vat_number`. ورقمٌ ضريبيٌّ مُختَرَعٌ في بذرةٍ **أسوأُ من غيابِه**:
 *      الغيابُ يُسقِطُ الإصدارَ `503` مُعلَناً، والاختراعُ يُصدِرُ فواتيرَ باطلةً
 *      عليها رقمٌ لا يملكُه أحدٌ.
 *   ٨. **لا معرِّفَ مزوِّدٍ في جسمٍ عامٍّ**: لا `providerTransactionId` ولا
 *      `provider_transaction_id` في جسمِ جوابٍ يُرسَلُ إلى التطبيقِ. مُعرِّفُ
 *      المزوِّدِ مِفتاحُ تظلُّمٍ في لوحتِه، وليسَ من حقِّ الواجهةِ.
 *   ٩. **لا حالَ سدادٍ مقيسٌ في سطحٍ**: مِلفّاتُ سطحِ التطبيقِ المُصغَّرِ لا تحملُ
 *      اسمَ حالٍ من حالاتِ `payment_transactions` (`active` · `refunded` ·
 *      `paid` · `pending` …) لِتُقرِّرَ به أيُعرَضُ زرُّ إصدارٍ. فالمحدِّدُ دالّةٌ
 *      في القاعدةِ ورايةُ `invoice_issuable` تصلُ في الجوابِ. **وهذه القاعدةُ
 *      وُلِدَت من عطبٍ حقيقيٍّ**: كُتِبَ السطحُ أوّلاً يقيسُ `status === "paid"` —
 *      وهوَ حالٌ **لا وجودَ له في قيدِ الجدولِ** — فكانَ الزرُّ لا يظهرُ أبداً،
 *      واختبارُ وحدةٍ يبذُرُ ما تكتبُه يدُه لا يكشفُ ذلكَ.
 *  ١٠. **لا ترميزَ ولا تفكيكَ لِحِمْلِ رمزِ الاستجابةِ في سطحٍ**: لا `btoa` ولا
 *      `atob` ولا `TextEncoder` ولا `Buffer.from` — والحِمْلُ يُنقَلُ كما خزنَتْهُ
 *      القاعدةُ. ومُرمِّزٌ ثانٍ في العميلِ يُمكِنُ أن يُخالِفَ الأصلَ بلا أن يُقاسَ.
 *  ١١. **تكافؤُ نصوصِ الأعطابِ في اللغاتِ الثلاثِ**: لكلِّ رمزٍ عامٍّ مفتاحُ نصٍّ
 *      في `ar` و`en` و`ur`، و`UNKNOWN` معَها. ورمزٌ يصلُ السائقَ بلا نصٍّ يُعرَضُ
 *      اسمَه الإنجليزيَّ الخامَ — وذاكَ عطبُ عرضٍ يُخفي حكماً مفهوماً.
 *  ١٢. **لا حسابَ ضريبةٍ في سطحٍ**: لا `1500` ولا `0.15` ولا `1.15` ولا
 *      `10000 +` في مِلفّاتِ السطحِ. الأرقامُ من الوثيقةِ، والمسموحُ **تحويلُ
 *      وحدةٍ** (نقاطُ أساسٍ ⇒ نسبةٌ مئويّةٌ بقسمةٍ على مئةٍ) لا اشتقاقُ رقمٍ.
 *
 * ## وما لا يفعلُه هذا الحاجزُ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يُصرِّحُ بامتثالٍ للمرحلةِ الثانيةِ**: لا يقيسُ `UBL 2.1` ولا ختمَ
 *      `CSID` ولا إبلاغاً في أربعٍ وعشرينَ ساعةً، لأنَّ شيئاً من ذلكَ **لم
 *      يُبنَ**. وهذه المرحلةُ الأولى: وثيقةٌ مبسَّطةٌ ورمزٌ مقروءٌ.
 *   ــ **لا يُشغِّلُ قاعدةً ولا يفتحُ رمزاً**: يقرأُ نصوصاً. وصحّةُ `TLV` تُقاسُ
 *      في `tests/integration` بمُفكِّكٍ مستقلٍّ.
 *   ــ **لا يحكمُ في نسبةِ الضريبةِ**: النسبةُ من `platform_settings` وقد تتغيّرُ
 *      بقرارٍ سياديٍّ؛ الحاجزُ يفرضُ **طريقةَ الاستخراجِ** لا الرقمَ.
 *   ــ **لا يمنعُ `truncate`**: تفريغُ جدولٍ في تهيئةِ اختبارٍ ليسَ تعديلَ وثيقةٍ،
 *      وزنادُ الصفِّ لا يراهُ أصلاً. والمقيسُ ههنا نصُّ `update`/`delete from`.
 *
 * ## زيادةٌ بعدَ حلِّ تعارضٍ — (`ح-8`)
 *
 * كُتِبَ رأسُ هذا المِلفِّ أوّلاً على جدولٍ اسمُه `tax_invoices`، ثمَّ وُجِدَ في
 * المستودعِ سجلُّ فواتيرٍ قائمٌ (`subscription_invoices` منذُ `20260813010000`)
 * فحُذِفَ الجدولُ الثاني قبلَ دفعِه وامتدَّ القائمُ. **والنصُّ السابقُ لم يُمحَ بل
 * صُحِّحَ اسمُه في موضعِه**، وهذه الفقرةُ سجلُّ التصحيحِ.
 */

/** مُفرداتُ بياناتِ البطاقةِ المُحرَّمةُ عندَنا — القاعدةُ ١. */
export const CARD_DATA_VOCABULARY: readonly string[] = [
  "card_number",
  "cardnumber",
  "cardholder",
  "card_holder",
  "cvv",
  "cvc",
  "expiry_month",
  "expiry_year",
  "expirymonth",
  "track2",
  "primary_account_number",
];

/** الاتّحادُ المُعلَنُ في طبقةِ التطبيقِ — يُمرَّرُ لا يُنسَخُ. */
export interface TaxInvoiceContractInput {
  /** نصُّ هجرةِ الفاتورةِ. */
  readonly invoiceMigration: string;
  /** كلُّ الهجراتِ بمساراتِها — للقاعدتَينِ ٢ و٧. */
  readonly allMigrations: Readonly<Record<string, string>>;
  /** مِلفّاتُ نطاقِ الفاتورةِ في `packages` و`apps` بمساراتِها. */
  readonly scopeFiles: Readonly<Record<string, string>>;
  /** نصُّ مِلفِّ الموجِّهِ وحدَه — للقاعدتَينِ ٣ و٥ و٨. */
  readonly routeFile: string;
  /** اتّحادُ الرفضِ كما هوَ في طبقةِ التطبيقِ. */
  readonly storeRejections: readonly string[];
  /** الرموزُ العامّةُ كما هيَ في طبقةِ التطبيقِ. */
  readonly publicErrorCodes: readonly string[];
  /** مِلفّاتُ سطحِ التطبيقِ المُصغَّرِ بمساراتِها — للقواعدِ ٩ و١٠ و١٢. */
  readonly surfaceFiles: Readonly<Record<string, string>>;
  /** نصوصُ الترجمةِ بلغاتِها — للقاعدةِ ١١. */
  readonly i18nFiles: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * حالاتُ `payment_transactions` كما هيَ في قيدِ الجدولِ. **تُقاسُ لِتُمنَعَ في
 * السطحِ** لا لِتُنسَخَ فيه: وجودُ أحدِها في مِلفِّ سطحٍ دليلُ محدِّدٍ منسوخٍ.
 * و`paid` مذكورٌ ههنا **وهوَ لا وجودَ له في القيدِ** — لأنَّ السطحَ كُتِبَ أوّلاً
 * يقيسُه، فمنعُه صريحاً يمنعُ عودةَ العطبِ عينِه.
 */
const PAYMENT_STATUS_VOCABULARY: readonly string[] = [
  "active",
  "refunded",
  "paid",
  "pending",
  "past_due",
  "canceled",
  "expired",
  "failed",
];

/** بادئةُ مفاتيحِ نصوصِ أعطابِ الفاتورةِ — موضعٌ واحدٌ يُبنى منه المفتاحُ. */
const INVOICE_ERROR_KEY_PREFIX = "driver.subscription.invoice.error.";

/** مُفرداتُ ترميزٍ مُحرَّمةٌ في السطحِ — القاعدةُ ١٠. */
const CODEC_VOCABULARY: readonly string[] = [
  "btoa(",
  "atob(",
  "TextEncoder",
  "TextDecoder",
  "Buffer.from",
];

/** أرقامُ ضريبةٍ مُحرَّمةٌ نصّاً في السطحِ — القاعدةُ ١٢. */
const HARDCODED_VAT_LITERALS: readonly string[] = ["1500", "0.15", "1.15", "10000 +"];

/** اسمُ الدالّةِ التي تُصدِرُ — الإصدارُ فعلٌ واحدٌ في موضعٍ واحدٍ. */
const ISSUING_FUNCTION = "issue_subscription_tax_invoice";

/** سجلُّ الفواتيرِ — **القائمُ في المستودعِ لا جدولٌ ثانٍ** (القاعدةُ ٢). */
export const INVOICE_TABLE = "subscription_invoices";

/**
 * رموزُ الكاتبِ الداخليِّ التي **لا تصلُ إلى المخزنِ** لأنَّ مُغلِّفَ المِلكيّةِ
 * يُترجِمُها في القاعدةِ نفسِها. والإعفاءُ من تكافؤِ القاعدةِ ٤ **مشروطٌ** بوجودِ
 * ذراعِ الترجمةِ نصّاً في الهجرةِ.
 */
export const WRITER_INTERNAL_REJECTIONS: readonly string[] = [
  "CONFIRMED_SUBSCRIPTION_PAYMENT_REQUIRED",
];

/** حروفُ الحدِّ لكلمةٍ في نصٍّ برمجيٍّ. */
function containsWord(haystack: string, word: string): boolean {
  const pattern = new RegExp(`(^|[^0-9A-Za-z_])${word}([^0-9A-Za-z_]|$)`, "i");
  return pattern.test(haystack);
}

/** يقتطعُ أجسامَ مُعالِجاتِ `GET` من نصِّ الموجِّهِ — القاعدةُ ٣. */
export function getHandlerBodies(routeSource: string): readonly string[] {
  const bodies: string[] = [];
  const opener = /\.get\(/g;
  let match = opener.exec(routeSource);
  while (match !== null) {
    let depth = 0;
    let index = match.index + match[0].length - 1;
    const start = index;
    for (; index < routeSource.length; index += 1) {
      const character = routeSource[index];
      if (character === "(") depth += 1;
      else if (character === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push(routeSource.slice(start, index + 1));
    opener.lastIndex = index + 1;
    match = opener.exec(routeSource);
  }
  return bodies;
}

/** رموزُ الرفضِ كما تُعيدُها دوالُّ الهجرةِ فعلاً — القاعدةُ ٤. */
export function rejectionsFromSql(sql: string): readonly string[] {
  const found = new Set<string>();
  const pattern = /'error',\s*'([A-Z_]+)'/g;
  let match = pattern.exec(sql);
  while (match !== null) {
    const code = match[1];
    if (code !== undefined) found.add(code);
    match = pattern.exec(sql);
  }
  return [...found].sort();
}

/** الرموزُ المُخرَّطةُ في `STATUS_BY_ERROR` — القاعدةُ ٥. */
export function mappedStatusCodes(routeSource: string): readonly string[] {
  const block = /STATUS_BY_ERROR[^{]*\{([\s\S]*?)\n\}/.exec(routeSource);
  if (block === null) return [];
  const body = block[1] ?? "";
  const found = new Set<string>();
  const pattern = /([A-Z_]{3,}):\s*\d{3}/g;
  let match = pattern.exec(body);
  while (match !== null) {
    const code = match[1];
    if (code !== undefined) found.add(code);
    match = pattern.exec(body);
  }
  return [...found].sort();
}

export function taxInvoiceContractProblems(input: TaxInvoiceContractInput): readonly string[] {
  const problems: string[] = [];

  // ١ — لا مُفرداتِ بطاقةٍ في نطاقِ الفاتورةِ.
  const cardScope: Record<string, string> = {
    "supabase/migrations (فاتورة)": input.invoiceMigration,
    ...input.scopeFiles,
  };
  for (const [path, source] of Object.entries(cardScope)) {
    for (const word of CARD_DATA_VOCABULARY) {
      if (containsWord(source, word)) {
        problems.push(`[بطاقة] ${path}: مُفردةُ بياناتِ بطاقةٍ «${word}» — ولا رخصةَ لنا بحملِها.`);
      }
    }
  }

  // ٢ — لا تحديثَ ولا حذفَ على سجلِّ الفواتيرِ في أيِّ هجرةٍ أو مِلفٍّ.
  const mutationScope: Record<string, string> = {
    ...input.allMigrations,
    ...input.scopeFiles,
  };
  for (const [path, source] of Object.entries(mutationScope)) {
    if (new RegExp(`update\\s+${INVOICE_TABLE}`, "i").test(source)) {
      problems.push(`[خلود] ${path}: «update ${INVOICE_TABLE}» — فاتورةٌ صُدِرَت لا تُعدَّلُ.`);
    }
    if (new RegExp(`delete\\s+from\\s+${INVOICE_TABLE}`, "i").test(source)) {
      problems.push(
        `[خلود] ${path}: «delete from ${INVOICE_TABLE}» — الإلغاءُ بوثيقةٍ مقابلةٍ لا بمحوٍ.`,
      );
    }
  }

  // ٣ — لا إصدارَ في مسارِ `GET`.
  const getBodies = getHandlerBodies(input.routeFile);
  if (getBodies.length === 0) {
    problems.push("[قراءة] الموجِّه: لا مُعالِجَ `GET` مقروءاً — فالقاعدةُ الثالثةُ غيرُ مقيسةٍ.");
  }
  for (const body of getBodies) {
    if (body.includes(ISSUING_FUNCTION) || /\bissueInvoice\b/.test(body)) {
      problems.push("[قراءة] الموجِّه: مُعالِجُ `GET` يُصدِرُ فاتورةً — والزحفُ يُصدِرُ ما لا يُريدُه أحدٌ.");
    }
  }

  // ٤ — تكافؤُ اتّحادِ الرفضِ.
  const sqlRejections = rejectionsFromSql(input.invoiceMigration);
  const declared = new Set(input.storeRejections);
  for (const code of sqlRejections) {
    if (declared.has(code)) continue;
    if (
      WRITER_INTERNAL_REJECTIONS.includes(code) &&
      new RegExp(`when\\s+'${code}'`).test(input.invoiceMigration)
    ) {
      continue;
    }
    problems.push(`[تكافؤ] «${code}» تُعيدُه القاعدةُ وليسَ في «TAX_INVOICE_STORE_REJECTIONS».`);
  }
  const inSql = new Set(sqlRejections);
  for (const code of input.storeRejections) {
    if (!inSql.has(code)) {
      problems.push(`[تكافؤ] «${code}» مُعلَنٌ في الاتّحادِ ولا تُعيدُه دالّةٌ — إمّا يُحذَفُ أو يُصدَرُ.`);
    }
  }

  // ٥ — شمولُ خريطةِ الحالاتِ.
  const mapped = new Set(mappedStatusCodes(input.routeFile));
  for (const code of input.publicErrorCodes) {
    if (!mapped.has(code)) {
      problems.push(`[حالة] «${code}» بلا حالةِ HTTP في «STATUS_BY_ERROR» — فيخرجُ 500 كاذباً.`);
    }
  }

  // ٦ — الضريبةُ مستخرَجةٌ من مبلغٍ شاملٍ.
  if (!/\(\s*10000\s*\+\s*v_rate_bps\s*\)/.test(input.invoiceMigration)) {
    problems.push(
      "[شمول] الهجرة: لا قسمةَ على «(10000 + v_rate_bps)» — والسعرُ شاملٌ للضريبةِ، " +
        "فقسمةٌ على 10000 وحدَها تُضيفُ ضريبةً على مبلغٍ قُبِضَ شاملاً.",
    );
  }

  // ٧ — لا هويّةَ ضريبيّةً مزروعةً.
  for (const [path, source] of Object.entries(input.allMigrations)) {
    if (/insert[\s\S]{0,4000}?'tax_seller_vat_number'/i.test(source)) {
      problems.push(
        `[هويّة] ${path}: بذرةٌ لـ«tax_seller_vat_number» — ورقمٌ مُختَرَعٌ أسوأُ من غيابٍ يُعلَنُ.`,
      );
    }
  }

  // ٨ — لا معرِّفَ مزوِّدٍ في جسمٍ عامٍّ.
  if (
    /provider[_T]ransaction[_I]?d|providerTransactionId|provider_transaction_id/.test(
      input.routeFile,
    )
  ) {
    problems.push("[كتمان] الموجِّه: معرِّفُ المزوِّدِ في جسمٍ عامٍّ — وهوَ مِفتاحُ تظلُّمٍ لا حقُّ واجهةٍ.");
  }

  // ٩ — لا حالَ سدادٍ مقيسٌ في سطحٍ.
  //
  // **المقيسُ سطرٌ يجمعُ كلمةَ `status` وحرفيّةَ حالٍ**: أسماءُ حالاتِ لوحٍ
  // (`kind: "failed"`) ليسَت محدِّدَ سدادٍ، والمنسوخُ يُعرَفُ باقترانِه بالحقلِ.
  for (const [path, source] of Object.entries(input.surfaceFiles)) {
    for (const [index, line] of source.split("\n").entries()) {
      if (!/status/i.test(line)) continue;
      for (const status of PAYMENT_STATUS_VOCABULARY) {
        if (new RegExp(`["'\`]${status}["'\`]`).test(line)) {
          problems.push(
            `[سطح] ${path}:${String(index + 1)}: اسمُ الحالِ «${status}» مقروناً بحقلِ الحالِ — ` +
              "والمحدِّدُ دالّةٌ في القاعدةِ ورايةُ «invoice_issuable» تصلُ في الجوابِ، " +
              "فلا يُنسَخُ محدِّدُ عملٍ في عميلٍ.",
          );
        }
      }
    }
  }

  // ١٠ — لا ترميزَ ولا تفكيكَ لِحِمْلِ رمزِ الاستجابةِ في سطحٍ.
  for (const [path, source] of Object.entries(input.surfaceFiles)) {
    for (const token of CODEC_VOCABULARY) {
      if (source.includes(token)) {
        problems.push(
          `[سطح] ${path}: «${token}» — والحِمْلُ يُنقَلُ كما خزنَتْهُ القاعدةُ، ` +
            "ومُرمِّزٌ ثانٍ في العميلِ يُخالِفُ الأصلَ بلا أن يُقاسَ.",
        );
      }
    }
  }

  // ١١ — تكافؤُ نصوصِ الأعطابِ في اللغاتِ الثلاثِ.
  for (const [lang, texts] of Object.entries(input.i18nFiles)) {
    for (const code of [...input.publicErrorCodes, "UNKNOWN"]) {
      if (texts[`${INVOICE_ERROR_KEY_PREFIX}${code}`] === undefined) {
        problems.push(
          `[نص] ${lang}: لا نصَّ لـ«${code}» — فيُعرَضُ للسائقِ اسمُه الخامُ ` +
            "ويُخفي حكماً مفهوماً كانَ يجبُ أن يُقالَ.",
        );
      }
    }
  }

  // ١٢ — لا حسابَ ضريبةٍ في سطحٍ.
  for (const [path, source] of Object.entries(input.surfaceFiles)) {
    for (const literal of HARDCODED_VAT_LITERALS) {
      if (source.includes(literal)) {
        problems.push(
          `[سطح] ${path}: الرقمُ «${literal}» نصّاً — والضريبةُ ونسبتُها من الوثيقةِ، ` +
            "ورقمٌ منسوخٌ يُخالِفُ وثيقةً صدرَت بنسبةٍ أخرى.",
        );
      }
    }
  }

  return problems;
}
