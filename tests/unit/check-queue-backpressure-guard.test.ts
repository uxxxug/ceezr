/**
 * الغرض: الحالاتُ **السالبةُ** لحاجزِ الضغطِ العكسيِّ. حاجزٌ يُختبَرُ خضرةً
 *    وحدَها حاجزٌ بالاسمِ: كلُّ قاعدةٍ من قواعدِه الخمسِ تُخرَقُ ههنا عمداً
 *    ويُتحقَّقُ أنّها تُخفِقُ فعلاً (F6-06 / ADR-0066).
 * الحالة: مُختبَر.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import {
  findViolations,
  type MigrationFile,
  type RepositoryDeclaration,
  readMigrations,
  repositoryDeclaration,
} from "../../scripts/check-queue-backpressure.ts";

/**
 * هجراتٌ مُصطنَعةٌ صغيرةٌ: جدولٌ حيٌّ، وجدولٌ متقاعدٌ، ومفتاحُ إعدادٍ مبذورٌ،
 * ودالّةُ التأجيلِ. لا تُقرأُ الهجراتُ الحقيقيّةُ ههنا كي يبقى الاختبارُ
 * حاكماً على المنطقِ لا على حالةِ المستودعِ اليومَ.
 */
function fixtureMigrations(): MigrationFile[] {
  return [
    {
      file: "20260101000000_live_queue.sql",
      sql: [
        "create table if not exists live_queue (",
        "  id uuid primary key,",
        "  attempts integer not null default 0,",
        "  claim_token uuid,",
        "  next_attempt_at timestamptz not null default now()",
        "\n);",
        "insert into platform_settings (city_id, key, value_type) values (c.id, 'live_depth_limit', 'number');",
        "create or replace function notification_kind_is_deferrable(p_kind text)",
        "returns boolean language sql immutable as $$",
        "  select p_kind in ('broadcast_recipient')",
        "$$;",
      ].join("\n"),
    },
    {
      file: "20260202000000_retire_old_queue.sql",
      sql: [
        "create table if not exists old_queue (",
        "  id uuid primary key,",
        "  attempts integer not null default 0,",
        "  claim_token uuid,",
        "  next_attempt_at timestamptz",
        "\n);",
      ].join("\n"),
    },
  ];
}

function fixtureDeclaration(): RepositoryDeclaration {
  return {
    durableQueues: ["live_queue"],
    retiredQueues: [{ table: "old_queue", retiredIn: "20260202000000" }],
    declarations: [
      {
        queue: "live_queue",
        capacity: { kind: "platform_settings", key: "live_depth_limit" },
        oldest_age: { kind: "platform_settings", key: "live_depth_limit" },
        retry: { kind: "platform_settings", key: "live_depth_limit" },
        dead_letter: { kind: "platform_settings", key: "live_depth_limit" },
        producer: { kind: "platform_settings", key: "live_depth_limit" },
        consumer_concurrency: { kind: "platform_settings", key: "live_depth_limit" },
      },
    ] as unknown as RepositoryDeclaration["declarations"],
    deferrableKinds: ["broadcast_recipient"],
    notificationKinds: ["broadcast_recipient", "ride_assigned"],
    exportedConstants: {},
  };
}

describe("حاجزُ الضغطِ العكسيِّ — المستودعُ كما هوَ", () => {
  test("المستودعُ الحاليُّ بلا مخالفةٍ", () => {
    expect(findViolations(readMigrations(), repositoryDeclaration())).toEqual([]);
  });

  test("التركيبةُ المُصطنَعةُ خطُّ أساسٍ نظيفٌ — وإلّا لم تُقرأ الحالاتُ السالبةُ", () => {
    expect(findViolations(fixtureMigrations(), fixtureDeclaration())).toEqual([]);
  });
});

describe("حاجزُ الضغطِ العكسيِّ — كلُّ قاعدةٍ تُخرَقُ فتُخفِقُ", () => {
  test("(١) جدولٌ بنيتُه بنيةُ طابورٍ غيرُ مُعلَنٍ", () => {
    const declared = { ...fixtureDeclaration(), durableQueues: [] as string[] };
    const violations = findViolations(fixtureMigrations(), declared);
    expect(violations.some((v) => v.includes("«live_queue»") && v.includes("ولم يُعلَن"))).toBe(true);
  });

  test("(١-ب) إعلانٌ لطابورٍ لا جدولَ له", () => {
    const declared = {
      ...fixtureDeclaration(),
      durableQueues: ["live_queue", "ghost_queue"],
    };
    const violations = findViolations(fixtureMigrations(), declared);
    expect(
      violations.some((v) => v.includes("«ghost_queue»") && v.includes("معلَّقٌ في الهواءِ")),
    ).toBe(true);
  });

  test("(٢) إدراجٌ في طابورٍ مُعلَنٍ متقاعداً بعدَ تاريخِ تقاعُدِه", () => {
    const migrations = [
      ...fixtureMigrations(),
      {
        file: "20260303000000_write_to_retired.sql",
        sql: "insert into old_queue (id) values (1);",
      },
    ];
    const violations = findViolations(migrations, fixtureDeclaration());
    expect(violations.some((v) => v.includes("«old_queue»") && v.includes("متقاعداً"))).toBe(true);
  });

  test("(٢-ب) إدراجٌ **قبلَ** التقاعُدِ لا يُخفِقُ — تاريخُ التقاعُدِ لهُ معنىً", () => {
    const migrations = [
      { file: "20260101000001_seed_old.sql", sql: "insert into old_queue (id) values (1);" },
      ...fixtureMigrations(),
    ];
    expect(findViolations(migrations, fixtureDeclaration())).toEqual([]);
  });

  test("(٣) حدٌّ مُعلَنٌ في مفتاحِ إعدادٍ لا تبذُرُه هجرةٌ", () => {
    const base = fixtureDeclaration();
    const declared = {
      ...base,
      declarations: [
        { ...base.declarations[0], capacity: { kind: "platform_settings", key: "no_such_key" } },
      ] as unknown as RepositoryDeclaration["declarations"],
    };
    const violations = findViolations(fixtureMigrations(), declared);
    expect(violations.some((v) => v.includes("«no_such_key»") && v.includes("لا تبذُرُه"))).toBe(
      true,
    );
  });

  test("(٣-ب) حدٌّ مُعلَنٌ في ثابتٍ غيرِ مُصدَّرٍ من وحدتِه", () => {
    const base = fixtureDeclaration();
    const declared = {
      ...base,
      exportedConstants: { "packages/shared/config/x.ts": ["REAL_CONSTANT"] },
      declarations: [
        {
          ...base.declarations[0],
          producer: {
            kind: "code_constant",
            module: "packages/shared/config/x.ts",
            name: "IMAGINARY_CONSTANT",
          },
        },
      ] as unknown as RepositoryDeclaration["declarations"],
    };
    const violations = findViolations(fixtureMigrations(), declared);
    expect(violations.some((v) => v.includes("IMAGINARY_CONSTANT") && v.includes("غيرِ مُصدَّرٍ"))).toBe(
      true,
    );
  });

  test("(٣-ج) طابورٌ حيٌّ بلا إعلانِ حدودٍ أصلاً", () => {
    const declared = {
      ...fixtureDeclaration(),
      declarations: [] as unknown as RepositoryDeclaration["declarations"],
    };
    const violations = findViolations(fixtureMigrations(), declared);
    expect(violations.some((v) => v.includes("بلا إعلانِ حدودٍ"))).toBe(true);
  });

  test("(٤) القائمتانِ تفترقانِ في الاتجاهَينِ كليهما", () => {
    const missingInDb = findViolations(fixtureMigrations(), {
      ...fixtureDeclaration(),
      deferrableKinds: ["broadcast_recipient", "ride_assigned"],
    });
    expect(
      missingInDb.some((v) => v.includes("«ride_assigned»") && v.includes("ولا في دالّةِ")),
    ).toBe(true);

    const missingInCode = findViolations(fixtureMigrations(), {
      ...fixtureDeclaration(),
      deferrableKinds: [],
    });
    expect(
      missingInCode.some((v) => v.includes("«broadcast_recipient»") && v.includes("ولا في الكودِ")),
    ).toBe(true);
  });

  test("(٥) صنفٌ قابلٌ للتأجيلِ خارجَ أنواعِ الصندوقِ", () => {
    const migrations = fixtureMigrations();
    const first = migrations[0] as MigrationFile;
    const patched: MigrationFile[] = [
      { file: first.file, sql: first.sql.replace("'broadcast_recipient'", "'not_a_kind'") },
      ...migrations.slice(1),
    ];
    const violations = findViolations(patched, {
      ...fixtureDeclaration(),
      deferrableKinds: ["not_a_kind"],
    });
    expect(violations.some((v) => v.includes("«not_a_kind»") && v.includes("مُدخلٌ ميّتٌ"))).toBe(true);
  });
});
