#!/usr/bin/env bash
# LOAD-01M — تشخيصٌ بعدَ الموجةِ يُطبَعُ في سجلِّ المهمّة (أرقامٌ مجمّعةٌ بلا معرّفاتٍ ولا أسرار):
#  ١) إرسالُ تيليجرامَ لكلِّ بوت (المحاكي) ومعدّلُه، و429.
#  ٢) زمنُ وظائفِ تحديثاتِ تيليجرام (webhook → درينر) لكلِّ بوت: العدد، الحالات، p50/p95/max.
#  ٣) صندوقُ الإشعارات لكلِّ نوع: العدد، الحالات، p50/p95 تأخّرِ التسليم، والمعلَّقُ عندَ النهاية.
#  ٤) خطواتُ فشلِ تسجيلِ السائقِ (driver.onboarding_failed) مجمّعة.
#  ٥) مخالفاتُ db-audit (القاعدةُ والتفصيلُ النصّي).
#  ٦) معدّلُ الإنجازِ لكلِّ 10 ثوانٍ (ثبوتُ الإنتاجيةِ أو انهيارُها).
set -uo pipefail
RUN=${1:?RUN}; B=/srv/ceezr-cap-20261016; E=$B/runs/$RUN/evidence
PSQL="$B/bin/nsx psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -At -F | "
echo "=== DIAG mock-telegram"
$B/bin/nsx curl -s -m 5 http://127.0.0.1:58090/stats > /tmp/load01m-mock-post.json 2>/dev/null || true
python3 - "$E" <<'PY'
import json,sys,glob,os
E=sys.argv[1]
def load(p):
  try: return json.load(open(p))
  except Exception: return None
pre=load(E+'/mock-stats-pre.json') or {}
post=load('/tmp/load01m-mock-post.json') or {}
ev=[json.loads(l) for l in open(E+'/miniapp-load-events.jsonl') if l.startswith('{')]
print('mock_pre_total',pre.get('total'),'mock_post_total',post.get('total'))
bb={k:v-(pre.get('by_bot') or {}).get(k,0) for k,v in (post.get('by_bot') or {}).items()}
print('by_bot_delta',json.dumps(bb))
print('by_method',json.dumps(post.get('by_method')))
print('rejected_429',post.get('rejected_429'),'soft_private_1ps',post.get('soft_violations_private_1ps'),'soft_group_20pm',post.get('soft_violations_group_20pm'))
# معدّلُ الإنجازِ لكلِّ 10 ثوانٍ
import collections
ts=[]
for e in ev:
  if e.get('event')=='scenario.outcome':
    import datetime; x=e.get('t')
    ts.append((datetime.datetime.fromisoformat(x.replace('Z','+00:00')).timestamp()*1000,e.get('kind'),e.get('city')))
if ts:
  t0=min(a for a,_,_ in ts); b=collections.Counter(); v=collections.Counter()
  for a,k,_ in ts:
    i=int((a-t0)//10000); b[i]+=1; v[i]+= (k=='verified')
  print('outcomes_per_10s', ' '.join(f"{i*10}s:{b[i]}/{v[i]}" for i in sorted(b)))
# خطواتُ فشلِ التسجيل
st=collections.Counter()
for e in ev:
  if e.get('event')=='driver.onboarding_failed':
    s=e.get('steps') or {}
    st[json.dumps({k:(v if not isinstance(v,(int,float)) or isinstance(v,bool) else v) for k,v in s.items()},sort_keys=True)]+=1
print('onboarding_failed_step_patterns', len(st))
for k,n in st.most_common(6): print(' ',n,k[:400])
a=load(E+'/db-audit-post.json') or {}
print('db_audit',a.get('verdict'))
for x in (a.get('violations') or [])[:10]: print('  violation',x.get('rule'),str(x.get('detail'))[:300])
PY
echo "=== DIAG telegram_update_jobs (per bot)"
$B/bin/nsx psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -At -F ' | ' -c "
select bot, status, count(*),
  round(percentile_cont(0.5) within group (order by extract(epoch from completed_at-created_at))::numeric,2) p50_s,
  round(percentile_cont(0.95) within group (order by extract(epoch from completed_at-created_at))::numeric,2) p95_s,
  round(max(extract(epoch from completed_at-created_at))::numeric,2) max_s,
  round(extract(epoch from max(created_at)-min(created_at))::numeric,0) span_s
from telegram_update_jobs group by 1,2 order by 1,2" 2>&1 | head -20
echo "=== DIAG telegram_update_jobs completions per 10s (per bot)"
$B/bin/nsx psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -At -F ' ' -c "
with b as (select bot, floor(extract(epoch from completed_at - (select min(created_at) from telegram_update_jobs))/10)::int s
  from telegram_update_jobs where completed_at is not null)
select bot, string_agg(s*10||'s:'||n, ' ' order by s) from (select bot,s,count(*) n from b group by 1,2) x group by 1" 2>&1 | cut -c1-1500
echo "=== DIAG notification_outbox (per kind)"
$B/bin/nsx psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -At -F ' | ' -c "
select kind, status, count(*),
  round(percentile_cont(0.5) within group (order by extract(epoch from delivered_at-created_at))::numeric,2) p50_s,
  round(percentile_cont(0.95) within group (order by extract(epoch from delivered_at-created_at))::numeric,2) p95_s,
  round(max(extract(epoch from now()-created_at)) filter (where status in ('pending','sending'))::numeric,0) oldest_open_s
from notification_outbox group by 1,2 order by 1,2" 2>&1 | head -40
echo "=== DIAG pg_stat_statements top by total time"
$B/bin/nsx psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -At -F ' | ' -c "
select calls, round(total_exec_time::numeric,0) total_ms, round(mean_exec_time::numeric,2) mean_ms, left(regexp_replace(query,'\s+',' ','g'),140)
from pg_stat_statements order by total_exec_time desc limit 12" 2>&1 | head -14
echo "=== DIAG END"
