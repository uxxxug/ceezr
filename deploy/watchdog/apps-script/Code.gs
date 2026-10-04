// مُرسِلُ بريدِ تنبيهاتِ وَصْلة — Google Apps Script (OPS-ALERT-01).
// يُنشَرُ من حسابِ المالكِ في Gmail: Deploy ← New deployment ← Web app
//   Execute as: Me · Who has access: Anyone
// السرُّ المشتركُ يُلصَقُ مكانَ القيمةِ أدناه في نسخةِ المالكِ فقط (لا في المستودَع).
// الحصّةُ المجانيّة: نحو 100 مستلِمٍ يوميّاً لحسابِ Gmail الشخصيّ.

const SHARED_SECRET = 'PASTE_SECRET_HERE';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) return out({ ok: false, error: 'forbidden' });
    const to = (body.to || []).filter(function (x) { return /^[^@\s]+@[^@\s]+$/.test(x); }).slice(0, 5);
    if (!to.length) return out({ ok: false, error: 'no recipients' });
    if (MailApp.getRemainingDailyQuota() < to.length) return out({ ok: false, error: 'quota' });
    MailApp.sendEmail({
      to: to.join(','),
      subject: String(body.subject || 'WASLA alert').slice(0, 200),
      body: String(body.text || '').slice(0, 5000),
      name: 'WASLA Watchdog',
    });
    return out({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return out({ ok: false, error: String(err).slice(0, 200) });
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// شغّلْها مرّةً من المحرّرِ لمنحِ صلاحيّةِ الإرسال، وتصلُك رسالةُ تجربة.
function authorizeOnce() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), 'WASLA Watchdog — تفعيل', 'تم منح صلاحية الإرسال.');
}
