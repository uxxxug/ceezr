/**
 * الغرض: LOAD-01 (الدفعةُ 28) — جامعُ أدلّةِ المقعد يتبعُ البيانَ وحدَه: كلُّ مُعلَنٍ يُنقَلُ بطريقتِه
 *   (ومنه `telegram-jobs.csv` الذي سقطَ من أرشيفاتِ 26–27)، والبيانُ الناتجُ يطابقُ المنقولَ بالبايت،
 *   وغيابُ مطلوبٍ يُفشِلُ الجمعَ ولا يُبتلَع، وما ليس في البيانِ لا يُرفَعُ بل يُسمّى.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  collectEvidence,
  loadManifest,
} from "../../deploy/capacity-run/monitor/collect-evidence.ts";

const MANIFEST = loadManifest();

function seed(skip: readonly string[] = [], extra: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "b28-collect-"));
  const e = join(root, "evidence");
  mkdirSync(join(e, "subdir"), { recursive: true });
  for (const f of MANIFEST)
    if (!skip.includes(f.name)) writeFileSync(join(e, f.name), `${f.name}\n1,2,3\n`);
  for (const [n, body] of Object.entries(extra)) writeFileSync(join(e, n), body);
  return { e, d: join(root, "out") };
}

describe("الدفعة 28: جامعُ أدلّةِ المقعد", () => {
  test("البيانُ يُعلنُ telegram-jobs.csv مطلوبًا، وطرقُ الحفظِ كما في أرشيفِ الدفعة 27", () => {
    const by = new Map(MANIFEST.map((f) => [f.name, f]));
    expect(by.get("telegram-jobs.csv")).toEqual({
      name: "telegram-jobs.csv",
      mode: "gzip",
      required: true,
    });
    for (const n of ["resources.jsonl", "timeline.jsonl", "wave-report.json", "db-audit-post.json"])
      expect(by.get(n)?.mode).toBe("copy");
    for (const n of [
      "load-trace.jsonl",
      "update-jobs.csv",
      "pgss-full.csv",
      "miniapp-load-events.jsonl",
    ])
      expect(by.get(n)?.mode).toBe("gzip");
  });

  test("كلُّ مُعلَنٍ يُنقَلُ بطريقتِه، والبيانُ الناتجُ يطابقُ البايتات، وغيرُ المُعلَنِ يُسمّى ولا يُرفَع", () => {
    const { e, d } = seed([], { "gateway.log": "token=should-not-upload\n" });
    const r = collectEvidence(e, d, MANIFEST);
    expect(r.missing).toEqual([]);
    expect(gunzipSync(readFileSync(join(d, "telegram-jobs.csv.gz"))).toString()).toBe(
      "telegram-jobs.csv\n1,2,3\n",
    );
    expect(readFileSync(join(d, "resources.jsonl"), "utf8")).toBe("resources.jsonl\n1,2,3\n");
    expect(r.undeclaredPresent).toEqual([{ name: "gateway.log", bytes: 24 }]);
    expect(existsSync(join(d, "gateway.log"))).toBe(false);
    expect(existsSync(join(d, "gateway.log.gz"))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(d, "MANIFEST.json"), "utf8"));
    expect(manifest.entries).toHaveLength(MANIFEST.length);
    const sums = readFileSync(join(d, "SHA256SUMS"), "utf8").trim().split("\n");
    expect(sums).toHaveLength(MANIFEST.length);
    for (const line of sums) {
      const [h, name] = line.split("  ");
      expect(
        createHash("sha256")
          .update(readFileSync(join(d, name ?? "")))
          .digest("hex"),
      ).toBe(h ?? "");
    }
  });

  test("ناتجُ الجامعِ لا يُطابقُ نمطَ السلاسلِ الطويلةِ في تدقيقِ أسرارِ المقعد إلّا في SHA256SUMS (المستثنى بالتصميم)", () => {
    // نمطُ seat-bin/b24-secret-audit.py حرفًا (فرعُ التجربة): \b[A-Za-z0-9+/]{40,}={0,2}\b — وSHA256SUMS ضمنَ HASH_EVIDENCE.
    const LONG = /\b[A-Za-z0-9+/]{40,}={0,2}\b/;
    const { e, d } = seed();
    collectEvidence(e, d, MANIFEST);
    expect(readFileSync(join(d, "MANIFEST.json"), "utf8")).not.toMatch(LONG);
    expect(readFileSync(join(d, "SHA256SUMS"), "utf8")).toMatch(LONG);
  });

  test("غيابُ مطلوبٍ يُسمّى ويُفشِلُ الجمعَ (رمزُ خروجٍ 3)، وغيابُ اختياريٍّ لا يُفشِل", () => {
    const { e, d } = seed(["telegram-jobs.csv", "orders.csv"]);
    const r = collectEvidence(e, d, MANIFEST);
    expect(r.missing).toEqual(["telegram-jobs.csv"]);
    expect(r.absentOptional).toEqual(["orders.csv"]);
    const proc = Bun.spawnSync([
      process.execPath,
      "deploy/capacity-run/monitor/collect-evidence.ts",
      e,
      `${d}-cli`,
    ]);
    expect(proc.exitCode).toBe(3);
    expect(proc.stdout.toString()).toContain("COLLECT_MISSING telegram-jobs.csv");
    const ok = seed(["orders.csv"]);
    const ok2 = Bun.spawnSync([
      process.execPath,
      "deploy/capacity-run/monitor/collect-evidence.ts",
      ok.e,
      ok.d,
    ]);
    expect(ok2.exitCode).toBe(0);
  });
});
