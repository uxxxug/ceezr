/**
 * الغرض: محوّل Google Drive حقيقي يرفع نسخةً احتياطيةً عبر Service Account.
 *   لا يستخدم مكتبة خارجية: JWT يُوقَّع بـ Web Crypto (crypto.subtle)،
 *   والرفع بـ fetch قياسيّ — اتّساقاً مع مبدأ المشروع في أقلّ تبعيّات ممكنة.
 * الحالة: منفّذ فعلياً — البند 7.
 * ينتمي إلى: infrastructure/backup
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/backup-database.ts
 * ملاحظات مستقبلية: صلاحية الوصول محدودة بمجلد واحد فقط (folder ID)، لا المجلد
 *   الجذريّ للخدمة — اتّباعاً لمبدأ أقلّ صلاحية. ولا يُخزَّن ملف الاعتماد في
 *   المستودع أبداً: فقط في متغيّر بيئة `GOOGLE_SERVICE_ACCOUNT_JSON`.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import {
  BackupStorageError,
  type BackupStoragePort,
  type BackupUploadResult,
  type RemoteBackupFile,
} from "./backup-port.ts";

export interface GoogleDriveConfig {
  /** محتوى JSON لحساب الخدمة كاملاً (client_email + private_key). */
  readonly serviceAccountJson: string;
  /** معرّف المجلد في Drive الذي تُرفع فيه النسخ. */
  readonly folderId: string;
}

interface ServiceAccountKey {
  readonly client_email: string;
  readonly private_key: string;
}

const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const JWT_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * يوقّع RS256 JWT باستخدام Web Crypto فقط (لا مكتبة خارجية).
 * Bun وكلّ بيئة حديثة توفّر crypto.subtle.importKey وsign.
 */
async function signJwt(payload: object, key: string): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const enc = new TextEncoder();
  const headerB64 = base64Url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64Url(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    enc.encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** يحوّل مفتاح PEM (PKCS#8) إلى DER bytes. */
function pemToDer(pem: string): ArrayBuffer {
  const stripped = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(stripped);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** يصدر توكن وصول من Google بحساب الخدمة. صالح ساعةً. */
async function getAccessToken(
  config: GoogleDriveConfig,
): Promise<Result<string, BackupStorageError>> {
  let key: ServiceAccountKey;
  try {
    key = JSON.parse(config.serviceAccountJson) as ServiceAccountKey;
  } catch {
    return err(new BackupStorageError("drive.parse_key", "JSON حساب الخدمة غير صالح"));
  }
  if (!key.client_email || !key.private_key) {
    return err(new BackupStorageError("drive.parse_key", "JSON يفتقد client_email أو private_key"));
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(
    {
      iss: key.client_email,
      scope: SCOPE,
      aud: JWT_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    },
    key.private_key,
  );

  const response = await fetch(JWT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}`,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return err(
      new BackupStorageError("drive.token", `فشل إصدار التوكن: ${response.status} ${text}`),
    );
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    return err(new BackupStorageError("drive.token", "ردّ التوكن بلا access_token"));
  }
  return ok(body.access_token);
}

export function createGoogleDriveStorage(config: GoogleDriveConfig): BackupStoragePort {
  const failure = (port: string, detail: string): BackupStorageError =>
    new BackupStorageError(port, detail);

  return {
    upload: async (name, content) => {
      const token = await getAccessToken(config);
      if (!token.ok) return token;

      // رفع متعدّد الأجزاء (metadata + content) في طلبّ واحد.
      const boundary = `wasalah-${crypto.randomUUID()}`;
      const metadata = {
        name,
        parents: [config.folderId],
      };
      const prefix = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n`;
      const middle = `\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`;
      const suffix = `\r\n--${boundary}--`;
      const body = new Uint8Array([
        ...new TextEncoder().encode(prefix),
        ...new TextEncoder().encode(JSON.stringify(metadata)),
        ...new TextEncoder().encode(middle),
        ...content,
        ...new TextEncoder().encode(suffix),
      ]);

      const response = await fetch(
        `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,size,modifiedTime`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token.value}`,
            "content-type": `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return err(failure("drive.upload", `${response.status} ${text}`));
      }
      const result = (await response.json()) as { id?: string; size?: string };
      if (!result.id) {
        return err(failure("drive.upload", "الرفع لم يُعد معرّفاً"));
      }
      return ok({
        remoteFileId: result.id,
        bytes: Number(result.size ?? content.byteLength),
        uploadedAt: new Date(),
      } satisfies BackupUploadResult);
    },

    download: async (remoteFileId) => {
      const token = await getAccessToken(config);
      if (!token.ok) return token;

      const response = await fetch(`${DRIVE_FILES_URL}/${remoteFileId}?alt=media`, {
        headers: { authorization: `Bearer ${token.value}` },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return err(failure("drive.download", `${response.status} ${text}`));
      }
      return ok(new Uint8Array(await response.arrayBuffer()));
    },

    list: async () => {
      const token = await getAccessToken(config);
      if (!token.ok) return token;
      const query = encodeURIComponent(`'${config.folderId}' in parents and trashed = false`);
      const response = await fetch(
        `${DRIVE_FILES_URL}?q=${query}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime&pageSize=100`,
        { headers: { authorization: `Bearer ${token.value}` } },
      );
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return err(failure("drive.list", `${response.status} ${text}`));
      }
      const body = (await response.json()) as {
        files?: readonly { id?: string; name?: string; modifiedTime?: string }[];
      };
      const files = (body.files ?? []).map(
        (f): RemoteBackupFile => ({
          remoteFileId: f.id ?? "",
          name: f.name ?? "",
          uploadedAt: new Date(f.modifiedTime ?? Date.now()),
        }),
      );
      return ok(files);
    },

    delete: async (remoteFileId) => {
      const token = await getAccessToken(config);
      if (!token.ok) return token;
      const response = await fetch(`${DRIVE_FILES_URL}/${remoteFileId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token.value}` },
      });
      // 204 نجاح، 404 يعني أن الملف محذوف سلفاً — كلاهما نجاح من منظور الاحتفاظ.
      if (!response.ok && response.status !== 404) {
        const text = await response.text().catch(() => "");
        return err(failure("drive.delete", `${response.status} ${text}`));
      }
      return ok(undefined);
    },
  };
}
