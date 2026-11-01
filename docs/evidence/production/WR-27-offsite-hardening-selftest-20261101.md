# WR-27: تقسيةُ النسخةِ خارجَ الموقع، اختبارُ المحاكاةِ والسلبيّات (2026-11-01)

**الحزمة:** `wr-27-offsite-hardening-20261101` · **القرار:** [ADR 0298](../../adr/0298-casaos-offsite-backup-hardening.md) · **يتبعُ:** PR #713 ([`WR-27-offsite-backup-simulation-20261101.md`](WR-27-offsite-backup-simulation-20261101.md))

## الحدود

- **لم يُرفَعْ شيءٌ إلى أيِّ حسابٍ خارجيّ.** «Drive» في كلِّ الاختبارات مجلّدٌ محلّيٌّ (`type = local`) على الخادم، أو خادمُ OAuth وهميٌّ على `127.0.0.1` (`deploy/casaos/tests/mock-oauth.py`).
- **لم يُثبَّتْ شيءٌ على CasaOS.** السكربتاتُ شُغِّلت من نسخةٍ مؤقّتةٍ في `/tmp`، وبقي `/opt/wasla` و`/etc/wasla` على حالِ #713 (لا `offsite.env`، فالليليُّ `offsite-skip no_config`).
- قاعدةُ الإنتاجِ قُرئت فقط في المحاكاةِ الثانية (`pg_dump` من لقطة)، ولم يُكتَبْ فيها شيء. والاستعادةُ في حاوياتٍ `--network none` حُذفت بعدَها.
- لا مفاتيحَ حقيقيّة: مفاتيحُ age والتوقيعِ في الاختبارِ مؤقّتةٌ حُذفت. وClient ID وsecret وهميّان.
- كلُّ المساراتِ المؤقّتةِ في المقتطفاتِ أدناه مستبدَلةٌ بـ`<tmp>`.

## 1) الاختبارُ الذاتيّ: `deploy/casaos/tests/offsite-selftest.sh` على الخادم

`ssh wasla` ← `sudo bash offsite-selftest.sh OUT`، بقاعدةِ إنتاجٍ **وهميّة** (حاويةُ postgis بالصورةِ نفسِها، 4 جداول، مخطّطان، وامتداد postgis)، ومستودعٍ محلّيٍّ بدلَ Drive، ولابتوبٍ محاكى.

**النتيجة: `# selftest pass=126 fail=0`** (2026-11-01T17:25Z، على الشيفرةِ الملتزَمةِ نفسِها بعدَ shellcheck، rclone v1.75.2 · age v1.3.2 · Python 3.14.4 · OpenSSH 10.2p1).

| المجموعة | الحالات |
|---|---|
| فحصُ الأرشيفِ قبلَ الاستخراج | يقبلُ الأرشيفَ السليمَ بأشكالِه الثلاثة. ويرفضُ: `..` (سطحيّاً وعميقاً)، والمسارَ المطلق، والمجلّدَ الفرعيّ، والرابطَ الرمزيّ، والرابطَ الصلب، وFIFO، وsetuid، والملفَّ الزائد، والمكرّر، والناقص، وطابعاً آخر، والمخزنَ الناقص، وما ليس tar. والاستخراجُ نفسُه (`filter=data`) يرفضُ `..` حتّى دونَ الفحص |
| البيانُ الخارجيّ | يرفضُ: حقلاً زائداً، وصيغةً أخرى، واسماً خاطئاً، وحقلاً ناقصاً، وحقناً بسطرٍ جديد |
| قسمُ rclone من stdin | يقبلُ القسمَ السليمَ ويكتبُه 600. ويرفضُ ولا يكتبُ شيئاً عندَ: نطاقٍ غيرِ `drive.file`، ورمزٍ بلا refresh، ونقطةِ نهايةٍ مخصّصة، ومفتاحٍ مجهول، وClient ID غيرِ صالح، وقسمَين. ونقطةُ نهايةِ `127.0.0.1` لا تُقبَلُ إلّا بعلَمِ الاختبارِ الصريح |
| مقارنةُ rowstats | تطابق؛ اختلافُ عدد؛ اختلافُ محتوى بالعددِ نفسِه؛ جدولٌ ناقص؛ توقّعٌ فارغٌ ليس تطابقاً |
| اللقطة | كتابةٌ متزامنةٌ أثناءَ النسخ: `rowstats` = اللقطة (orders 2000) والحيُّ تقدّمَ إلى 2036؛ جداولُ الامتداد (`spatial_ref_sys`) مستبعَدة؛ `.sha256` باسمٍ نسبيّ |
| OAuth والربط | `connect` عبرَ ملفٍّ مؤقّتٍ و`rclone config reconnect` مقابلَ الوهميّ: تبادلُ الرمز، وتثبيتُ مفتاحِ التوقيع، و`rclone.conf` 600. ثمّ `--install` يفشلُ نظيفاً حينَ يتعذّرُ Drive، ولا يكتبُ `offsite.env`، وحُذفَ المؤقّتُ على اللابتوب |
| رمزُ الوصولِ منتهٍ | التحديثُ ينجحُ ويُحفَظ، ويبقى `rclone.conf` 600، ثمّ `offsite-fail stage=upload` (Drive محجوب)، بلا بقايا |
| رمزُ التحديثِ مُبطَل (`invalid_grant`) | `stage=upload`، بلا بقايا |
| الرمزُ غائب | `stage=upload` بلا مطالبةٍ تفاعليّة، بلا بقايا |
| Drive غيرُ متاحٍ عندَ التنزيل | `offsite-fetch.sh` يفشلُ نظيفاً |
| **الأسرارُ في argv/environ** | عيّنةٌ من `/proc/*/{cmdline,environ}` كلَّ 50ms أثناءَ connect وinstall والتحديث: **صفر**. وضابطٌ إيجابيٌّ (سرٌّ في argv عمداً) يُكتشَف |
| الرفع | تشفير، وتوقيع، ورفع، وmd5/sha256 لكلِّ ملفٍّ من الثلاثة؛ البيانُ بلا بيانات؛ بلا بقايا |
| الاستعادةُ السليمة | **PASS** بتطابقٍ تامٍّ مع اللقطة |
| الإنتاجُ تغيّرَ بعدَ النسخ | **PASS**، والفرقُ `drift-info` للعلمِ فقط |
| السلبيّات (كلٌّ FAIL، وبعدَ كلٍّ «بلا بقايا») | تلاعبٌ بالمشفّر (sha256)؛ تنزيلٌ مبتور (الحجم)؛ مفتاحٌ آخر (المستلم)؛ بيانٌ معدَّل؛ توقيعٌ غائب؛ توقيعٌ بمفتاحٍ آخر؛ نطاقُ توقيعٍ آخر؛ إعادةُ تسميةِ نسخةٍ قديمة؛ فشلُ مصادقةِ age مع توقيعٍ صالح؛ ملفٌّ ليس age؛ أرشيفٌ فيه `..`، أو رابطٌ رمزيّ، أو صلب، أو ملفٌّ زائد (`stage=archive_check`، ولم تُنشأْ قاعدة)؛ اختلافُ عددِ صفوف؛ اختلافُ محتوى بالعددِ نفسِه؛ `MANIFEST` غيرُ القيمةِ الموقَّعة؛ تفريغٌ تغيّرَ بعدَ البيان |
| `rowstats` غائبة | **INCONCLUSIVE** (رمز 3)، لا PASS |
| التمرينُ مباشرةً | stdin ليس tar، أو فارغ، أو بلا بيانٍ وتوقيع: يرفضُ قبلَ أيِّ استعادة |
| امتلاءُ الحصّة | tmpfs بـ16k: `stage=upload`، وحُذفَ الجزءُ المرفوع، و`remote_files=0` |
| بلا مفتاحِ توقيع | يرفضُ رفعَ نسخةٍ غيرِ موقَّعة |
| السجلّات | لا علامةَ سرٍّ في 97 ملفَّ سجلٍّ ومخرجٍ وjournal، ولا أسماءَ حقولِ رموز |
| **حاوياتٌ ومجلّداتٌ متبقّية** | **صفر** بعدَ كلِّ حالة |

السجلُّ الكامل (136 سطراً، بلا مساراتٍ ولا أسرار):

<details><summary>offsite-selftest.sh</summary>

```
# offsite selftest 2026-11-01T17:25:40Z host=moot rclone=v1.75.2 age=v1.3.2 python=3.14.4 ssh=OpenSSH_10.2p1
PASS  tool check-tar accepts good
PASS  tool check-tar accepts good-rowstats
PASS  tool check-tar accepts good-storage
PASS  tool check-tar rejects traversal
PASS  tool check-tar rejects traversal-deep
PASS  tool check-tar rejects absolute
PASS  tool check-tar rejects subdir
PASS  tool check-tar rejects symlink
PASS  tool check-tar rejects hardlink
PASS  tool check-tar rejects fifo
PASS  tool check-tar rejects setuid
PASS  tool check-tar rejects extra
PASS  tool check-tar rejects dup
PASS  tool check-tar rejects missing
PASS  tool check-tar rejects othertts
PASS  tool check-tar rejects storage-partial
PASS  tool check-tar rejects notatar
PASS  tool check-storage-tar accepts good
PASS  tool check-storage-tar rejects symlink
PASS  tool check-storage-tar rejects traversal
PASS  tool check-storage-tar rejects abs
PASS  tool check-config accepts good
PASS  tool check-config rejects extra
PASS  tool check-config rejects missing
PASS  tool check-config rejects traversal
PASS  tool extract (filter=data) refuses traversal even without check-tar
PASS  tool manifest accepts good
PASS  tool manifest rejects extra
PASS  tool manifest rejects fmt
PASS  tool manifest rejects name
PASS  tool manifest rejects miss
PASS  tool manifest rejects inj
PASS  tool rclone-section accepts good, mode 600
PASS  tool rclone-section rejects scope (nothing written)
PASS  tool rclone-section rejects norefresh (nothing written)
PASS  tool rclone-section rejects endpoint (nothing written)
PASS  tool rclone-section rejects unknown (nothing written)
PASS  tool rclone-section rejects cid (nothing written)
PASS  tool rclone-section rejects two (nothing written)
PASS  tool rclone-section rejects non-loopback endpoint even in test mode
PASS  tool rclone-section accepts loopback endpoint only with explicit test flag
PASS  tool compare-rowstats match
PASS  tool compare-rowstats count mismatch
PASS  tool compare-rowstats content mismatch (same count)
PASS  tool compare-rowstats missing table
PASS  tool compare-rowstats empty expected is not a match
PASS  fake prod seeded (postgis + 4 tables, 2 schemas)
PASS  backup.sh with concurrent writes during snapshot
PASS  snapshot rowstats = pg_dump snapshot (orders 2000) while live moved on (2036)
PASS  rowstats excludes extension tables (spatial_ref_sys), 4 tables
PASS  dump .sha256 uses a relative name (no absolute production path)
PASS  argv sampler positive control detects a marker in argv
PASS  connect: OAuth via temp config + reconnect, then install fails cleanly when Drive is unreachable
PASS  connect: authorization code exchanged with (mock) token endpoint
PASS  connect: server signing key pinned in laptop allowed_signers
PASS  server signing key mode 600
PASS  install wrote rclone.conf (600) from stdin section
PASS  install left no offsite.env after Drive failure (nightly stays offsite-skip)
PASS  connect: laptop temp config removed
PASS  backup with expired access token: refresh ok, Drive unreachable ⇒ fail at upload
PASS  refreshed token persisted by rclone
PASS  rclone.conf still 600 after rclone rewrote it
PASS  oauth-refresh: no leftovers
PASS  backup with revoked/expired refresh token (invalid_grant) ⇒ fail at upload
PASS  oauth-invalid: no leftovers
PASS  backup with missing token ⇒ fail at upload, no prompt
PASS  oauth-missing: no leftovers
PASS  fetch fails cleanly when Drive is unreachable
PASS  no secret in any process argv/environ during connect+install+refresh (sampled /proc every 50ms)
PASS  offsite-backup: encrypt + sign + upload + md5/sha256 verify
PASS  remote daily has ciphertext + manifest + signature
PASS  outer manifest holds no data (names/hashes only)
PASS  offsite-backup: no leftovers
PASS  restore-test: good backup ⇒ PASS (exact rowstats match with snapshot)
PASS  production changed after backup: still PASS, drift reported as information only
PASS  restore good: no leftovers
PASS  restore-test negative: tampered-ciphertext
PASS  tampered-ciphertext: no leftovers
PASS  restore-test negative: truncated-download
PASS  truncated-download: no leftovers
PASS  restore-test negative: wrong-key
PASS  wrong-key: no leftovers
PASS  restore-test negative: manifest-modified
PASS  manifest-modified: no leftovers
PASS  restore-test negative: signature-missing
PASS  signature-missing: no leftovers
PASS  restore-test negative: signature-by-other-key
PASS  signature-by-other-key: no leftovers
PASS  restore-test negative: signature-wrong-namespace
PASS  signature-wrong-namespace: no leftovers
PASS  restore-test negative: replay-renamed
PASS  replay-renamed: no leftovers
PASS  after provenance negatives: no leftovers
PASS  restore-test negative: decrypt-authentication-failure
PASS  decrypt-authentication-failure: no leftovers
PASS  restore-test negative: not-age-file
PASS  not-age-file: no leftovers
PASS  restore-test negative: archive-traversal
PASS  archive-traversal: no leftovers
PASS  restore-test negative: archive-symlink
PASS  archive-symlink: no leftovers
PASS  restore-test negative: archive-hardlink
PASS  archive-hardlink: no leftovers
Traceback (most recent call last):
  File "<stdin>", line 11, in <module>
  File "/usr/lib/python3.14/tarfile.py", line 2388, in addfile
    copyfileobj(fileobj, self.fileobj, tarinfo.size, bufsize=bufsize)
    ~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.14/tarfile.py", line 257, in copyfileobj
    raise exception("unexpected end of data")
OSError: unexpected end of data
PASS  restore-test negative: archive-extra
PASS  archive-extra: no leftovers
PASS  traversal payload never written outside the drill dir
PASS  restore-test negative: rowcount-mismatch
PASS  rowcount-mismatch: no leftovers
PASS  restore-test negative: content-mismatch-same-count
PASS  content-mismatch-same-count: no leftovers
PASS  restore-test negative: rowstats-missing-is-inconclusive
PASS  rowstats-missing-is-inconclusive: no leftovers
PASS  restore-test negative: inner-manifest-not-signed-value
PASS  inner-manifest-not-signed-value: no leftovers
PASS  restore-test negative: dump-changed-after-manifest
PASS  dump-changed-after-manifest: no leftovers
PASS  drill direct: non-tar stdin rejected before restore
PASS  drill direct: empty stdin rejected
PASS  drill direct: no manifest/signature ⇒ refuses
PASS  drill direct: no leftovers
PASS  quota exceeded on remote ⇒ fail at upload, partial remote removed
PASS  quota: no partial file left on remote
PASS  quota: no leftovers
PASS  no signing key ⇒ refuses to upload unsigned backup
PASS  no secret marker in any log/output/journal (97 files)
PASS  no token/secret field names in logs
# selftest pass=126 fail=0
```

</details>

## 2) محاكاةُ الإنتاجِ للقراءةِ فقط: `deploy/casaos/tests/offsite-prod-readonly-sim.sh`

نسخٌ حقيقيٌّ من `wasla-db-1` و`wasla-storage-db-1` ومخزنِ الوثائق والإعداد، بمفتاحَي age وتوقيعٍ مؤقّتَين، إلى «Drive» محلّيّ في `<tmp>` على الخادمِ نفسِه. ثمّ اختبارُ استعادةٍ كاملٌ من طرفِ لابتوبٍ محاكى. **لم يغادرْ شيءٌ الخادم**، وحُذفَ كلُّ شيءٍ بعدَه.

```
backup rc=0 seconds=3
backup-ok <tmp>/backups/waslah-20261101T171453Z.dump 2135316 bytes storage_files=2 storage_tar=309248
offsite-ok name=wasla-20261101T171453Z.tar.age bytes=2612024 sha256=507bfa091ade696c signed=yes drive_md5=ok drive_sha256=ok tiers=daily,monthly,weekly(seed) remote_counts: daily=1 weekly=1 monthly=1
rowstats tables app=87 storage=10
restore-test rc=0 seconds=31
fetch-ok daily/wasla-20261101T171453Z.manifest bytes=384 drive_md5=match
fetch-ok daily/wasla-20261101T171453Z.manifest.sig bytes=318 drive_md5=match
provenance-ok (توقيعُ الخادمِ صالح)
fetch-ok daily/wasla-20261101T171453Z.tar.age bytes=2612024 drive_md5=match
ciphertext-ok bytes=2612024 sha256=match
decrypt-ok
provenance-ok signer=wasla-backup backup=20261101T171453Z
tar-ok members=12 storage=yes
inner-ok files=11
config-ok files=12
storage-tar-ok files=2
integrity-ok files=11 storage=yes
rowstats tables_expected=87 tables_restored=87 rows_expected=4422 count_mismatch=0 content_mismatch=0 missing=0 extra=0 result=MATCH
app-db backup=20261101T171453Z funcs_restored=1167 funcs_live=1167 (معلوماتيّ)
drift-info tables_changed_since_backup=1 (معلوماتيّ؛ لا يؤثّرُ في النتيجة)
  changed table=public.job_heartbeats rows_backup=135 rows_live=135
storage-db rowstats tables_expected=10 tables_restored=10 rows_expected=79 count_mismatch=0 content_mismatch=0 missing=0 extra=0 result=MATCH
drill backup=20261101T171453Z files_manifest_equal=yes storage_rowstats=match object_rows=2 compared_live=2 equal_live=2 different_live=0 buckets=driver-documents:false:5242880
drill-PASS
config files=12 equal_to_live=12 changed=0 (معلوماتيّ)
offsite-drill-PASS backup=20261101T171453Z
النتيجة: PASS — استُعيدت النسخةُ وطابقت لقطةَ النسخِ تماماً
leftover containers: 0
```

- **87 جدولاً مقابلَ 88 في #713:** دليلُ #713 عدَّ `pg_tables` في `public`، وفيه الأبُ المقسَّمُ `driver_location_history` (`relkind = p`، بلا صفوفٍ خاصّة). أمّا `rowstats` فيعدُّ الجداولَ العاديّةَ (`relkind = r`)، ومنها أقسامُه الـ19. فالبياناتُ كلُّها مغطّاة. والقياسُ على الإنتاج: `relkind r` خارجَ الامتداداتِ = 87 كلُّها في `public`، و`p` = 1 بأقسامٍ 19.
- `job_heartbeats` تغيّرَ محتواه بالعددِ نفسِه بعدَ النسخ (نبضاتُ العامل)، وهذا معلوماتيّ.

## 3) لابتوبٌ حقيقيٌّ عبرَ SSH حقيقيّ: `deploy/casaos/tests/offsite-laptop-e2e-server.sh`

الخادمُ: بيئةٌ **اصطناعيّة** (قاعدةٌ وهميّةٌ فيها 300 صفّ، ومفتاحُ توقيعٍ مؤقّت، و«Drive» محلّيّ). واللابتوبُ: حاويةُ Linux منفصلةٌ (Ubuntu، OpenSSH 10.2p1، age 1.3.2) تتّصلُ بـ`ssh wasla` الحقيقيّ عبرَ Cloudflare Access، وتشغّلُ `laptop/wasla-offsite-restore-test.sh` كما هو.

| الحالة | النتيجة |
|---|---|
| نسخةٌ سليمة | `offsite-drill-PASS`، تطابقٌ تامّ (1/1 جدول، 300 صفّ)، 18 ثانية |
| مفتاحُ age آخر | FAIL «النسخةُ مشفّرةٌ لمفتاحٍ غيرِ مفتاحِك (لم يُستعَدْ شيء)» |
| مفتاحُ توقيعٍ آخرُ مثبَّت | FAIL «التوقيعُ غيرُ صالح… (لم يُستعَدْ شيء)» |
| `--list` | الملفّاتُ الثلاثةُ في كلِّ مستوى |
| 25 صفّاً أُضيفت إلى «الإنتاج» بعدَ النسخ | PASS (`rows_expected=300`، MATCH)، و`drift-info tables_changed_since_backup=1` معلوماتيّ |
| أسرارٌ في سجلّاتِ اللابتوب | 0 (`AGE-SECRET` في 4 سجلّات) |
| بقايا | 0 حاوية، و0 مجلّدٍ مؤقّتٍ على الجانبين |

ثمّ `offsite-laptop-e2e-server.sh down` ← `down-ok`.

## 4) فحوصٌ ثابتة

- `shellcheck -S warning` (v0.10.0) على كلِّ سكربتاتِ النسخِ والحقيبةِ والاختبارات: صفرُ ملاحظات. والتعديلاتُ التي أزالتها لا تغيّرُ سلوكاً: توجيهاتُ `disable` معلَّلة، و`ST="done"`، ومتغيّرُ حلقةٍ غيرُ مستعمَل.
- `bash -n` لكلِّ سكربت، و`python3 -m py_compile` لـ`offsite-tool.py` و`mock-oauth.py`.
- حقيبةُ اللابتوب: `build-kit.sh` مرّتين بـsha256 واحد (`6e11f5d3ce22046fd0f399f1eee16e6148c4804090797b2a69407d8ac0fe750d`). وداخلَها `sha256sum -c SHA256SUMS` = OK ×4، و`bash -n`، ولا ما يشبهُ سرّاً.

## 5) ما لم يُختبَر

| البند | الحالة | السبب |
|---|---|---|
| Google Drive حقيقيّ: رفعٌ وتحقّقٌ وتنزيل | NOT TESTED | يحتاجُ عميلَ OAuth بحسابِ المالك، وبعدَ اعتمادِ الخطوات |
| موافقةُ Google الفعليّة، وشاشةُ «unverified app»، وحصّةُ Drive الحقيقيّة | NOT TESTED | كالسابق |
| اللابتوبُ على macOS | NOT TESTED | الأوامرُ محمولة (`shasum` بديلٌ تلقائيّ)، دونَ تشغيل |
| اللابتوبُ على Windows (Git Bash) | NOT TESTED | لا Windows متاح. التعليماتُ في `README-AR.md` دونَ تحقّقٍ على Windows حقيقيّ |
| التثبيتُ على CasaOS (`/opt/wasla`) والتشغيلُ الليليُّ بالسكربتاتِ الجديدة | لم يُنفَّذ | ممنوعٌ في هذه المرحلةِ بالتكليف |
