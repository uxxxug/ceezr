/**
 * الغرض: سالبةٌ مزروعةٌ **لكلِّ قاعدةٍ** في حاجزِ أثرِ الأفعالِ المُتسلِّطةِ (`ح-7`)،
 *   ومعَها الطرفُ الموجَبُ: الهجراتُ كما هيَ لا تُخرِقُ شيئاً.
 * الحالة: منفَّذٌ فعليّاً — أُضيفَ في 2026-09-16 (`SEC-12`).
 * ينتمي إلى: tests/unit
 * الحاكم: ADR 0136 · `ح-7`
 *
 * حاجزٌ بلا سالبةٍ مزروعةٍ دعوى: يمرُّ أخضرَ وهوَ لا يقرأُ شيئاً. فكلُّ قاعدةٍ
 * ههنا تُزرَعُ لها حالةٌ تُخرِقُها **وحدَها**، ويُشتَرَطُ أن يُمسَكَ الخرقُ باسمِ
 * قاعدتِه لا بعددٍ. **والطرفُ الموجَبُ مقيسٌ أيضاً**: حاجزٌ يرفضُ كلَّ شيءٍ يمرُّ
 * أخضرَ وهوَ مكسورٌ.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  AUDIT_EXEMPT_PRIVILEGED_FUNCTIONS,
  AUDITED_PRIVILEGED_ACTIONS,
  auditActionViolations,
  type FunctionDefinitionFacts,
  isPrivilegedActorFunction,
  privilegedDelegates,
  REQUIRED_AUDITED_FUNCTION_COUNT,
  REQUIRED_EXEMPTION_COUNT,
  writtenActionNames,
} from "../../scripts/lib/audit-actions-registry.ts";

const repoRoot = resolve(import.meta.dir, "../..");

/** تعريفٌ سليمٌ لدالَّةٍ مُسجَّلةٍ: حُكمُ دورٍ، وكتابةٌ، وأثرٌ باسمِ فعلٍ مُعلَنٍ. */
function healthyBody(action: string): string {
  return [
    "select * into v_actor from users where id = p_actor_user_id;",
    "if v_actor.role <> 'admin' then return jsonb_build_object('ok', false); end if;",
    "update users set is_blocked = true where id = p_target;",
    "insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)",
    `values (v.city_id, v_actor.id, '${action}', 'user', v.id, '{}'::jsonb);`,
  ].join("\n");
}

/** تعريفٌ سليمٌ للاسمِ المُركَّبِ: البادئةُ مكتوبةٌ ونطاقُ اللاحقةِ محصورٌ. */
function healthyComposedBody(prefix: string, suffixes: readonly string[]): string {
  const domain = suffixes.map((suffix) => `'${suffix}'`).join(", ");
  return [
    "v_actor := is_support_actor(p_actor_telegram_id);",
    `if p_action not in (${domain}) then return jsonb_build_object('ok', false); end if;`,
    "update support_tickets set status = 'resolved' where id = p_ticket_id;",
    "insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)",
    `values (v.city_id, v_actor_id, '${prefix}' || p_action, 'support_ticket', p_ticket_id, '{}'::jsonb);`,
  ].join("\n");
}

/** نائبُ حُكمٍ: فيهِ حُكمُ الدورِ ولا يكتبُ — فيُكتشَفُ نائباً لا فعلاً. */
const DELEGATE: FunctionDefinitionFacts = {
  fn: "is_support_actor",
  migration: "0000_delegate.sql",
  body: "select * into v from users where telegram_id = p_id and role in ('support', 'admin');",
};

/** حالةٌ سليمةٌ تامّةٌ: كلُّ مُسجَّلٍ لهُ تعريفٌ مُطابِقٌ، والمُعفى لا يُدقِّقُ. */
function healthyDefinitions(): FunctionDefinitionFacts[] {
  const definitions: FunctionDefinitionFacts[] = [DELEGATE];
  for (const entry of AUDITED_PRIVILEGED_ACTIONS) {
    const composed = entry.composed;
    definitions.push({
      fn: entry.fn,
      migration: "0001_healthy.sql",
      body:
        composed === undefined
          ? entry.actions.map((action) => healthyBody(action)).join("\n")
          : healthyComposedBody(composed.prefix, composed.suffixes),
    });
  }
  for (const exemption of AUDIT_EXEMPT_PRIVILEGED_FUNCTIONS) {
    definitions.push({
      fn: exemption.fn,
      migration: "0001_healthy.sql",
      body: [
        "if v_actor.role <> 'admin' then return null; end if;",
        "update admin_sessions set last_seen_at = now() where id = v.id;",
      ].join("\n"),
    });
  }
  return definitions;
}

function rules(definitions: readonly FunctionDefinitionFacts[]): string[] {
  return auditActionViolations(definitions).map((violation) => violation.rule);
}

/** يستبدلُ جسمَ دالَّةٍ بعينِها في نسخةٍ من الحالةِ السليمةِ. */
function withBody(fn: string, body: string): FunctionDefinitionFacts[] {
  return healthyDefinitions().map((definition) =>
    definition.fn === fn ? { fn, migration: definition.migration, body } : definition,
  );
}

describe("حاجزُ أثرِ الأفعالِ المُتسلِّطةِ (SEC-12)", () => {
  test("الطرفُ الموجَبُ: حالةٌ سليمةٌ لا تُخرِقُ شيئاً — وإلّا فالحاجزُ يرفضُ كلَّ شيءٍ", () => {
    expect(rules(healthyDefinitions())).toEqual([]);
  });

  test("الطرفُ الموجَبُ الحقيقيُّ: الهجراتُ في المستودَعِ كما هيَ خضراءُ", () => {
    const migrationsDir = resolve(repoRoot, "supabase/migrations");
    const pattern =
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/gi;
    const latest = new Map<string, FunctionDefinitionFacts>();
    for (const file of readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const source = readFileSync(resolve(migrationsDir, file), "utf8");
      for (const match of source.matchAll(pattern)) {
        const fn = match[1];
        const body = match[3];
        if (fn === undefined || body === undefined) continue;
        latest.set(fn, { fn, migration: file, body });
      }
    }
    expect(latest.size).toBeGreaterThan(150);
    expect(rules([...latest.values()])).toEqual([]);
  });

  test("سالبةٌ: دالَّةٌ مُتسلِّطةٌ كاتبةٌ جديدةٌ غيرُ مُسجَّلةٍ تُكتشَفُ", () => {
    const planted = [
      ...healthyDefinitions(),
      {
        fn: "admin_purge_city",
        migration: "9999_planted.sql",
        body: healthyBody("admin.city_purged").replace(/insert into audit_log[\s\S]*$/, ""),
      },
    ];
    expect(rules(planted)).toContain("discovery.privileged-writer-unregistered");
  });

  test("سالبةٌ: دالَّةٌ مُتسلِّطةٌ **بنائبٍ** لا بحُكمٍ مباشرٍ تُكتشَفُ أيضاً", () => {
    const planted = [
      ...healthyDefinitions(),
      {
        fn: "support_force_close_ticket",
        migration: "9999_planted.sql",
        body: [
          "v_actor := is_support_actor(p_actor_telegram_id);",
          "update support_tickets set status = 'rejected' where id = p_id;",
        ].join("\n"),
      },
    ];
    expect(rules(planted)).toContain("discovery.privileged-writer-unregistered");
  });

  test("سالبةٌ: اسمٌ مُسجَّلٌ لا تعريفَ لهُ في أيِّ هجرةٍ", () => {
    const [first, ...rest] = AUDITED_PRIVILEGED_ACTIONS;
    expect(first).toBeDefined();
    const planted = healthyDefinitions().filter((definition) => definition.fn !== first?.fn);
    expect(rest.length).toBeGreaterThan(0);
    expect(rules(planted)).toContain("registry.function-not-found");
  });

  test("سالبةٌ: مُسجَّلٌ سُحِبَ منهُ حُكمُ الدورِ فبقيَ «مُدقَّقاً» بالاسمِ", () => {
    const planted = withBody(
      "admin_set_user_blocked",
      [
        "update users set is_blocked = true where id = p_target;",
        "insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)",
        "values (v.city_id, v.id, 'admin.user_blocked_changed', 'user', v.id, '{}'::jsonb);",
      ].join("\n"),
    );
    expect(rules(planted)).toContain("registry.function-not-privileged-writer");
  });

  test("سالبةٌ: فعلٌ مُتسلِّطٌ بلا إدراجٍ في audit_log", () => {
    const planted = withBody(
      "admin_set_user_blocked",
      [
        "if v_actor.role <> 'admin' then return null; end if;",
        "update users set is_blocked = true where id = p_target;",
      ].join("\n"),
    );
    expect(rules(planted)).toContain("writer.no-audit-insert");
  });

  test("سالبةٌ: اسمُ فعلٍ مكتوبٌ غيرُ مُعلَنٍ — معجمٌ مفتوحٌ سِجلٌّ لا يُميِّزُ", () => {
    const planted = withBody("admin_set_user_blocked", healthyBody("admin.something_else"));
    const caught = rules(planted);
    expect(caught).toContain("action.written-but-undeclared");
    expect(caught).toContain("action.declared-but-unwritten");
  });

  test("سالبةٌ: اسمٌ مُعلَنٌ لا يُكتَبُ — السِجلُّ أوسعُ من الأثرِ", () => {
    const planted = withBody(
      "admin_set_user_blocked",
      healthyBody("admin.user_blocked_changed").replace("'admin.user_blocked_changed'", "v_name"),
    );
    expect(rules(planted)).toContain("action.declared-but-unwritten");
  });

  test("سالبةٌ: اسمٌ مُركَّبٌ نطاقُ لاحقتِهِ مفتوحٌ — العمودُ يقبلُ ما يُمرَّرُ", () => {
    const entry = AUDITED_PRIVILEGED_ACTIONS.find((item) => item.composed !== undefined);
    expect(entry).toBeDefined();
    const composed = entry?.composed;
    if (entry === undefined || composed === undefined) throw new Error("لا اسمَ مُركَّباً مُسجَّلاً");
    const planted = withBody(
      entry.fn,
      healthyComposedBody(composed.prefix, composed.suffixes).replace(
        /if p_action not in \([^)]*\)[^\n]*\n/,
        "",
      ),
    );
    expect(rules(planted)).toContain("action.composed-domain-not-closed");
  });

  test("سالبةٌ: العددُ المُعلَنُ لا يُقرأُ من الطولِ — انحرافُهُ يُسقِطُ البناءَ", () => {
    // البندُ نصٌّ، فلو ساوى الطولَ دائماً لحرسَ السِجلُّ نفسَه فلم يحرسْ شيئاً.
    expect(REQUIRED_AUDITED_FUNCTION_COUNT).toBe(AUDITED_PRIVILEGED_ACTIONS.length);
    expect(REQUIRED_EXEMPTION_COUNT).toBe(AUDIT_EXEMPT_PRIVILEGED_FUNCTIONS.length);
    const source = readFileSync(resolve(repoRoot, "scripts/lib/audit-actions-registry.ts"), "utf8");
    expect(source).not.toContain("REQUIRED_AUDITED_FUNCTION_COUNT = AUDITED_PRIVILEGED_ACTIONS");
  });

  test("سالبةٌ: إعفاءٌ بائتٌ — الدالَّةُ صارَت تُدقِّقُ والإعفاءُ يُوهِمُ نقصاً زالَ", () => {
    const [exemption] = AUDIT_EXEMPT_PRIVILEGED_FUNCTIONS;
    expect(exemption).toBeDefined();
    if (exemption === undefined) throw new Error("لا إعفاءَ مُسجَّلاً");
    const planted = withBody(exemption.fn, healthyBody("admin.session_touched"));
    expect(rules(planted)).toContain("exemption.function-does-audit");
  });

  test("كلُّ إعفاءٍ لهُ سببٌ مكتوبٌ كافٍ — لا بابَ إسكاتٍ بلا مسؤولٍ", () => {
    for (const exemption of AUDIT_EXEMPT_PRIVILEGED_FUNCTIONS) {
      expect(exemption.reason.trim().length).toBeGreaterThanOrEqual(40);
    }
  });

  test("النوّابُ مُكتشَفونَ لا مكتوبونَ — ونائبٌ لا يُعَدُّ فعلاً يُدقَّقُ", () => {
    const delegates = privilegedDelegates([DELEGATE]);
    expect(delegates).toContain("is_support_actor");
    expect(isPrivilegedActorFunction("v := is_support_actor(p_id);", delegates)).toBe(true);
    expect(isPrivilegedActorFunction("select 1;", delegates)).toBe(false);
  });

  test("قارئُ أسماءِ الأفعالِ يقرأُ العمودَ الثالثَ لا أوّلَ حرفيٍّ في الجسمِ", () => {
    const body = [
      "if v.role <> 'admin' then return null; end if;",
      "insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)",
      "values (v.city_id, v.id, 'admin.setting_updated', 'setting', v.id, '{}'::jsonb);",
    ].join("\n");
    expect(writtenActionNames(body)).toEqual(["admin.setting_updated"]);
  });
});
