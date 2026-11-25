import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const STORAGE_ROOT = path.resolve(process.cwd(), 'private_storage');
const BLOBS_DIR = path.resolve(STORAGE_ROOT, 'blobs');
const META_DIR = path.resolve(STORAGE_ROOT, 'meta');
const ACCESS_LOG_FILE = path.resolve(STORAGE_ROOT, 'access_audit.jsonl');

function ensureStorageDirs() {
  for (const dir of [STORAGE_ROOT, BLOBS_DIR, META_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }
}

const EPHEMERAL_ENCRYPTION_KEY = crypto.randomBytes(32);
const EPHEMERAL_SIGNING_KEY = crypto.randomBytes(32);

function getEncryptionKey(): Buffer {
  const envKey = process.env.DOCUMENT_ENCRYPTION_KEY?.trim();
  if (envKey) {
    return crypto.createHash('sha256').update(envKey).digest();
  }
  return EPHEMERAL_ENCRYPTION_KEY;
}

function getSigningSecret(): Buffer {
  const envKey = process.env.PAYMENT_SIGNING_SECRET?.trim() || process.env.DOCUMENT_ENCRYPTION_KEY?.trim();
  if (envKey) {
    return crypto.createHash('sha256').update(envKey).digest();
  }
  return EPHEMERAL_SIGNING_KEY;
}

export interface StoredFileMeta {
  fileId: string;
  ownerUid: string;
  purpose: 'prescription' | 'medicine_image' | 'verification_doc' | 'chat_attachment';
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  ivHex: string;
  authTagHex: string;
  allowedUids: string[];
  createdAt: string;
  expiresAt: string;
}

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

export function sanitizeId(id: string): string {
  if (!SAFE_ID_REGEX.test(id)) {
    throw new Error('Invalid file identifier');
  }
  return id;
}

function resolveInside(baseDir: string, filename: string): string {
  const resolved = path.resolve(baseDir, filename);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid file path');
  }
  return resolved;
}

export function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false;
  if (mimeType === 'application/pdf') {
    return buffer.subarray(0, 4).toString('ascii') === '%PDF';
  }
  if (mimeType === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  return false;
}

export function saveEncryptedFile(params: {
  buffer: Buffer;
  ownerUid: string;
  purpose: StoredFileMeta['purpose'];
  originalName: string;
  mimeType: string;
  allowedUids?: string[];
  retentionDays?: number;
}): StoredFileMeta {
  ensureStorageDirs();
  if (!validateMagicBytes(params.buffer, params.mimeType)) {
    throw new Error('File signature does not match the declared file type');
  }

  const fileId = crypto.randomUUID().replace(/-/g, '');
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(params.buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const blobPath = resolveInside(BLOBS_DIR, `${fileId}.enc`);
  fs.writeFileSync(blobPath, encrypted, { mode: 0o600 });

  const retentionDays = params.retentionDays ?? 90;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + retentionDays * 86400 * 1000);

  const safeName = path.basename(params.originalName).replace(/[^\w.\-()\s]/g, '_').slice(0, 180) || 'document';
  const meta: StoredFileMeta = {
    fileId,
    ownerUid: params.ownerUid,
    purpose: params.purpose,
    originalName: safeName,
    mimeType: params.mimeType,
    sizeBytes: params.buffer.length,
    ivHex: iv.toString('hex'),
    authTagHex: authTag.toString('hex'),
    allowedUids: Array.from(new Set([params.ownerUid, ...(params.allowedUids || [])])),
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const metaPath = resolveInside(META_DIR, `${fileId}.json`);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });

  return meta;
}

export function getFileMeta(fileId: string): StoredFileMeta | null {
  ensureStorageDirs();
  const cleanId = sanitizeId(fileId);
  const metaPath = resolveInside(META_DIR, `${cleanId}.json`);
  if (!fs.existsSync(metaPath)) return null;
  const raw = fs.readFileSync(metaPath, 'utf8');
  return JSON.parse(raw) as StoredFileMeta;
}

export function authorizeFileRecipients(fileId: string, ownerUid: string, addUids: string[]): StoredFileMeta {
  const meta = getFileMeta(fileId);
  if (!meta) throw new Error('File not found');
  if (meta.ownerUid !== ownerUid) throw new Error('Forbidden');
  const merged = Array.from(new Set([...meta.allowedUids, ...addUids.filter(Boolean)]));
  meta.allowedUids = merged;
  const metaPath = resolveInside(META_DIR, `${meta.fileId}.json`);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  return meta;
}

export function canAccessFile(meta: StoredFileMeta, uid: string, isAdminUser: boolean): boolean {
  if (isAdminUser && meta.purpose === 'verification_doc') return true;
  if (meta.ownerUid === uid) return true;
  if (meta.allowedUids.includes(uid)) return true;
  // Admins should not unnecessarily inspect private patient prescriptions unless reviewing abuse
  return false;
}

export function createSignedDownloadToken(fileId: string, requesterUid: string, ttlSeconds = 300): string {
  const cleanId = sanitizeId(fileId);
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${cleanId}.${requesterUid}.${exp}`;
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function verifySignedDownloadToken(token: string, expectedFileId: string): { uid: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split('.');
    if (parts.length !== 4) return null;
    const [fileId, uid, expStr, sigHex] = parts;
    if (fileId !== expectedFileId) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Math.floor(Date.now() / 1000) > exp) return null;
    const expectedSig = crypto
      .createHmac('sha256', getSigningSecret())
      .update(`${fileId}.${uid}.${expStr}`)
      .digest('hex');
    const a = Buffer.from(sigHex, 'hex');
    const b = Buffer.from(expectedSig, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { uid };
  } catch {
    return null;
  }
}

export function readDecryptedFile(fileId: string): { meta: StoredFileMeta; buffer: Buffer } {
  const meta = getFileMeta(fileId);
  if (!meta) throw new Error('File not found');
  if (new Date(meta.expiresAt).getTime() < Date.now()) {
    throw new Error('Document retention period expired');
  }
  const blobPath = resolveInside(BLOBS_DIR, `${meta.fileId}.enc`);
  if (!fs.existsSync(blobPath)) throw new Error('Encrypted file blob missing');
  const encrypted = fs.readFileSync(blobPath);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(meta.ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(meta.authTagHex, 'hex'));
  const buffer = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return { meta, buffer };
}

export function deleteStoredFile(fileId: string): void {
  ensureStorageDirs();
  const cleanId = sanitizeId(fileId);
  const blobPath = resolveInside(BLOBS_DIR, `${cleanId}.enc`);
  const metaPath = resolveInside(META_DIR, `${cleanId}.json`);
  if (fs.existsSync(blobPath)) fs.unlinkSync(blobPath);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
}

export function recordFileAccessLog(entry: {
  fileId: string;
  actorUid: string;
  action: 'upload' | 'sign_url' | 'download' | 'delete';
}): void {
  ensureStorageDirs();
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
  fs.appendFileSync(ACCESS_LOG_FILE, line, { mode: 0o600 });
}
