/**
 * الغرض: برهانُ أنَّ مُقابِلَ الطزاجةِ **يُخفِقُ** على كلِّ صنفِ انحرافٍ: بائتٌ
 *   بتغييرٍ يُنفَّذُ، ونسختُنا مُحرَّرةٌ، ومصدرٌ أُزيلَ، وسندٌ لا يُقرأُ — وأنَّ
 *   مقابلتَه **دلاليّةٌ** لا نصّيّةٌ: إعادةُ تنسيقٍ لا تُقرأُ انحرافاً كاسراً،
 *   وحقلٌ صارَ مطلوباً يُقرأُ كاسراً للمستهلكِ. البند `DEP-CORE-005`.
 * الحالة: منفّذ فعلياً — 2026-09-12 · البند `DEP-CORE-005`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit` وسلسلةُ `ci`.
 * ملاحظات مستقبلية: حينَ تُمنَحُ `O-6` ويُنقَلُ المُقابِلُ إلى `verify` يُزادُ
 *   ههنا مقياسٌ على نسخةٍ حقيقيّةٍ من CORE؛ وحتّى ذلكَ يُقاسُ الحكمُ على
 *   مستودَعٍ مزروعٍ، فالمقياسُ يجبُ أن يجريَ بلا شبكةٍ ولا صلاحيّةٍ.
 *
 * ## لِمَ مستودَعٌ مزروعٌ لا نسخةُ CORE
 *
 * مقياسٌ يلزمُه مستودَعٌ خاصٌّ لا يجري في CI ولا على حاسبِ غيرِ المالكِ، فيصيرُ
 * مقياساً مُعطَّلاً بحكمِ الواقعِ. فتُبنى ههنا نسخةُ `git` حقيقيّةٌ صغيرةٌ
 * بالتزامَينِ، فيُقاسُ `git show` نفسُه — لا مُزيَّفٌ يُخفي عطبَ القارئِ.
 *
 * ## ولِمَ يُقاسُ التصنيفُ لا الإخفاقُ وحدَه
 *
 * «اختلفَ» لا تُفيدُ قراراً، والذي أعطبَ `W-5` صنفٌ بعينِه: حقلٌ صارَ مطلوباً في
 * عقدٍ يمنعُ الزائدَ، فصارَ المستهلكُ يَرُدُّ كلَّ حمولةٍ. فيُطلَبُ ههنا أن
 * يُسمّيَ المُقابِلُ ذاكَ الصنفَ بعينِه، لا أن يقولَ «تغيَّرَ شيءٌ».
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type GitReader,
  gitReaderFor,
  judgeFile,
} from "../../scripts/check-core-contract-freshness.ts";
import { diffContractText, diffJsonSchema } from "../../scripts/lib/schema-semantic-diff.ts";
import type { ContractPin } from "../../scripts/lib/vendored-contract-pins.ts";

const PIN_COMMIT = "a".repeat(40);
const HEAD_COMMIT = "b".repeat(40);

const PIN: ContractPin = {
  repo: "uxxxug/wasla-core",
  commit: PIN_COMMIT,
  sourcePath: "contracts/events/sample.v1.schema.json",
  vendoredPath: "sample.v1.schema.json",
};

const AT_PIN = JSON.stringify(
  {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
      state: { type: "string", enum: ["held", "released"] },
    },
  },
  null,
  2,
);

/** نسخةُ الرأسِ: زِيدَ حقلٌ مطلوبٌ، وزِيدَت قيمةٌ في العدادِ — عطبُ `W-5` نفسُه. */
const AT_HEAD = JSON.stringify(
  {
    type: "object",
    additionalProperties: false,
    required: ["id", "organization_id"],
    properties: {
      id: { type: "string", format: "uuid" },
      organization_id: { type: "string", format: "uuid" },
      state: { type: "string", enum: ["held", "released", "partially_captured"] },
    },
  },
  null,
  2,
);

/** قارئٌ مزروعٌ: خريطةُ `مرجعٌ:مسارٌ` ← بايتاتٌ، وما ليسَ فيها معدومٌ. */
function reader(entries: Record<string, string>): GitReader {
  return {
    show: (ref, path) => entries[`${ref}:${path}`] ?? null,
    head: () => HEAD_COMMIT,
  };
}

describe("مُقابِلُ الطزاجةِ — الأحكامُ الخمسةُ", () => {
  it("مطابقٌ: بايتاتُنا هيَ بايتاتُ الرأسِ", () => {
    const outcome = judgeFile(
      PIN,
      AT_PIN,
      reader({
        [`${PIN_COMMIT}:${PIN.sourcePath}`]: AT_PIN,
        [`${HEAD_COMMIT}:${PIN.sourcePath}`]: AT_PIN,
      }),
      HEAD_COMMIT,
    );

    expect(outcome.verdict).toBe("current");
    expect(outcome.changes).toEqual([]);
  });

  it("بائتٌ: الرأسُ تقدَّمَ، ويُسمّى الحقلُ الذي صارَ مطلوباً بوصفِه كاسراً للمستهلكِ", () => {
    const outcome = judgeFile(
      PIN,
      AT_PIN,
      reader({
        [`${PIN_COMMIT}:${PIN.sourcePath}`]: AT_PIN,
        [`${HEAD_COMMIT}:${PIN.sourcePath}`]: AT_HEAD,
      }),
      HEAD_COMMIT,
    );

    expect(outcome.verdict).toBe("stale");
    const required = outcome.changes.find((change) => change.at === "required.organization_id");
    expect(required?.severity).toBe("breaking_for_consumer");
    const enumChange = outcome.changes.find((change) => change.at === "properties.state.enum");
    expect(enumChange?.severity).toBe("breaking_for_consumer");
  });

  it("نسختُنا مُحرَّرةٌ: لا تطابقُ بايتاتِ المصدرِ عندَ سندِها، ولا يُسألُ الرأسُ بعدَها", () => {
    const outcome = judgeFile(
      PIN,
      `${AT_PIN}\n`,
      reader({
        [`${PIN_COMMIT}:${PIN.sourcePath}`]: AT_PIN,
        [`${HEAD_COMMIT}:${PIN.sourcePath}`]: AT_PIN,
      }),
      HEAD_COMMIT,
    );

    expect(outcome.verdict).toBe("copy_edited");
  });

  it("المصدرُ أُزيلَ: السندُ يشيرُ إلى ما لا يُصانُ", () => {
    const outcome = judgeFile(
      PIN,
      AT_PIN,
      reader({ [`${PIN_COMMIT}:${PIN.sourcePath}`]: AT_PIN }),
      HEAD_COMMIT,
    );

    expect(outcome.verdict).toBe("source_removed");
  });

  it("سندٌ لا يُقرأُ: التزامٌ أو مسارٌ لا وجودَ له — إخفاقٌ لا صمتٌ", () => {
    const outcome = judgeFile(PIN, AT_PIN, reader({}), HEAD_COMMIT);
    expect(outcome.verdict).toBe("pin_unreadable");
  });

  it("لا يُقرأُ حكمٌ مطابقٌ إلّا في حالةٍ واحدةٍ من الخمسِ", () => {
    const verdicts = [
      judgeFile(PIN, AT_PIN, reader({}), HEAD_COMMIT).verdict,
      judgeFile(PIN, AT_PIN, reader({ [`${PIN_COMMIT}:${PIN.sourcePath}`]: AT_PIN }), HEAD_COMMIT)
        .verdict,
      judgeFile(
        PIN,
        `${AT_PIN} `,
        reader({ [`${PIN_COMMIT}:${PIN.sourcePath}`]: AT_PIN }),
        HEAD_COMMIT,
      ).verdict,
    ];
    expect(verdicts.filter((verdict) => verdict === "current")).toEqual([]);
  });
});

describe("مُقابِلُ الطزاجةِ — على مستودَعِ git حقيقيٍّ مزروعٍ", () => {
  it("يقرأُ البايتاتَ عندَ التزامٍ سابقٍ وعندَ الرأسِ، فيحكمُ بائتاً", () => {
    const dir = mkdtempSync(join(tmpdir(), "core-fake-"));
    const run = (args: readonly string[]): void => {
      const result = Bun.spawnSync(["git", "-C", dir, ...args], { stderr: "pipe" });
      if (result.exitCode !== 0) {
        throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(result.stderr)}`);
      }
    };
    run(["init", "-q", "-b", "main"]);
    run(["config", "user.email", "t@example.invalid"]);
    run(["config", "user.name", "t"]);
    mkdirSync(join(dir, "contracts/events"), { recursive: true });
    writeFileSync(join(dir, PIN.sourcePath), AT_PIN);
    run(["add", "-A"]);
    run(["commit", "-qm", "one"]);
    const first = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]);
    const pinCommit = new TextDecoder().decode(first.stdout).trim();
    writeFileSync(join(dir, PIN.sourcePath), AT_HEAD);
    run(["add", "-A"]);
    run(["commit", "-qm", "two"]);

    const gitReader = gitReaderFor(dir);
    const outcome = judgeFile({ ...PIN, commit: pinCommit }, AT_PIN, gitReader, gitReader.head());

    expect(outcome.verdict).toBe("stale");
    expect(outcome.changes.some((change) => change.at === "required.organization_id")).toBe(true);
  });
});

describe("المقابلةُ دلاليّةٌ لا نصّيّةٌ", () => {
  it("إعادةُ التنسيقِ وترتيبُ المفاتيحِ وترتيبُ `required` لا تُقرأُ اختلافاً", () => {
    const compact = JSON.stringify({
      required: ["b", "a"],
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
    });
    const pretty = JSON.stringify(
      {
        type: "object",
        properties: { b: { type: "string" }, a: { type: "string" } },
        required: ["a", "b"],
      },
      null,
      4,
    );

    expect(diffContractText("x.schema.json", compact, pretty).changes).toEqual([]);
  });

  it("قيمةٌ ساقطةٌ من العدادِ تكسِرُ المنتِجَ لا المستهلكَ — والتصنيفُ يفرِّقُ", () => {
    const before = { type: "object", properties: { s: { enum: ["a", "b"] } } };
    const after = { type: "object", properties: { s: { enum: ["a"] } } };

    const changes = diffJsonSchema(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]?.severity).toBe("breaking_for_producer");
  });

  it("تغيُّرُ الوصفِ وحدَه لا يُقرأُ كاسراً — ويُعرَضُ ولا يُكتَمُ", () => {
    const changes = diffJsonSchema(
      { type: "object", description: "قديمٌ", properties: {} },
      { type: "object", description: "جديدٌ", properties: {} },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]?.severity).toBe("editorial");
  });

  it("حدٌّ شُدِّدَ يكسِرُ المنتِجَ، وحدٌّ خُفِّفَ زيادةٌ", () => {
    const tightened = diffJsonSchema(
      { properties: { s: { type: "string", minLength: 1 } } },
      { properties: { s: { type: "string", minLength: 8 } } },
    );
    const loosened = diffJsonSchema(
      { properties: { s: { type: "string", minLength: 8 } } },
      { properties: { s: { type: "string", minLength: 1 } } },
    );

    expect(tightened[0]?.severity).toBe("breaking_for_producer");
    expect(loosened[0]?.severity).toBe("additive");
  });

  it("كلمةُ مخطَّطٍ لا تصنيفَ لها تُقرأُ كاسرةً لا مُتجاهَلةً — الصمتُ ليسَ أماناً", () => {
    const changes = diffJsonSchema(
      { properties: { s: { type: "string" } } },
      { properties: { s: { type: "string", contentEncoding: "base64" } } },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]?.severity).toBe("breaking_for_consumer");
  });

  it("YAML يُقابَلُ مُفكَّكاً فلا يُقرأُ تعليقٌ أو ترتيبٌ اختلافاً", () => {
    const diff = diffContractText(
      "t.yaml",
      "openapi: 3.1.0\npaths:\n  /a: {}\n  /b: {}\n",
      "# تعليقٌ جديدٌ\npaths:\n  /b: {}\n  /a: {}\nopenapi: 3.1.0\n",
    );

    expect(diff.format).toBe("yaml");
    expect(diff.changes).toEqual([]);
  });

  it("النثرُ يُقابَلُ نصّاً ويُصرَّحُ بأنَّه نصٌّ لا دلالةٌ", () => {
    const diff = diffContractText("t.md", "سطرٌ\n", "سطرٌ\nسطرٌ آخرُ\n");

    expect(diff.format).toBe("opaque");
    expect(diff.claim).toContain("لا تُصنِّفُه دلالةً");
    expect(diff.changes).toHaveLength(1);
  });
});
