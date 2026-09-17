/**
 * بذرُ سائقٍ قادرٍ غيرُ قابلٍ للإسنادِ — لاستيفاءِ `city_served_services()`
 * دونَ أن يصيرَ الطلبُ قابلاً للمطابقةِ فعلاً.
 *
 * الحاجةُ: بعدَ D-01، مسارُ البوتِ لإنشاءِ الطلبِ يمرُّ عبرَ `request_ride()`
 * التي تتحقَّقُ من قدرةِ المدينةِ (`city_served_services`) — فلا يُنشأُ طلبٌ في
 * مدينةٍ بلا سائقٍ موثَّقٍ مشترِكٍ قادرٍ. اختباراتُ الإلغاءِ والتفاوضِ وغيرُها
 * كانت تعتمدُ على المسارَ القديمَ (إدراجٌ مباشرٌ بلا فحصِ قدرةٍ) فأصبحَت تحتاجُ
 * إلى بذرةِ سائقٍ قادرٍ لتُنشأَ الطلبَ ثم تختبرَ ما تريده.
 *
 * هذا السائقُ **لا يُطابَقُ**: لا موقعَ حيًّا ولا توفّرٌ. فهو يُشبِعُ شرطَ القدرةِ
 * ويتركُ شرطَ المطابقةِ غيرَ مستوفى — فيبقى الطلبُ في حالةِ `searching`.
 */
import type { Sql } from "../../packages/infrastructure/db/client.ts";

export interface SeedCapableDriverInput {
  readonly sql: Sql;
  readonly cityId: string;
  readonly service: "transport" | "delivery";
  readonly telegramId: number;
  readonly name?: string;
}

/**
 * يُدرجُ سائقاً موثَّقاً مشترِكاً قادراً على خدمةٍ في مدينةٍ — لكنَّهُ غيرُ متاحٍ
 * ولا يملكُ موقعاً حيًّا، فلا يصلُهُ عرضٌ ولا يُسنَدُ إليه طلبٌ.
 */
export async function seedCapableDriver(input: SeedCapableDriverInput): Promise<string> {
  const { sql, cityId, service, telegramId } = input;
  const name = input.name ?? `سائق القدرة ${telegramId}`;

  const userRows = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, language_code, role)
    values (${cityId}, ${telegramId}, ${name}, 'ar', 'driver')
    on conflict (telegram_id) do update set full_name = excluded.full_name, updated_at = now()
    returning id
  `;
  const userId = userRows[0]?.id;
  if (userId === undefined) throw new Error(`تعذّر إنشاء مستخدم السائق ${telegramId}`);

  const driverRows = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}, ${userId}, 'verified'::verification_status)
    on conflict (user_id) do update set verification_status = 'verified', updated_at = now()
    returning id
  `;
  const driverId = driverRows[0]?.id;
  if (driverId === undefined) throw new Error(`تعذّر إنشاء السائق ${telegramId}`);

  await sql`
    insert into subscriptions (city_id, driver_id, plan, status)
    values (${cityId}, ${driverId}, 'starter'::subscription_plan, 'active'::subscription_status)
    on conflict (driver_id) where status in ('trialing', 'active')
      do update set status = 'active', updated_at = now()
  `;

  await sql`
    insert into driver_capabilities (city_id, driver_id, service, is_enabled)
    values (${cityId}, ${driverId}, ${service}::service_type, true)
    on conflict (driver_id, service) do update set is_enabled = true, updated_at = now()
  `;

  return driverId;
}
