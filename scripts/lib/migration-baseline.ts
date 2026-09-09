/**
 * # قائمةُ الهجراتِ السابقةِ للحاجزِ — مُجمَّدةٌ لا تنمو
 *
 * **الغرض:** حاجزُ سلامةِ الهجراتِ (`F7-07` / `CAP-007`) وُلِدَ ومعَه في
 * المستودعِ ثمانٌ وسبعونَ هجرةً مُطبَّقةً على الإنتاجِ فعلاً. وتطبيقُ القواعدِ
 * الجديدةِ عليها بأثرٍ رجعيٍّ **مستحيلٌ ولا معنى له**: الملفُّ المُطبَّقُ لا
 * يُعادُ كتابتُه، وتعديلُ هجرةٍ مضت تغييرٌ لتاريخٍ لا إصلاحٌ لعيبٍ.
 *
 * فالمعالجةُ **إعلانٌ مُجمَّدٌ لا إعفاءٌ مفتوحٌ**، على نمطِ أرضيّاتِ التغطيةِ
 * وسجلِّ التخطّي في هذا المستودعِ: القائمةُ أدناه هي **الدَّينُ المُعلَنُ**،
 * وعددُها مُثبَّتٌ في `tests/unit/migration-safety.test.ts` **بسقفٍ لا يعلو**.
 * وكلُّ ملفٍّ خارجَها — أي كلُّ هجرةٍ جديدةٍ — يُحاكَمُ بالقواعدِ كلِّها.
 *
 * **الحالة:** `F7-07` — مُنفَّذ · مُختبَر.
 *
 * **ينتمي إلى:** `scripts/lib`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** لا أحدَ؛ القائمةُ لا تُزادُ. وإضافةُ اسمٍ إليها
 * تعني هجرةً جديدةً أُعفِيَت من القواعدِ — وذلكَ يسقطُ في الاختبارِ بالعددِ،
 * ويُقرأُ في المراجعةِ سطراً واحداً.
 *
 * **ما لا تفعله هذه القائمةُ عن قصدٍ — وحدودُها مُعلَنةٌ لا مضمرةٌ:**
 * - **لا تقولُ إنَّ هذه الهجراتِ آمنةٌ.** تقولُ إنَّها **مضت**، وإنَّ خطرَها
 *   تاريخيٌّ لا مستقبليٌّ: منها فهارسُ أُنشئَت بقفلٍ حاجزٍ على جداولَ كانت
 *   فارغةً حينَها.
 * - **لا تُعفي من `check-migrations`.** `city_id` و`RLS` مفروضتانِ على القديمِ
 *   والجديدِ سواءً؛ الإعفاءُ ههنا في قواعدِ القفلِ والاسترجاعِ وحدَها.
 */

/**
 * حدُّ التقادمِ: كلُّ ملفٍّ بادئتُه الزمنيّةُ **قبلَ** هذا الحدِّ يجبُ أن يكونَ
 * في القائمةِ، وكلُّ ملفٍّ بعدَه يُحاكَمُ بالقواعدِ. والحدُّ نفسُه يمنعُ تأريخاً
 * إلى الوراءِ يتسلَّلُ به ملفٌّ جديدٌ إلى الدَّينِ.
 */
export const MIGRATION_SAFETY_CUTOFF = "20260909050000" as const;

/** ثمانٌ وسبعونَ هجرةً سبقَت الحاجزَ — العددُ مُثبَّتٌ في الاختبارِ. */
export const LEGACY_MIGRATIONS: readonly string[] = [
  "20260806120000_phase_2_1_core_schema.sql",
  "20260806120100_phase_2_1_atomic_rpcs.sql",
  "20260806120200_phase_2_1_seed_cities_and_settings.sql",
  "20260807100000_phase_2_3_unsubscribed_negotiation.sql",
  "20260807130000_phase_2_4_support_tickets.sql",
  "20260807170000_phase_2_5_mutual_ratings.sql",
  "20260807190000_phase_2_6_language_selection.sql",
  "20260808040000_phase_2_6_scheduled_jobs.sql",
  "20260808120000_phase_2_7_start_ride_parties.sql",
  "20260808140000_phase_2_7_admin_dashboard.sql",
  "20260808180000_phase_3_agent_measurement.sql",
  "20260809000000_phase_3_close_postgrest_surface.sql",
  "20260809001000_phase_3_close_postgrest_surface_fix.sql",
  "20260810100000_phase_5_city_group_ids_admin.sql",
  "20260810160000_phase_6_fix_login_code_race.sql",
  "20260810170000_phase_6_fix_support_ticket_cooldown_race.sql",
  "20260811060000_seed_madinah_city.sql",
  "20260811070000_unmatched_escalation_setting.sql",
  "20260811080000_driver_kyc_profile.sql",
  "20260811090000_cancel_order_fanout.sql",
  "20260811120000_driver_preferred_area.sql",
  "20260811130000_seed_remaining_cities.sql",
  "20260811140000_db_backups_table.sql",
  "20260811150000_payment_core.sql",
  "20260811160000_payment_rls_policies.sql",
  "20260811170000_city_change_rpc.sql",
  "20260812000000_phase_1_seal_definer_surface.sql",
  "20260812010000_phase_4_location_quality.sql",
  "20260812020000_phase_5_fix_recorded_at.sql",
  "20260812030000_phase_6_tracking_sessions.sql",
  "20260812040000_phase_8_driver_location_max_age.sql",
  "20260812120000_city_id_for_global_tables.sql",
  "20260812130000_subscription_cancel_and_upgrade.sql",
  "20260812150000_capabilities_follow_plan.sql",
  "20260813000000_gate_d_rating_race_and_setting_fallbacks.sql",
  "20260813010000_subscription_financial_wallets.sql",
  "20260813020000_safety_sos_outbox.sql",
  "20260813030000_backup_restore_verification.sql",
  "20260813030001_payment_webhook_integrity.sql",
  "20260813040001_secure_payment_webhook.sql",
  "20260813050000_payment_checkout_url.sql",
  "20260813060000_payment_reconciliation.sql",
  "20260813070000_safety_delivery_skip_misconfigured.sql",
  "20260813080000_seed_payment_reconcile_settings.sql",
  "20260813090000_escalation_delivery_is_the_guard.sql",
  "20260814000000_admin_broadcast.sql",
  "20260814010000_subscription_notices.sql",
  "20260814020000_expiring_soon_is_per_city.sql",
  "20260814030000_admin_setting_accepts_plain_text.sql",
  "20260814040000_reclaim_abandoned_outbox_claims.sql",
  "20260814050000_new_city_inherits_settings.sql",
  "20260814120000_fix_city_change_active_order_statuses.sql",
  "20260814130000_job_heartbeats.sql",
  "20260814140000_active_order_status_helpers.sql",
  "20260814150000_trip_tracking_tokens.sql",
  "20260814160000_claim_ride_returns_rider.sql",
  "20260814170000_revoke_order_tracking_tokens.sql",
  "20260902000000_tracking_session_sequence.sql",
  "20260903090000_open_offer_round_is_atomic.sql",
  "20260903120000_claim_ride_distinguishes_duplicate_delivery.sql",
  "20260904090000_telegram_update_receipts.sql",
  "20260905020000_open_offer_round_returns_offer_ids.sql",
  "20260905030000_notification_outbox.sql",
  "20260905030001_open_offer_round_writes_outbox.sql",
  "20260906010000_notification_outbox_unified.sql",
  "20260906020000_notification_outbox_negotiation.sql",
  "20260906030000_notification_outbox_unmatched.sql",
  "20260906040000_notification_outbox_cancellation.sql",
  "20260907090000_telegram_update_jobs.sql",
  "20260907200000_cap_003_matching_candidate_limit.sql",
  "20260908010000_unified_outbox_safety_incident.sql",
  "20260908020000_unified_outbox_subscription_notice.sql",
  "20260908020500_unified_outbox_subscription_backfill.sql",
  "20260908021000_unified_outbox_ride_cycle_claim_scope.sql",
  "20260908030000_unified_outbox_broadcast_recipient.sql",
  "20260908030500_unified_outbox_broadcast_backfill.sql",
  "20260908050000_notification_outbox_dead_letter.sql",
  "20260909040000_f6_05_notification_classification_and_center.sql",
] as const;
