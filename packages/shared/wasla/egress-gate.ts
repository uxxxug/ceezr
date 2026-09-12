/**
 * الغرض: بوّابةُ الصادرِ **وقتَ التشغيلِ** — البندُ `W-6` · القرارُ `ADR 0086`.
 *
 * ولِمَ بوّابةٌ بعدَ حاجزٍ: الزيادةُ الأولى من `W-6` (`ADR 0084`) أعلنَت على نفسِها
 * حدّاً صريحاً: «لا منعَ للصادرِ وقتَ التشغيلِ؛ الحاجزُ يُخفِقُ وقتَ البناءِ». وحاجزُ
 * البناءِ يقرأُ نصَّ الشيفرةِ، ولا يقفُ بينَ العمليّةِ والشبكةِ. فثلاثةُ أبوابٍ تبقى
 * مفتوحةً بعدَه: عنوانٌ يُركَّبُ من قطعٍ وقتَ التشغيلِ فلا يراهُ مسحٌ نصّيٌّ، وعميلٌ
 * مُعلَنٌ لمقصدٍ يُوجَّهُ إلى مضيفِ مقصدٍ آخرَ، ومفتاحُ بيئةٍ يُضبَطُ على مضيفٍ
 * يملكُه مقصدٌ غيرُ صاحبِ المفتاحِ. وهذه البوّابةُ تُغلِقُ الثلاثةَ **بالرفضِ**، لا
 * بالتحذيرِ ولا بالتسجيلِ.
 *
 * والمنطقُ **مقلوبٌ عن قائمةِ المنعِ**، كما في `ADR 0084`: السؤالُ ليسَ «هل هذا
 * المضيفُ ممنوعٌ؟» بل «هل هذا المضيفُ **مُعلَنٌ لهذا المقصدِ بعينِه**؟». فالنداءُ
 * يُرفَضُ افتراضاً (`fail closed`)، ولا يُسمَحُ إلّا بما يُقاسُ إعلانُه.
 *
 * وحدٌّ مُعلَنٌ لا مسكوتٌ عنه: **نطاقُ MARKET غيرُ معروفٍ لهذا المستودعِ**
 * (`DEP-CORE-005`)، فالبوّابةُ لا تُطابِقُ اسمَ نطاقٍ ولا تدّعي تمييزَ MARKET من
 * غيرِه. تُنفِذُ الإعلانَ وحدَه: مقصدٌ غيرُ مُعلَنٍ يُرفَضُ أيّاً كانَ اسمُه، وصنفُ
 * `system: "MARKET"` مرفوضٌ نصّاً ههنا أيضاً كي يكونَ الرفضُ **مقيساً في الطبقتَينِ**
 * لا في طبقةِ البناءِ وحدَها.
 *
 * ومصدرُ الحقيقةِ واحدٌ: `packages/shared/wasla/egress-registry.ts` نفسُه الذي
 * يقرؤُه حاجزُ البناءِ. ولا تُنسَخُ ههنا قائمةُ مضيفاتٍ ألبتّةَ.
 *
 * **الموضعُ، مقيساً لا مُفترَضاً:** كانَ المحجوزُ `packages/infrastructure/egress`،
 * ثمَّ قِيسَ أنَّ من مُناديها `packages/maps` وهيَ لا تستوردُ من `infrastructure`
 * (حدُّ الطبقاتِ، وله حاجزُه في `verify`). فلو وُضِعَت في `infrastructure` لصارَ
 * إمّا خرقُ حدٍّ أو مقصدٌ خارجَ البوّابةِ. فنزلَت إلى `shared` — أدنى طبقةٍ
 * يستوردُ منها الجميعُ — بجوارِ السجلِّ الذي تقرؤُه. والفرقُ عن الحجزِ مُسجَّلٌ
 * ههنا وفي الدليلِ، لا مسكوتٌ عنه.
 *
 * ينتمي إلى: packages/shared/wasla
 */

import { type EgressPeer, peerById, WASLA_EGRESS_REGISTRY } from "./egress-registry.ts";

/** سببُ القرارِ — مفرداتٌ مغلقةٌ كي تُقاسَ الرسالةُ ولا تُقرأَ نثراً. */
export type EgressAllowReason =
  /** مضيفٌ مُعلَنٌ حرفاً في مُدخلِ هذا المقصدِ. */
  | "DECLARED_LITERAL"
  /** المضيفُ الافتراضيُّ لمكتبةِ هذا المقصدِ. */
  | "DECLARED_LIBRARY_DEFAULT"
  /** المضيفُ الذي ضبطَه المُشغِّلُ في مفتاحِ بيئةِ هذا المقصدِ نفسِه. */
  | "CONFIGURED_ENV_HOST"
  /**
   * حَلقةٌ راجعةٌ أو نطاقٌ محفوظٌ (RFC 2606 / RFC 6761): لا يخرجُ من الجهازِ ولا
   * يُحَلُّ إلى مضيفٍ حقيقيٍّ، فليسَ صادراً. وهذا **حدٌّ مُعلَنٌ** لا ثقبٌ: بهِ
   * تعملُ الاختباراتُ وبيئاتُ التطويرِ بمضيفاتٍ محفوظةٍ بلا إعفاءٍ مكتوبٍ.
   */
  | "LOOPBACK_OR_RESERVED";

export type EgressDenyReason =
  /** معرّفُ مقصدٍ ليسَ في السجلِّ — نداءٌ بلا إعلانٍ. */
  | "UNKNOWN_PEER"
  /** عنوانٌ لا يُحَلُّ إلى `URL` — لا يُخمَّنُ مضيفُه. */
  | "MALFORMED_URL"
  /** مخطَّطٌ غيرُ `http`/`https` في نداءِ `fetch`. */
  | "NON_HTTP_SCHEME"
  /** المضيفُ غيرُ مُعلَنٍ لهذا المقصدِ ولا لغيرِه. */
  | "UNDECLARED_HOST"
  /** المضيفُ مُعلَنٌ لمقصدٍ آخرَ — عميلٌ يُوجَّهُ إلى بابٍ ليسَ بابَه. */
  | "HOST_OF_ANOTHER_PEER"
  /** مُدخلٌ يُعلِنُ `system: "MARKET"` — مرفوضٌ نصّاً في الطبقتَينِ. */
  | "MARKET_SYSTEM";

export type EgressDecision =
  | { readonly allowed: true; readonly host: string; readonly reason: EgressAllowReason }
  | { readonly allowed: false; readonly host?: string; readonly reason: EgressDenyReason };

/** بيئةٌ مُمَرَّرةٌ لا مُلتقَطةٌ، كي تُزرَعَ القيمُ في اختبارٍ فيُقاسَ الرفضُ. */
export type EgressEnv = Readonly<Record<string, string | undefined>>;

/**
 * أسماءٌ لا تخرجُ من الجهازِ أو محفوظةٌ لا تُسجَّلُ ألبتّةَ. مغلقةٌ عن قصدٍ: كلُّ
 * توسيعٍ لها توسيعٌ للثقبِ، فيُقرَأُ في المراجعةِ سطراً واحداً.
 */
const RESERVED_HOST = /(^|\.)(localhost|local|test|invalid|example|example\.(com|net|org))$/i;
const LOOPBACK_IP = /^(127(\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)$/;

/** هل المضيفُ حَلقةٌ راجعةٌ أو نطاقٌ محفوظٌ؟ */
export function isLoopbackOrReserved(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  return h === "" ? false : LOOPBACK_IP.test(h) || RESERVED_HOST.test(h);
}

/** كلُّ مضيفٍ يُعلِنُه المُدخلُ حرفاً أو مكتبةً — بلا قراءةِ بيئةٍ. */
export function staticHostsOf(peer: EgressPeer): readonly string[] {
  if (peer.source.kind === "literal") return peer.source.hosts;
  if (peer.source.kind === "library-default") return [peer.source.host];
  return [];
}

/**
 * المضيفاتُ التي ضبطَها المُشغِّلُ لهذا المُدخلِ. تُقرأُ من **قيمةِ** مفاتيحِه، لا
 * من أسمائِها: فالمفتاحُ الموثَّقُ يقولُ «من هنا يُضبَطُ المقصدُ»، والقيمةُ تقولُ
 * «إلى أينَ يذهبُ فعلاً»، والزيادةُ الأولى قاسَت الأوّلَ ولم تقِسِ الثاني.
 */
export function configuredHostsOf(peer: EgressPeer, env: EgressEnv): readonly string[] {
  if (peer.source.kind !== "env") return [];
  const out: string[] = [];
  for (const key of peer.source.envKeys) {
    const raw = env[key];
    if (raw === undefined || raw.trim() === "") continue;
    const host = hostOf(raw);
    if (host !== undefined) out.push(host);
  }
  return out;
}

/** المضيفُ من عنوانٍ، أو `undefined` إن لم يكن عنواناً. */
function hostOf(raw: string): string | undefined {
  try {
    return new URL(raw.trim()).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * القرارُ. دالّةٌ صافيةٌ: السجلُّ والبيئةُ مُمَرَّرانِ، فيُزرَعُ الخرقُ في اختبارٍ
 * ويُقاسُ **رفضُ البوّابةِ** لا سماحُها وحدَه.
 */
export function decideEgress(args: {
  readonly peerId: string;
  readonly url: string;
  readonly env?: EgressEnv;
  readonly registry?: readonly EgressPeer[];
}): EgressDecision {
  const registry = args.registry ?? WASLA_EGRESS_REGISTRY;
  const env = args.env ?? {};
  const peer = peerById(args.peerId, registry);
  if (peer === undefined) return { allowed: false, reason: "UNKNOWN_PEER" };
  if (peer.system === "MARKET") return { allowed: false, reason: "MARKET_SYSTEM" };

  let parsed: URL;
  try {
    parsed = new URL(args.url);
  } catch {
    return { allowed: false, reason: "MALFORMED_URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return { allowed: false, host: parsed.hostname.toLowerCase(), reason: "NON_HTTP_SCHEME" };

  const host = parsed.hostname.toLowerCase();
  if (staticHostsOf(peer).some((h) => h.toLowerCase() === host))
    return {
      allowed: true,
      host,
      reason: peer.source.kind === "literal" ? "DECLARED_LITERAL" : "DECLARED_LIBRARY_DEFAULT",
    };
  if (configuredHostsOf(peer, env).includes(host))
    return { allowed: true, host, reason: "CONFIGURED_ENV_HOST" };
  if (isLoopbackOrReserved(host)) return { allowed: true, host, reason: "LOOPBACK_OR_RESERVED" };

  /**
   * مضيفٌ مُعلَنٌ **لمقصدٍ آخرَ** يُفرَزُ برسالتِه: عميلُ الدفعِ يُنادي بابَ CORE،
   * أو شاحنُ الأحداثِ يُنادي بوّابةَ دفعٍ. ولو جُمِعَ مع «غيرِ مُعلَنٍ» لضاعَ أنَّ
   * الخرقَ خلطُ أبوابٍ لا مقصدٌ جديدٌ.
   */
  for (const other of registry) {
    if (other.id === peer.id) continue;
    if (staticHostsOf(other).some((h) => h.toLowerCase() === host))
      return { allowed: false, host, reason: "HOST_OF_ANOTHER_PEER" };
    if (configuredHostsOf(other, env).includes(host))
      return { allowed: false, host, reason: "HOST_OF_ANOTHER_PEER" };
  }
  return { allowed: false, host, reason: "UNDECLARED_HOST" };
}

/** رفضٌ مقروءٌ: المعرّفُ والسببُ والمضيفُ — ولا سرَّ ولا مسارَ ولا رمزَ حاملٍ. */
export class EgressDeniedError extends Error {
  readonly peerId: string;
  readonly reason: EgressDenyReason;
  readonly host: string | undefined;

  constructor(peerId: string, decision: Extract<EgressDecision, { allowed: false }>) {
    super(
      `صادرٌ مرفوضٌ: المقصدُ \`${peerId}\` والسببُ \`${decision.reason}\`` +
        (decision.host === undefined ? "" : ` والمضيفُ \`${decision.host}\``) +
        " — البوّابةُ تُنفِذُ الإعلانَ (`W-6` / `ADR 0086`)",
    );
    this.name = "EgressDeniedError";
    this.peerId = peerId;
    this.reason = decision.reason;
    this.host = decision.host;
  }
}

/** يرمي إن لم يكن النداءُ مُعلَناً. يُستعملُ حيثُ لا يُمكِنُ لفُّ `fetch`. */
export function assertEgressAllowed(args: {
  readonly peerId: string;
  readonly url: string;
  readonly env?: EgressEnv;
  readonly registry?: readonly EgressPeer[];
}): void {
  const decision = decideEgress(args);
  if (!decision.allowed) throw new EgressDeniedError(args.peerId, decision);
}

/**
 * ناقلٌ شبيهٌ بـ`fetch`: مُدخلاتُه ومُخرَجُه، بلا لواحقِ منصّةٍ (`preconnect` في Bun).
 * وبهِ يُلَفُّ الناقلُ ويُحقَنُ في الاختبارِ بلا اصطناعِ حقولٍ لا تُنادى.
 */
export type FetchLike = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

/** عنوانُ الطلبِ نصّاً، من كلِّ أشكالِ مُدخلِ `fetch`. */
function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * يلفُّ `fetch` ببوّابةٍ مُلزِمةٍ لمقصدٍ بعينِه.
 *
 * ويلفُّ **الناقلَ المحقونَ أيضاً** لا الناقلَ العامَّ وحدَه: لو كانَ الحقنُ يفلتُ
 * من البوّابةِ لصارَ الإنفاذُ اختياريّاً، وصارَ كلُّ موضعٍ يقبلُ `fetchImpl` باباً
 * جانبيّاً. فالبوّابةُ قبلَ الناقلِ أيّاً كانَ الناقلُ.
 */
export function createGuardedFetch(
  peerId: string,
  inner?: FetchLike,
  options?: { readonly env?: EgressEnv; readonly registry?: readonly EgressPeer[] },
): FetchLike {
  const transport: FetchLike = inner ?? ((input, init) => globalThis.fetch(input, init));
  const guarded: FetchLike = (input, init) => {
    const url = urlOf(input);
    const decision = decideEgress({
      peerId,
      url,
      ...(options?.env === undefined ? {} : { env: options.env }),
      ...(options?.registry === undefined ? {} : { registry: options.registry }),
    });
    if (!decision.allowed) return Promise.reject(new EgressDeniedError(peerId, decision));
    return transport(input, init);
  };
  return guarded;
}

/** خرقٌ في بيئةِ التشغيلِ: مفتاحٌ وسببٌ، بلا كشفِ قيمةٍ كاملةٍ. */
export interface EnvEgressViolation {
  readonly envKey: string;
  readonly peerId: string;
  readonly host: string;
  readonly detail: string;
}

/** مخطَّطاتٌ يجوزُ أن يحملَها مفتاحُ مقصدٍ — مغلقةٌ كي يُرفَضَ مفتاحٌ مضبوطٌ خطأً. */
const KNOWN_SCHEMES = new Set(["http:", "https:", "postgres:", "postgresql:", "redis:", "rediss:"]);

/**
 * يقيسُ **قيمَ** مفاتيحِ البيئةِ لا أسماءَها: مفتاحُ مقصدٍ لا يجوزُ أن يُضبَطَ على
 * مضيفٍ يملكُه مقصدٌ آخرُ (تشابكُ أبوابٍ)، ولا على مخطَّطٍ لا يُعرَفُ.
 *
 * وما **لا** يُقاسُ ههنا، مُعلَناً: أنَّ المضيفَ الذي ضبطَه المُشغِّلُ هوَ CORE
 * حقّاً. عنوانُ CORE يأتي من البيئةِ ولا يعرفُه المستودعُ، فادّعاءُ قياسِه
 * ادّعاءٌ كاذبٌ. المقيسُ: أنَّه ليسَ بابَ مقصدٍ آخرَ، وأنَّه عنوانٌ سليمٌ.
 */
export function envEgressViolations(
  env: EgressEnv,
  registry: readonly EgressPeer[] = WASLA_EGRESS_REGISTRY,
): readonly EnvEgressViolation[] {
  const out: EnvEgressViolation[] = [];
  for (const peer of registry) {
    if (peer.source.kind !== "env") continue;
    for (const key of peer.source.envKeys) {
      const raw = env[key];
      if (raw === undefined || raw.trim() === "") continue;
      let parsed: URL;
      try {
        parsed = new URL(raw.trim());
      } catch {
        continue;
      }
      const host = parsed.hostname.toLowerCase();
      if (!KNOWN_SCHEMES.has(parsed.protocol)) {
        out.push({
          envKey: key,
          peerId: peer.id,
          host,
          detail: `مخطَّطٌ لا يُعرَفُ: \`${parsed.protocol}\` — مفتاحٌ مضبوطٌ خطأً لا مقصدٌ`,
        });
        continue;
      }
      if (isLoopbackOrReserved(host)) continue;
      for (const other of registry) {
        if (other.id === peer.id) continue;
        if (!staticHostsOf(other).some((h) => h.toLowerCase() === host)) continue;
        out.push({
          envKey: key,
          peerId: peer.id,
          host,
          detail:
            `المفتاحُ مضبوطٌ على مضيفٍ يُعلِنُه المقصدُ \`${other.id}\` — ` +
            "تشابكُ أبوابٍ: مقصدٌ يُنادي بابَ مقصدٍ آخرَ بمفتاحِه",
        });
      }
    }
  }
  return out;
}

/** يرمي عندَ الإقلاعِ إن كانت البيئةُ تُشابِكُ الأبوابَ — فشلٌ مُبكِرٌ لا صامتٌ. */
export function assertEgressEnvironment(
  env: EgressEnv,
  registry: readonly EgressPeer[] = WASLA_EGRESS_REGISTRY,
): void {
  const violations = envEgressViolations(env, registry);
  if (violations.length === 0) return;
  const lines = violations.map((v) => `- \`${v.envKey}\` (${v.peerId}): ${v.detail}`);
  throw new Error(
    `بيئةُ الصادرِ مرفوضةٌ (${violations.length} خرقاً) — \`W-6\` / \`ADR 0086\`:\n${lines.join("\n")}`,
  );
}
