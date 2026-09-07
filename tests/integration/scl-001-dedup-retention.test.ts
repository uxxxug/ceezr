/**
 * الغرض: SCL-001 — إثبات أنّ dedup موزَّع في PostgreSQL (لا Redis) مع عمرٍ محدود.
 *   (١) `claim_telegram_update` ذرّيّة: مطالبتان متزامنتان، فائزةٌ واحدة.
 *   (٢) `finish_telegram_update` يختم بصاحب الرمز وحدَه.
 *   (٣) `cleanup_telegram_update_receipts` يحذف المختوم القديم والمهجور القديم.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const sql = DATABASE_URL ? createSql({ connectionString: DATABASE_URL }) : null;

const TEST_BOT = "rider";
const TEST_UPDATE_ID = 999001;

beforeAll(async () => {
  if (!sql) return;
  await sql`delete from telegram_update_receipts where bot = ${TEST_BOT} and update_id = ${TEST_UPDATE_ID}`;
  await sql`delete from telegram_update_receipts where bot = 'rider' and update_id in (999002, 999003, 999004, 999005)`;
});

afterAll(async () => {
  if (sql) {
    await sql`delete from telegram_update_receipts where bot = 'rider' and update_id in (${TEST_UPDATE_ID}, 999002, 999003, 999004, 999005)`;
    await sql.end();
  }
});

async function claim(db: Sql, bot: string, updateId: number) {
  const result = await db`select claim_telegram_update(${bot}, ${updateId}, 30) as result`;
  return result[0]?.result as { outcome: string; claim_token?: string };
}

async function finish(db: Sql, bot: string, updateId: number, token: string, status: string) {
  const result =
    await db`select finish_telegram_update(${bot}, ${updateId}, ${token}::uuid, ${status}, null) as result`;
  return result[0]?.result as { ok: boolean; error?: string };
}

async function getClaimToken(db: Sql, bot: string, updateId: number): Promise<string> {
  const result =
    await db`select claim_token from telegram_update_receipts where bot = ${bot} and update_id = ${updateId}`;
  return result[0]?.claim_token as string;
}

describe.skipIf(!DATABASE_URL)("SCL-001 — dedup موزَّع في PostgreSQL مع عمرٍ محدود", () => {
  let db: Sql;

  beforeAll(() => {
    if (!sql) return;
    db = sql;
  });

  it("claim_telegram_update ذرّيّة: مطالبتان متزامنتان، فائزةٌ واحدة", async () => {
    const claim1 = claim(db, TEST_BOT, TEST_UPDATE_ID);
    const claim2 = claim(db, TEST_BOT, TEST_UPDATE_ID);
    const [r1, r2] = await Promise.all([claim1, claim2]);

    const outcomes = [r1.outcome, r2.outcome].sort();
    expect(outcomes).toContain("claimed");
    expect(outcomes).toContain("in_progress");
  });

  it("finish_telegram_update يختم بصاحب الرمز وحدَه", async () => {
    const claimToken = await getClaimToken(db, TEST_BOT, TEST_UPDATE_ID);
    expect(claimToken).toBeDefined();

    const result = await finish(db, TEST_BOT, TEST_UPDATE_ID, claimToken, "done");
    expect(result.ok).toBe(true);

    /** رمزٌ آخر لا يستطيع الختم. */
    const otherToken = crypto.randomUUID();
    const failResult = await finish(db, TEST_BOT, TEST_UPDATE_ID, otherToken, "done");
    expect(failResult.ok).toBe(false);
    expect(failResult.error).toBe("NOT_CLAIMED_BY_CALLER");
  });

  it("cleanup_telegram_update_receipts يحذف المختوم القديم", async () => {
    await db`
      insert into telegram_update_receipts (bot, update_id, status, first_seen_at, completed_at)
      values ('rider', 999002, 'done', now() - interval '10 days', now() - interval '10 days')
      on conflict (bot, update_id) do update set
        status = 'done',
        completed_at = now() - interval '10 days',
        claim_token = null,
        claimed_at = null
    `;

    const result = await db`select cleanup_telegram_update_receipts() as result`;
    const cleanup = result[0]?.result as { deleted_sealed: number; deleted_abandoned: number };

    expect(cleanup.deleted_sealed).toBeGreaterThanOrEqual(1);
  });

  it("cleanup_telegram_update_receipts يحذف المهجور القديم", async () => {
    await db`
      insert into telegram_update_receipts (bot, update_id, status, first_seen_at)
      values ('rider', 999003, 'pending', now() - interval '30 hours')
      on conflict (bot, update_id) do update set
        status = 'pending',
        first_seen_at = now() - interval '30 hours'
    `;

    const result = await db`select cleanup_telegram_update_receipts() as result`;
    const cleanup = result[0]?.result as { deleted_abandoned: number };

    expect(cleanup.deleted_abandoned).toBeGreaterThanOrEqual(1);
  });

  it("cleanup لا يحذف المختوم الحديث", async () => {
    await db`
      insert into telegram_update_receipts (bot, update_id, status, first_seen_at, completed_at)
      values ('rider', 999004, 'done', now(), now())
      on conflict (bot, update_id) do update set
        status = 'done',
        completed_at = now(),
        claim_token = null,
        claimed_at = null
    `;

    await db`select cleanup_telegram_update_receipts() as result`;

    const check =
      await db`select exists(select 1 from telegram_update_receipts where bot = 'rider' and update_id = 999004) as found`;
    expect(check[0]?.found).toBe(true);
  });
});
