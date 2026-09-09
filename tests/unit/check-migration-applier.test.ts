/**
 * الغرض: برهانُ سقوطِ حاجزِ المُطبِّقِ بخرقٍ مزروعٍ، ونجاحِه على `ci.yml` الحقيقيِّ
 *    في حالتِه الراهنةِ (F7-07 · ADR 0068).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ `verify` في CI — وهي المنفذُ الذي يجعل الحاجزَ
 *    يعملُ في CI العامِّ لا في `bun run ci` وحدَه.
 * ملاحظات مستقبلية: يومَ يُضافُ ملفُّ سيرِ عملٍ ثانٍ يُطبِّقُ هجراتٍ، يُمرَّرُ مسارُه
 *    إلى الفاحصِ كوسيطٍ ويُضافُ سطرُ خطوةٍ — لا يُوسَّعُ النمطُ.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { APPLIER, analyse, jobsOf } from "../../scripts/check-migration-applier.ts";

const REAL_WORKFLOW = readFileSync(".github/workflows/ci.yml", "utf8");

const SOUND = [
  "jobs:",
  "  integration:",
  "    steps:",
  "      - name: أدوار Supabase التي تفترضها الهجرات",
  "        run: |",
  '          psql -h localhost -U postgres -d waslah -c "create role anon nologin"',
  "      - name: تطبيق الهجرات بالمُطبِّقِ الآمنِ",
  "        env:",
  "          DATABASE_URL: postgres://postgres:postgres@localhost:5432/waslah",
  `        run: bun run ${APPLIER}`,
  "",
].join("\n");

describe("حاجزُ المُطبِّقِ — المستودعُ الحقيقيُّ", () => {
  it("لا مخالفةَ في ci.yml كما هو الآن", () => {
    expect(analyse(REAL_WORKFLOW)).toEqual([]);
  });

  it("ci.yml ينادي المُطبِّقَ في كلِّ وظيفةٍ تُهيّئُ قاعدةَ الهجراتِ", () => {
    const jobsWithRoles = jobsOf(REAL_WORKFLOW).filter((job) =>
      job.lines.some((line) => /create\s+role\s+anon/.test(line)),
    );
    // ثلاثُ وظائفَ تُهيّئُ الأدوارَ: التكاملُ على PostgreSQL، وRedis، وفوضى F5-06.
    expect(jobsWithRoles.length).toBeGreaterThanOrEqual(3);
    for (const job of jobsWithRoles) {
      expect(job.lines.some((line) => line.includes(APPLIER))).toBe(true);
    }
  });
});

describe("حاجزُ المُطبِّقِ — خرقٌ مزروعٌ", () => {
  it("يمرُّ على وظيفةٍ سليمةٍ", () => {
    expect(analyse(SOUND)).toEqual([]);
  });

  it("يسقطُ على حلقةِ psql — عينِ الانحدارِ الذي رجعَ في a16bf97", () => {
    const breach = [
      "jobs:",
      "  integration:",
      "    steps:",
      "      - name: تطبيق الهجرات بالترتيب",
      "        run: |",
      "          for file in $(ls supabase/migrations/*.sql | sort); do",
      '            psql -h localhost -U postgres -d waslah -v ON_ERROR_STOP=1 -f "$file"',
      "          done",
      "",
    ].join("\n");
    const codes = analyse(breach).map((finding) => finding.code);
    expect(codes).toContain("PSQL_LOOP");
    expect(codes).toContain("PSQL_APPLY");
    expect(codes).toContain("APPLIER_MISSING");
  });

  it("يسقطُ على تطبيقِ ملفِّ هجرةٍ واحدٍ بـpsql مباشرةً", () => {
    const breach = [
      "jobs:",
      "  integration:",
      "    steps:",
      `      - run: bun run ${APPLIER}`,
      "      - name: ترحيلةٌ إضافيةٌ",
      "        run: psql -h localhost -U postgres -d waslah -f supabase/migrations/20260101000000_x.sql",
      "",
    ].join("\n");
    const codes = analyse(breach).map((finding) => finding.code);
    expect(codes).toEqual(["PSQL_APPLY"]);
  });

  it("يسقطُ على وظيفةٍ تُهيّئُ الأدوارَ ولا تنادي المُطبِّقَ", () => {
    const breach = [
      "jobs:",
      "  integration:",
      "    steps:",
      '      - run: psql -h localhost -U postgres -d waslah -c "create role service_role nologin"',
      "",
    ].join("\n");
    const findings = analyse(breach);
    expect(findings.map((finding) => finding.code)).toEqual(["APPLIER_MISSING"]);
    expect(findings[0]?.job).toBe("integration");
  });

  it("لا يُحاكِمُ وظيفةً لا علاقةَ لها بالهجراتِ", () => {
    const unrelated = ["jobs:", "  lint:", "    steps:", "      - run: bun run lint", ""].join(
      "\n",
    );
    expect(analyse(unrelated)).toEqual([]);
  });
});
