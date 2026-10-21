/**
 * الغرض: LOAD-01 (الدفعةُ 28) — جامعُ أدلّةِ المقعد لا يُسقِطُ ملفًّا: كلُّ ما في مجلّدِ الدليلِ يُنقَل
 *   (ومنه `telegram-jobs.csv` الذي أسقطته القائمةُ البيضاءُ في الدفعة 26)، والبيانُ يطابقُ المنقولَ
 *   بالبايت، وغيابُ مُعلَنٍ يُعلَنُ ويُفشِلُ الجمعَ ولا يُبتلَع.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  collectEvidence,
  DECLARED_DEFAULT,
} from "../../deploy/capacity-run/monitor/collect-evidence.ts";

function seed(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "b28-collect-"));
  const e = join(root, "evidence");
  mkdirSync(e);
  mkdirSync(join(e, "subdir"));
  for (const [n, body] of Object.entries(files)) writeFileSync(join(e, n), body);
  return { e, d: join(root, "out") };
}

const ALL = Object.fromEntries(DECLARED_DEFAULT.map((n) => [n, `${n}\n1,2,3\n`]));

describe("الدفعة 28: جامعُ أدلّةِ المقعد", () => {
  test("telegram-jobs.csv وكلُّ ملفٍّ غيرُ مُعلَنٍ يُنقَلانِ، والبيانُ يطابقُ البايتات", () => {
    const { e, d } = seed({ ...ALL, "new-signal.jsonl": '{"k":1}\n', "gates.json": "{}" });
    const r = collectEvidence(e, d);
    expect(r.missing).toEqual([]);
    const stored = new Map(r.entries.map((x) => [x.source, x.stored]));
    expect(stored.get("telegram-jobs.csv")).toBe("telegram-jobs.csv.gz");
    expect(stored.get("new-signal.jsonl")).toBe("new-signal.jsonl.gz");
    expect(stored.get("gates.json")).toBe("gates.json");
    expect(stored.has("subdir")).toBe(false);
    expect(gunzipSync(readFileSync(join(d, "telegram-jobs.csv.gz"))).toString()).toBe(
      "telegram-jobs.csv\n1,2,3\n",
    );
    const manifest = JSON.parse(readFileSync(join(d, "MANIFEST.json"), "utf8"));
    for (const x of manifest.entries)
      expect(
        createHash("sha256")
          .update(readFileSync(join(d, x.stored)))
          .digest("hex"),
      ).toBe(x.sha256);
  });

  test("غيابُ مُعلَنٍ يُسمّى في البيانِ ويُفشِلُ الجمعَ (رمزُ خروجٍ 3)", () => {
    const partial = Object.fromEntries(
      Object.entries(ALL).filter(([n]) => n !== "telegram-jobs.csv"),
    );
    const { e, d } = seed(partial);
    expect(collectEvidence(e, d).missing).toEqual(["telegram-jobs.csv"]);
    const proc = Bun.spawnSync([
      process.execPath,
      "deploy/capacity-run/monitor/collect-evidence.ts",
      e,
      `${d}-cli`,
    ]);
    expect(proc.exitCode).toBe(3);
    expect(proc.stdout.toString()).toContain("COLLECT_MISSING telegram-jobs.csv");
  });
});
