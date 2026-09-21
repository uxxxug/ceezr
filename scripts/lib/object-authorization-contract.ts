/**
 * الغرض: عقدُ **التفويضِ على مستوى الكائنِ** في البوّابةِ (`F8-08` — الضابطُ
 *   الأوّلُ من ستةَ عشرَ، وهوَ «أهمُّها» بنصِّ البندِ) قاعدةً ساكنةً لا مراجعةً
 *   بشريّةً.
 * الحالة: منطقٌ خالصٌ بلا قراءةِ قرصٍ ولا خروجٍ — `scripts/check-object-authorization.ts`
 *   هوَ مَن يقرأُ ويُخرِجُ.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-object-authorization.ts` · `tests/unit/check-object-authorization.test.ts`
 *
 * ## لِمَ حاجزٌ ساكنٌ لا مراجعةُ شيفرةٍ
 *
 * ثغرةُ المِلكِيَّةِ (`IDOR`) **لا تُسقِطُ اختباراً ولا تُبطئُ طلباً ولا تظهرُ في
 * سجلٍّ**: المُعالِجُ يعملُ ويُعيدُ ٢٠٠ وجسمُه صفٌّ لغيرِ سائلِه. فالمُعالِجُ الذي
 * يقرأُ معرِّفَ كائنٍ من المسارِ **ولا يحملُ معَه هويّةَ الناظرِ** إلى طبقةِ
 * التطبيقِ هوَ الشكلُ الذي يُسقِطُه هذا العقدُ — لأنَّ الشكلَ يُقاسُ آليّاً
 * والنيّةُ لا تُقاسُ.
 *
 * ## ولِمَ استثناءٌ مكتوبٌ لا صمتٌ
 *
 * ثلاثةُ أشكالٍ مشروعةٍ لا يحملُ مُعالِجُها رمزَ جلسةٍ: مسارُ لوحةِ الإدارةِ
 * (سلطتُه من وسيطِ جلسةٍ **خارجَ** المُعالِجِ)، ومسارٌ عامٌّ برمزٍ غيرِ قابلٍ
 * للتخمينِ (الرمزُ نفسُه هوَ التفويضُ)، ومسارُ خُطّافٍ موقَّعٍ (التوقيعُ هوَ
 * التفويضُ). فكلُّ واحدٍ من هذه **يُسمّى بسببِه في سجلٍّ مغلقٍ**، ويُطالَبُ في
 * موضعِه بدليلِ صنفِه. وسكوتٌ بلا سجلٍّ يُساوي في الأثرِ الثغرةَ: لا أحدَ يعرِفُ
 * أكانَ الغيابُ قراراً أم سهواً.
 */

/** ملفُّ مساراتٍ مقروءٌ من القرصِ: مسارُه ونصُّه. */
export interface RouteSource {
  readonly path: string;
  readonly source: string;
}

/** مُعالِجُ مسارٍ مُستخرَجٌ: ملفُّه وفعلُه وقالبُه وجسمُه بلا تعليقاتٍ. */
export interface RouteHandler {
  readonly file: string;
  readonly method: string;
  readonly template: string;
  readonly body: string;
}

/**
 * ما يُعَدُّ اشتقاقاً لهويّةِ الناظرِ. قائمةٌ **مغلقةٌ**: توسيعُها قرارٌ يُقرأُ في
 * فرقِ الشيفرةِ، لا نمطٌ فضفاضٌ يقبلُ أيَّ كلمةٍ فيها «auth».
 */
export const VIEWER_DERIVATIONS: readonly string[] = [
  "accessToken",
  "bearerTokenFrom(",
  "authenticate(",
  "auth.viewer",
] as const;

/**
 * أسماءُ معاملاتٍ **ممنوعةٌ في المسارِ**: هويّةٌ في العنوانِ تعني تفويضاً
 * بالادّعاءِ — يكتُبُ السائلُ معرِّفَ غيرِه فيصيرُ غيرَه. الهويّةُ تُشتَقُّ من
 * الرمزِ لا من العنوانِ.
 */
export const IDENTITY_PARAM_NAMES: readonly string[] = [
  "telegramUserId",
  "telegramId",
  "userId",
  "riderId",
  "driverId",
  "viewerId",
  "accountId",
  "ownerId",
] as const;

/** أصنافُ الاستثناءِ الثلاثةُ المشروعةُ، ولا رابعَ. */
export type ExemptionKind = "admin-guard" | "unguessable-token" | "signed-webhook";

export interface ObjectRouteExemption {
  readonly file: string;
  readonly method: string;
  readonly template: string;
  readonly kind: ExemptionKind;
  readonly reason: string;
}

/** أدنى طولٍ لسببٍ مكتوبٍ: كلمةٌ واحدةٌ ليست سبباً. */
export const MIN_EXEMPTION_REASON_LENGTH = 40;

/**
 * السجلُّ المغلقُ. كلُّ مسارٍ ههنا **لا يحملُ رمزَ جلسةٍ بقرارٍ**، ولكلٍّ صنفُه
 * ودليلُ صنفِه مطلوبٌ في موضعِه.
 */
export const OBJECT_ROUTE_EXEMPTIONS: readonly ObjectRouteExemption[] = [
  {
    file: "apps/gateway/src/routes/admin-ui.ts",
    method: "get",
    template: "/drivers/:id",
    kind: "admin-guard",
    reason:
      "سلطةُ لوحةِ الإدارةِ من وسيطِ جلسةِ إدارةٍ مُثبَّتٍ على الموجّهِ كلِّه (`createAdminGuard`)، لا من رمزِ ناظرٍ في المُعالِجِ؛ والمُعالِجُ لا يُصَلُ إلّا بعدَ الوسيطِ.",
  },
  {
    file: "apps/gateway/src/routes/admin-ui.ts",
    method: "post",
    template: "/broadcast/:batchId/cancel",
    kind: "admin-guard",
    reason:
      "دُفعةُ البثِّ كائنُ إدارةٍ لا كائنُ مستخدِمٍ: مالكُها المُشغِّلُ، وسلطتُه من وسيطِ جلسةِ الإدارةِ على الموجّهِ كلِّه لا من رمزٍ في المُعالِجِ.",
  },
  {
    file: "apps/gateway/src/routes/admin-ui.ts",
    method: "post",
    template: "/drivers/:id/verification",
    kind: "admin-guard",
    reason:
      "قرارُ التحقّقِ من السائقِ سلطةُ إدارةٍ بطبيعتِه: لا مالكَ لهُ غيرُ المُشغِّلِ، والوسيطُ على الموجّهِ كلِّه هوَ التفويضُ.",
  },
  {
    file: "apps/gateway/src/routes/admin-ui.ts",
    method: "post",
    template: "/users/:id/revoke-sessions",
    kind: "admin-guard",
    reason:
      "إبطالُ جلساتِ مستخدِمٍ سلطةُ إدارةٍ على غيرِ صاحبِ الجلسةِ، فلا يكونُ التفويضُ فيهِ مِلكِيَّةً — ولو اشتُرِطَت لَما قدِرَ مسؤولٌ على إبطالِ جلسةِ جهازٍ مسروقٍ. ومصدرُه وسيطُ جلسةِ الإدارةِ على الموجّهِ كلِّه، وصفةُ الفاعلِ تُحكَمُ ثانيةً في `admin_revoke_miniapp_sessions` وهيَ `security definer`.",
  },
  {
    file: "apps/gateway/src/routes/admin-ui.ts",
    method: "post",
    template: "/users/:id/blocked",
    kind: "admin-guard",
    reason:
      "الحجبُ سلطةُ إدارةٍ على مستخدِمٍ آخرَ، فلا يكونُ التفويضُ فيهِ مِلكِيَّةً؛ ومصدرُه وسيطُ جلسةِ الإدارةِ على الموجّهِ كلِّه.",
  },
  {
    file: "apps/gateway/src/routes/admin-ui.ts",
    method: "post",
    template: "/settings/:cityId/group-ids",
    kind: "admin-guard",
    reason:
      "إعداداتُ المدينةِ كائنُ تهيئةٍ لا كائنُ مستخدِمٍ، ومالكُها المُشغِّلُ؛ والسلطةُ من وسيطِ جلسةِ الإدارةِ على الموجّهِ كلِّه.",
  },
  {
    file: "apps/gateway/src/routes/admin-ui.ts",
    method: "post",
    template: "/settings/:cityId/:key",
    kind: "admin-guard",
    reason:
      "مفتاحُ إعدادٍ في مدينةٍ كائنُ تهيئةٍ لا كائنُ مستخدِمٍ، ومالكُه المُشغِّلُ؛ والسلطةُ من وسيطِ جلسةِ الإدارةِ على الموجّهِ كلِّه.",
  },
  {
    file: "apps/gateway/src/routes/public-tracking.ts",
    method: "get",
    template: "/api/track/:token/position",
    kind: "unguessable-token",
    reason:
      "الرمزُ نفسُه هوَ التفويضُ: يُصدِرُه المالكُ ليُشارَكَ معَ مَن لا جلسةَ لهُ، فيُتحقَّقُ من شكلِه ثمَّ يُبحَثُ عنهُ، والرفضُ واحدٌ للشكلِ والقيمةِ.",
  },
  {
    file: "apps/gateway/src/routes/public-tracking.ts",
    method: "get",
    template: "/track/:token",
    kind: "unguessable-token",
    reason:
      "صفحةُ التتبُّعِ نظيرُ نداءِ الموقعِ: الرمزُ هوَ التفويضُ، ولا جلسةَ لمَن يفتحُ الرابطَ أصلاً، فردُّ الشكلِ الخاطئِ ورَدُّ المعدومِ واحدٌ.",
  },
  {
    file: "apps/gateway/src/routes/telegram-webhook.ts",
    method: "post",
    template: "/webhook/telegram/:bot",
    kind: "signed-webhook",
    reason:
      "المعامِلُ اسمُ روبوتٍ من قائمةٍ مغلقةٍ لا معرِّفُ كائنِ مستخدِمٍ، والتفويضُ سرٌّ في ترويسةٍ يُقارَنُ قبلَ قراءةِ الجسمِ.",
  },
] as const;

/** دليلُ كلِّ صنفِ استثناءٍ: ما يجبُ أن يُرى في الملفِّ أو في المُعالِجِ. */
const EXEMPTION_EVIDENCE: Record<
  ExemptionKind,
  { readonly inFile: readonly string[]; readonly inHandler: readonly string[] }
> = {
  "admin-guard": { inFile: ["createAdminGuard(", 'app.use("*"'], inHandler: [] },
  "unguessable-token": { inFile: [], inHandler: ["TOKEN_PATTERN.test(", "MAX_TOKEN_LENGTH"] },
  "signed-webhook": { inFile: [], inHandler: ["secretsMatch("] },
};

export type ObjectAuthorizationRule =
  | "catalogue.non-empty"
  | "exemption.file-read"
  | "route.viewer-scoped"
  | "route.viewer-travels-with-object"
  | "param.not-identity"
  | "exemption.reason-written"
  | "exemption.route-exists"
  | "exemption.evidence-present";

export interface ObjectAuthorizationViolation {
  readonly rule: ObjectAuthorizationRule;
  readonly file: string;
  readonly subject: string;
  readonly detail: string;
}

/**
 * يُسقِطُ التعليقاتِ والنصوصَ الحرفيّةَ الطويلةَ؟ لا — **التعليقاتَ وحدَها**.
 * المحكومُ عليهِ ما يُنَفَّذُ لا ما يُشرَحُ: حاجزٌ يُثابُ على كلمةٍ في تعليقٍ
 * يُعلِّمُ المؤلِّفَ أن يكتُبَ الكلمةَ لا أن يكتُبَ الشيفرةَ، وحاجزٌ يعاقِبُ على
 * ذِكرِ العطبِ في تعليقٍ يُعلِّمُه كتمانَ السببِ.
 */
export function stripComments(source: string): string {
  let out = "";
  let index = 0;
  let mode: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (mode === "code") {
      if (two === "//") {
        mode = "line";
        index += 2;
        continue;
      }
      if (two === "/*") {
        mode = "block";
        index += 2;
        continue;
      }
      const ch = source[index] ?? "";
      if (ch === "'") mode = "single";
      else if (ch === '"') mode = "double";
      else if (ch === "`") mode = "template";
      out += ch;
      index += 1;
      continue;
    }
    if (mode === "line") {
      if (source[index] === "\n") {
        mode = "code";
        out += "\n";
      }
      index += 1;
      continue;
    }
    if (mode === "block") {
      if (two === "*/") {
        mode = "code";
        index += 2;
        continue;
      }
      if (source[index] === "\n") out += "\n";
      index += 1;
      continue;
    }
    // داخلَ نصٍّ حرفيٍّ: يُنسَخُ كما هوَ، والمهروبُ يُنسَخُ بحرفَيهِ.
    const ch = source[index] ?? "";
    out += ch;
    if (ch === "\\") {
      out += source[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (
      (mode === "single" && ch === "'") ||
      (mode === "double" && ch === '"') ||
      (mode === "template" && ch === "`")
    ) {
      mode = "code";
    }
    index += 1;
  }
  return out;
}

const ROUTE_DECLARATION = /app\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g;

/**
 * يستخرِجُ كلَّ مُعالِجٍ قالبُه يحملُ معامِلاً (`:`). وجسمُ المُعالِجِ يُقتَطعُ حتّى
 * إعلانِ المسارِ التالي في الملفِّ عينِه — قطعٌ **متحفِّظٌ**: يوسِّعُ الجسمَ ولا
 * يُضيِّقُه، فلا يُخفي غياباً.
 */
export function parseRouteHandlers(sources: readonly RouteSource[]): RouteHandler[] {
  const handlers: RouteHandler[] = [];
  for (const entry of sources) {
    const code = stripComments(entry.source);
    const declarations = [...code.matchAll(ROUTE_DECLARATION)];
    for (const [position, declaration] of declarations.entries()) {
      const template = declaration[2] ?? "";
      if (!template.includes(":")) continue;
      const start = declaration.index ?? 0;
      const end = declarations[position + 1]?.index ?? code.length;
      handlers.push({
        file: entry.path,
        method: declaration[1] ?? "",
        template,
        body: code.slice(start, end),
      });
    }
  }
  return handlers;
}

function paramNamesOf(template: string): string[] {
  return [...template.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1] ?? "");
}

/**
 * المنطقةُ المُحيطةُ بموضعٍ داخلَ أقربِ قوسٍ مُعقوفٍ مفتوحٍ يشمَلُه. تُستخدَمُ
 * لسؤالِ: أَسافرَت هويّةُ الناظرِ **في نفسِ الحُجَّةِ** التي سافرَ فيها معرِّفُ
 * الكائنِ؟ فمُعالِجٌ يقرأُ الرمزَ ثمَّ يُمرِّرُ المعرِّفَ وحدَه إلى المخزَنِ
 * يقرأُ صفَّ غيرِ سائلِه وهوَ «مُصادَقٌ».
 */
function enclosingObjectLiteral(code: string, position: number): string | undefined {
  let depth = 0;
  let open = -1;
  for (let index = position; index >= 0; index -= 1) {
    const ch = code[index];
    if (ch === "}") depth += 1;
    else if (ch === "{") {
      if (depth === 0) {
        open = index;
        break;
      }
      depth -= 1;
    }
  }
  if (open < 0) return undefined;
  let close = -1;
  let level = 0;
  for (let index = open; index < code.length; index += 1) {
    const ch = code[index];
    if (ch === "{") level += 1;
    else if (ch === "}") {
      level -= 1;
      if (level === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) return undefined;
  return code.slice(open, close + 1);
}

function hasViewerDerivation(text: string): boolean {
  return VIEWER_DERIVATIONS.some((marker) => text.includes(marker));
}

function exemptionFor(handler: RouteHandler): ObjectRouteExemption | undefined {
  return OBJECT_ROUTE_EXEMPTIONS.find(
    (entry) =>
      entry.file === handler.file &&
      entry.method === handler.method &&
      entry.template === handler.template,
  );
}

/**
 * الحكمُ. لا قراءةَ قرصٍ ههنا: المصادرُ تُمَرَّرُ، فتُقاسُ القواعدُ في اختبارٍ
 * بسالباتٍ مبذورةٍ لكلِّ واحدةٍ (`ح-7`).
 */
export interface ObjectAuthorizationOptions {
  /**
   * `true` متى كانَت المصادرُ **شجرةَ الموجّهاتِ كاملةً** كما يقرأُها الحاجزُ من
   * القرصِ. وحينَها يُسألُ سؤالٌ لا يصحُّ على مصادرَ جزئيّةٍ: أَبقيَ كلُّ ملفٍّ
   * لهُ استثناءٌ مسجَّلٌ؟ — إذ حذفُ الملفِّ كلِّه يُخفي الاستثناءَ الميّتَ.
   */
  readonly completeTree?: boolean;
}

export function objectAuthorizationViolations(
  sources: readonly RouteSource[],
  options: ObjectAuthorizationOptions = {},
): ObjectAuthorizationViolation[] {
  const violations: ObjectAuthorizationViolation[] = [];
  const handlers = parseRouteHandlers(sources);

  if (handlers.length === 0) {
    violations.push({
      rule: "catalogue.non-empty",
      file: "apps/gateway/src/routes",
      subject: "الجردُ",
      detail:
        "لا مسارَ واحداً بمعامِلٍ قُرِئَ. حاجزٌ يمرُّ على جردٍ فارغٍ حاجزٌ أعمى: العطبُ في القراءةِ لا في الشيفرةِ.",
    });
  }

  for (const handler of handlers) {
    const subject = `${handler.method.toUpperCase()} ${handler.template}`;
    const exemption = exemptionFor(handler);

    for (const name of paramNamesOf(handler.template)) {
      if (IDENTITY_PARAM_NAMES.includes(name)) {
        violations.push({
          rule: "param.not-identity",
          file: handler.file,
          subject,
          detail: `المعامِلُ \`:${name}\` هويّةُ ناظرٍ في العنوانِ. مَن يكتُبُ الهويّةَ يُفوِّضُ نفسَه؛ الهويّةُ تُشتَقُّ من الرمزِ لا من المسارِ.`,
        });
      }
    }

    if (exemption === undefined) {
      if (!hasViewerDerivation(handler.body)) {
        violations.push({
          rule: "route.viewer-scoped",
          file: handler.file,
          subject,
          detail: `مسارٌ يقرأُ معرِّفَ كائنٍ ولا يشتقُّ هويّةَ ناظرٍ (${VIEWER_DERIVATIONS.join(" أو ")}). إمّا يُمرَّرَ الناظرُ، أو يُسجَّلَ استثناءٌ بصنفِه وسببِه في \`OBJECT_ROUTE_EXEMPTIONS\`.`,
        });
        continue;
      }
      for (const match of handler.body.matchAll(/c\.req\.param\(/g)) {
        const literal = enclosingObjectLiteral(handler.body, match.index ?? 0);
        if (literal === undefined) continue;
        if (!hasViewerDerivation(literal)) {
          violations.push({
            rule: "route.viewer-travels-with-object",
            file: handler.file,
            subject,
            detail:
              "معرِّفُ الكائنِ يُمرَّرُ في حُجَّةٍ لا هويّةَ ناظرٍ فيها. مُصادَقةٌ عندَ البابِ ثمَّ قراءةٌ بالمعرِّفِ وحدَه تُعيدُ صفَّ غيرِ سائلِه بردٍّ ٢٠٠.",
          });
          break;
        }
      }
      continue;
    }

    if (exemption.reason.trim().length < MIN_EXEMPTION_REASON_LENGTH) {
      violations.push({
        rule: "exemption.reason-written",
        file: handler.file,
        subject,
        detail: `سببُ الاستثناءِ أقصرُ من ${String(MIN_EXEMPTION_REASON_LENGTH)} حرفاً. استثناءٌ بلا سببٍ مكتوبٍ يُقرأُ سهواً بعدَ شهرٍ.`,
      });
    }

    const evidence = EXEMPTION_EVIDENCE[exemption.kind];
    const fileSource = sources.find((entry) => entry.path === handler.file)?.source ?? "";
    const fileCode = stripComments(fileSource);
    for (const marker of evidence.inFile) {
      if (!fileCode.includes(marker)) {
        violations.push({
          rule: "exemption.evidence-present",
          file: handler.file,
          subject,
          detail: `استثناءُ صنفِ \`${exemption.kind}\` يشترِطُ \`${marker}\` في الملفِّ، ولا وجودَ لهُ. زالَ الدليلُ فزالَ الاستثناءُ.`,
        });
      }
    }
    for (const marker of evidence.inHandler) {
      if (!handler.body.includes(marker)) {
        violations.push({
          rule: "exemption.evidence-present",
          file: handler.file,
          subject,
          detail: `استثناءُ صنفِ \`${exemption.kind}\` يشترِطُ \`${marker}\` في المُعالِجِ، ولا وجودَ لهُ. زالَ الدليلُ فزالَ الاستثناءُ.`,
        });
      }
    }
  }

  // **يُحاكَمُ الاستثناءُ في ملفِّه وحدَه**: ملفٌّ لم يُقرأْ لا يُحكَمُ على ما فيهِ.
  // وإلّا صارَ الحاجزُ يشكو زوالَ مسارٍ لمجرَّدِ أنَّ القارئَ سألَ عن موجّهٍ واحدٍ.
  const readFiles = new Set(sources.map((entry) => entry.path));
  for (const exemption of OBJECT_ROUTE_EXEMPTIONS) {
    if (!readFiles.has(exemption.file)) {
      if (options.completeTree === true) {
        violations.push({
          rule: "exemption.file-read",
          file: exemption.file,
          subject: `${exemption.method.toUpperCase()} ${exemption.template}`,
          detail:
            "ملفُّ موجّهٍ لهُ استثناءٌ مسجَّلٌ لم يُقرأْ من الشجرةِ. حذفُ الملفِّ يُخفي الاستثناءَ الميّتَ، فيعودُ المسارُ غداً بالاسمِ نفسِه مستثنىً بلا قرارٍ.",
        });
      }
      continue;
    }
    const present = handlers.some(
      (handler) =>
        handler.file === exemption.file &&
        handler.method === exemption.method &&
        handler.template === exemption.template,
    );
    if (!present) {
      violations.push({
        rule: "exemption.route-exists",
        file: exemption.file,
        subject: `${exemption.method.toUpperCase()} ${exemption.template}`,
        detail:
          "استثناءٌ مسجَّلٌ لمسارٍ لا وجودَ لهُ. الاستثناءُ الميّتُ يُغطّي مساراً يُكتَبُ غداً بالاسمِ نفسِه بلا قرارٍ.",
      });
    }
  }

  return violations;
}

export function describeObjectAuthorizationViolation(
  violation: ObjectAuthorizationViolation,
): string {
  return `[${violation.rule}] ${violation.file} · ${violation.subject}: ${violation.detail}`;
}
