/**
 * الغرض: اختبارُ سالبيّةِ حاجزِ `check-lost-item-mechanism.ts` — حاجزٌ لا يُختبَرُ
 *   سالباً حاجزٌ مُدَّعى. يُزرَعُ نصُّ هجرةٍ كاملٌ ثم يُحرَّفُ في كلِّ دعوى على حدةٍ،
 *   فيُثبَتُ أنَّ الحاجزَ يرى كلَّ خللٍ وحدهُ لا النصَّ الصحيحَ كلَّهُ.
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 * الحاكم: scripts/check-lost-item-mechanism.ts
 */

import { describe, expect, it } from "bun:test";
import {
  findViolations,
  type Migration,
  REPOSITORY_DECLARATION,
} from "../../scripts/check-lost-item-mechanism.ts";

const GOOD_FUNCTION = `
create or replace function public.open_support_ticket(
  p_telegram_id bigint, p_type support_ticket_type, p_message text,
  p_file_id text default null::text, p_order_id uuid default null::uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $function$
declare v_id uuid; v_reference text; v_lost_driver uuid; v_order_status order_status;
begin
  if p_type = 'lost_item' and p_order_id is not null then
    select o.assigned_driver_id, o.status into v_lost_driver, v_order_status
      from orders o where o.id = p_order_id;
  end if;
  if p_order_id is not null then
    if not exists (select 1 from orders o where o.id = p_order_id
      and (o.rider_id = v_rider_id or o.assigned_driver_id = v_driver_id)) then
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_YOURS');
    end if;
  end if;
  insert into support_tickets (city_id, type, message) values (v_city_id, p_type, p_message)
    returning id, reference into v_id, v_reference;
  if p_type = 'lost_item'
     and v_lost_driver is not null
     and v_order_status = 'completed' then
    perform enqueue_notification(v_city_id, 'lost_item_report',
      jsonb_build_object('ticket_id', v_id, 'driver_id', v_lost_driver),
      'lost_item:' || v_id::text);
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;
`;

const GOOD_CONSTRAINT = `
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('offer', 'order_cancelled', 'lost_item_report'));
`;

const GOOD_SEED = `
insert into notification_kind_policy (city_id, kind, channel, description_ar)
select c.id, k.kind, 'critical', k.description_ar from cities c
cross join (values ('lost_item_report', 'desc')) as k(kind, description_ar)
on conflict (city_id, kind) do nothing;
`;

function goodMigrations(): Migration[] {
  return [{ file: "20260918030000_f12_07.sql", sql: GOOD_CONSTRAINT + GOOD_SEED + GOOD_FUNCTION }];
}

describe("check-lost-item-mechanism — الحالاتُ السالبةُ المزروعةُ", () => {
  it("لا يرى خرقاً في النصِّ الكاملِ الصحيحِ", () => {
    expect(findViolations(goodMigrations(), REPOSITORY_DECLARATION)).toEqual([]);
  });

  it("يرى غيابَ النوعِ عن القيدِ", () => {
    const migrations = goodMigrations().map((m) => ({
      ...m,
      sql: m.sql.replace(", 'lost_item_report'", ""),
    }));
    expect(findViolations(migrations, REPOSITORY_DECLARATION)).toContain(
      "النوعُ «lost_item_report» ليسَ في قيدِ notification_outbox_kind_check — لا يُكتَبُ صفٌّ منه.",
    );
  });

  it("يرى غيابَ البذرِ في السياسةِ", () => {
    const migrations = goodMigrations().map((m) => ({
      ...m,
      sql: m.sql.replace(GOOD_SEED, ""),
    }));
    expect(findViolations(migrations, REPOSITORY_DECLARATION)).toContain(
      "النوعُ «lost_item_report» ليسَ مبذوراً في سياسةِ قناةٍ — لا قناةَ تُقرأُ له عندَ الإرسالِ.",
    );
  });

  it("يرى غيابَ شرطِ السائقِ المُسنَدِ", () => {
    const migrations = goodMigrations().map((m) => ({
      ...m,
      sql: m.sql.replace("and v_lost_driver is not null", ""),
    }));
    expect(findViolations(migrations, REPOSITORY_DECLARATION)).toContain(
      "open_support_ticket لا تشترطُ سائقاً مُسنَداً لإيداعِ بلاغِ المفقودِ — صفٌّ ميّتٌ يُحاولُ التسليمَ أبداً.",
    );
  });

  it("يرى غيابَ شرطِ الرحلةِ المنتهيةِ", () => {
    const migrations = goodMigrations().map((m) => ({
      ...m,
      sql: m.sql.replace("and v_order_status = 'completed'", ""),
    }));
    expect(findViolations(migrations, REPOSITORY_DECLARATION)).toContain(
      "open_support_ticket لا تشترطُ رحلةً منتهيةً («completed») لإيداعِ بلاغِ المفقودِ — بلاغٌ قبلَ انتهاءِ الرحلةِ.",
    );
  });

  it("يرى غيابَ enqueue_notification للنوعِ", () => {
    const migrations = goodMigrations().map((m) => ({
      ...m,
      sql: m.sql.replace(
        "enqueue_notification(v_city_id, 'lost_item_report'",
        "enqueue_notification(v_city_id, 'other'",
      ),
    }));
    expect(findViolations(migrations, REPOSITORY_DECLARATION)).toContain(
      "open_support_ticket لا تُودِعُ بلاغَ «lost_item_report» في معاملةِ التذكرةِ.",
    );
  });

  it("يرى غيابَ مفتاحِ منعِ التكرارِ", () => {
    const migrations = goodMigrations().map((m) => ({
      ...m,
      sql: m.sql.replace("'lost_item:' ||", "'other:' ||"),
    }));
    expect(findViolations(migrations, REPOSITORY_DECLARATION)).toContain(
      "open_support_ticket لا تُبنِي مفتاحَ منعِ التكرارِ «'lost_item:' || ticket_id».",
    );
  });

  it("يرى غيابَ تمييزِ lost_item في الدالّةِ", () => {
    const migrations = goodMigrations().map((m) => ({
      ...m,
      sql: m.sql.replace(/p_type = 'lost_item'/g, "p_type = 'other'"),
    }));
    expect(findViolations(migrations, REPOSITORY_DECLARATION)).toContain(
      "open_support_ticket لا تُفرِّقُ النوعَ «lost_item» — بلاغُ المفقودِ بلا حارسٍ.",
    );
  });

  it("يرى نزعَ ORDER_NOT_YOURS القائمَ", () => {
    const migrations = goodMigrations().map((m) => ({
      ...m,
      sql: m.sql.replace("'ORDER_NOT_YOURS'", "'OTHER'"),
    }));
    expect(findViolations(migrations, REPOSITORY_DECLARATION)).toContain(
      "open_support_ticket لا تردُّ «ORDER_NOT_YOURS» — نُزِعَ حارسُ مِلكيّةِ الطلبِ القائمُ.",
    );
  });

  it("يرى غيابَ النوعِ عن القائمةِ المغلقةِ", () => {
    const declared = { ...REPOSITORY_DECLARATION, kindDeclared: false };
    expect(findViolations(goodMigrations(), declared)).toContain(
      "النوعُ «lost_item_report» ليسَ في NOTIFICATION_KINDS — القائمةُ المغلقةُ ناقصةٌ.",
    );
  });

  it("يرى غيابَ الرتبةِ", () => {
    const declared = { ...REPOSITORY_DECLARATION, priorityDeclared: false };
    expect(findViolations(goodMigrations(), declared)).toContain(
      "النوعُ «lost_item_report» بلا رتبةٍ في NOTIFICATION_KIND_PRIORITY — يُولَدُ بلا رتبةٍ.",
    );
  });
});
