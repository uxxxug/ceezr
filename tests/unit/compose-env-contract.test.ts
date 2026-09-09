/**
 * الغرض: عقدُ بيئةِ رصةِ compose — كلُّ خدمةِ تطبيقٍ في `docker-compose.f5-06.yml`
 *    يجبُ أن يقبلَ ضبطُها `tryLoadConfig` قبلَ أن يُرفَعَ شيءٌ في CI، وكلُّ بوّابةٍ
 *    يجبُ أن تُعلِنَ `healthcheck` حتّى لا يُقرأَ `up --wait` أخضرَ على نسخةٍ ميّتةٍ.
 * الحالة: منفّذ فعلياً — حاجزٌ يعملُ في `bun test` (فوظيفةُ `verify` تُشغِّلُه).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيُّ رصةِ compose تُضافُ لاحقاً — تُضافُ إلى
 *    `COMPOSE_FILES` فيلزمُها العقدُ نفسُه.
 *
 * لماذا؟ لأنّ العيبَ وقعَ فعلاً: `SUPABASE_URL: http://supabase-unused.local` في
 * مِرساةِ بيئةِ البوّاباتِ خالفَ شرطَ الضبطِ (`https://` أوّلاً)، فسقطَ إقلاعُ
 * البوّاباتِ الثلاثِ والعاملَينِ في التشغيلِ `34365082495` عندَ خطوةِ رفعِ الرصةِ.
 * والعيبُ من صنفٍ لا يظهرُ في مراجعةِ نصٍّ ولا في `docker compose config`: القيمةُ
 * YAML صالحةٌ، والرفضُ يقعُ في الضبطِ لا في الرصةِ. فيُقاسُ هنا بمُصدَرِ الحقيقةِ
 * نفسِه — `tryLoadConfig` لا نسخةٍ ثانيةٍ من قواعدِه — وفي `bun test` لا في Docker،
 * لأنّ العُدّاءَ وحدَه يملكُ Docker وجهازُ التنفيذِ لا يملكُه.
 *
 * وحدُّه مُعلَنٌ: يُثبتُ أنّ الضبطَ مقبولٌ، لا أنّ الرصةَ تُقلعُ — الإقلاعُ يُقاسُ
 * في CI وحدَه (`chaos-multi-instance`).
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { tryLoadConfig } from "../../packages/shared/config/index.ts";

/** رصّاتُ compose المشمولةُ بالعقد. */
const COMPOSE_FILES = ["docker-compose.f5-06.yml"] as const;

/**
 * خدمةُ تطبيقٍ = خدمةٌ تُبنى من صورةِ المستودعِ وتقرأُ ضبطَه. والعلامةُ الفارقةُ
 * `DATABASE_URL` في بيئتِها: خدماتُ البنيةِ (Postgres، Redis، المحوّلُ، الموزّعُ)
 * لا تقرأُ ضبطَ التطبيقِ أصلاً فلا يُحاكَمُ عليها.
 */
const APP_SERVICE_MARKER = "DATABASE_URL";

interface ComposeService {
  readonly environment?: Record<string, unknown>;
  readonly healthcheck?: unknown;
}

function servicesOf(file: string): Record<string, ComposeService> {
  const parsed = Bun.YAML.parse(readFileSync(file, "utf8")) as {
    services?: Record<string, ComposeService>;
  };
  const services = parsed.services;
  if (services === undefined) throw new Error(`لا خدماتٍ في ${file}`);
  return services;
}

/** بيئةُ خدمةٍ كما يراها الضبطُ: مفاتيحُ نصوصٍ لا قيمٌ YAML. */
function envOf(service: ComposeService): Record<string, string> {
  const source = service.environment ?? {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}

function appServices(file: string): [string, ComposeService][] {
  return Object.entries(servicesOf(file)).filter(([, service]) =>
    Object.hasOwn(service.environment ?? {}, APP_SERVICE_MARKER),
  );
}

describe("عقدُ بيئةِ رصةِ compose", () => {
  for (const file of COMPOSE_FILES) {
    const services = appServices(file);

    it(`${file}: فيه خدماتُ تطبيقٍ تُفحَص`, () => {
      // لو صفرٌ، لكانَ الحاجزُ يمرُّ بلا أن يفحصَ شيئاً — وذلك أسوأُ من غيابِه.
      expect(services.length).toBeGreaterThan(0);
    });

    for (const [name, service] of services) {
      it(`${file}: ضبطُ «${name}» يقبلُه tryLoadConfig`, () => {
        const result = tryLoadConfig(envOf(service));
        const reason = result.ok ? "" : result.error.message;
        expect(reason).toBe("");
        expect(result.ok).toBe(true);
      });
    }

    for (const [name, service] of services) {
      if (!name.startsWith("gateway")) continue;
      it(`${file}: «${name}» تُعلِنُ فحصَ حياةٍ فلا يُقرأُ up --wait أخضرَ على نسخةٍ ميّتةٍ`, () => {
        expect(service.healthcheck).toBeDefined();
      });
    }
  }
});

describe("حدُّ العقدِ مُبرهَنٌ لا مُدَّعى", () => {
  it("يسقطُ على مخالفةِ مخطَّطٍ مزروعةٍ — نفسِ عيبِ التشغيلِ 34365082495", () => {
    const [entry] = appServices("docker-compose.f5-06.yml");
    if (entry === undefined) throw new Error("لا خدمةَ تطبيقٍ لزرعِ المخالفةِ فيها");
    const broken = { ...envOf(entry[1]), SUPABASE_URL: "http://supabase-unused.local" };
    const result = tryLoadConfig(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("SUPABASE_URL");
  });
});
