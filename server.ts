import 'dotenv/config';
import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { AuthRequest, isBootstrappedAdmin, requireAuth } from './src/server/auth.ts';
import {
  authorizeFileRecipients,
  canAccessFile,
  createSignedDownloadToken,
  deleteStoredFile,
  getFileMeta,
  readDecryptedFile,
  recordFileAccessLog,
  sanitizeId,
  saveEncryptedFile,
  verifySignedDownloadToken,
} from './src/server/storage.ts';
import { sendVerificationOtp, verifyOtpCode } from './src/server/otp.ts';
import {
  getProviderAvailability,
  getUserVerifiedReceipts,
  initiatePayment,
  PaymentProvider,
  verifyChapaWebhookSignature,
  verifyPaymentWithProvider,
} from './src/server/payments.ts';
import { attachWebSocketServer } from './src/server/ws.ts';

const PORT = 3000;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB max
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      cb(new Error('Unsupported file format. Allowed: JPG, JPEG, PNG, WEBP, HEIC, PDF.'));
      return;
    }
    cb(null, true);
  },
});

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Raw body capture for Chapa webhook signature verification
  app.post(
    '/api/payments/webhook/chapa',
    express.raw({ type: 'application/json' }),
    (req: Request, res: Response) => {
      const signature = req.header('x-chapa-signature') || req.header('chapa-signature');
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
      if (!verifyChapaWebhookSignature(rawBody, signature)) {
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }
      res.status(200).json({ received: true });
    }
  );

  app.use(express.json({ limit: '2mb' }));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'aplus-drug-finder', timestamp: new Date().toISOString() });
  });

  // Private Encrypted File Upload
  app.post('/api/files/upload', requireAuth, upload.single('file'), (req: AuthRequest, res: Response) => {
    try {
      if (!req.user?.uid) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      const purposeRaw = String(req.body?.purpose || 'prescription');
      const purpose =
        purposeRaw === 'medicine_image' ||
        purposeRaw === 'verification_doc' ||
        purposeRaw === 'chat_attachment'
          ? purposeRaw
          : 'prescription';

      let allowedUids: string[] = [];
      if (typeof req.body?.allowedUids === 'string' && req.body.allowedUids.trim()) {
        allowedUids = req.body.allowedUids
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
      }

      const retentionDays = Number(req.body?.retentionDays || 90);
      const meta = saveEncryptedFile({
        buffer: req.file.buffer,
        ownerUid: req.user.uid,
        purpose,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype.toLowerCase(),
        allowedUids,
        retentionDays: Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 90,
      });

      recordFileAccessLog({
        fileId: meta.fileId,
        actorUid: req.user.uid,
        action: 'upload',
      });

      res.status(201).json({
        fileId: meta.fileId,
        originalName: meta.originalName,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        expiresAt: meta.expiresAt,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed' });
    }
  });

  // Authorize pharmacy recipients to read uploaded prescription files
  app.post('/api/files/:fileId/authorize', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const fileId = sanitizeId(String(req.params.fileId || ''));
      const allowedUids = Array.isArray(req.body?.allowedUids)
        ? req.body.allowedUids.map((u: unknown) => String(u).trim()).filter(Boolean)
        : [];
      const updated = authorizeFileRecipients(fileId, req.user!.uid, allowedUids);
      res.json({ fileId: updated.fileId, authorizedCount: updated.allowedUids.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authorization failed';
      res.status(msg === 'Forbidden' ? 403 : 400).json({ error: msg });
    }
  });

  // Generate temporary signed URL for authorized viewer
  app.post('/api/files/:fileId/sign-url', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const fileId = sanitizeId(String(req.params.fileId || ''));
      const meta = getFileMeta(fileId);
      if (!meta) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      const adminUser = isBootstrappedAdmin(req.user);
      if (!canAccessFile(meta, req.user!.uid, adminUser)) {
        res.status(403).json({ error: 'You are not authorized to access this private document.' });
        return;
      }
      const token = createSignedDownloadToken(fileId, req.user!.uid, 300);
      recordFileAccessLog({
        fileId,
        actorUid: req.user!.uid,
        action: 'sign_url',
      });
      res.json({
        url: `/api/files/${fileId}/download?token=${encodeURIComponent(token)}`,
        mimeType: meta.mimeType,
        originalName: meta.originalName,
        expiresInSeconds: 300,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate access link' });
    }
  });

  // Stream decrypted private file using short-lived signed token
  app.get('/api/files/:fileId/download', (req: Request, res: Response) => {
    try {
      const fileId = sanitizeId(String(req.params.fileId || ''));
      const token = String(req.query.token || '');
      const verified = verifySignedDownloadToken(token, fileId);
      if (!verified) {
        res.status(403).json({ error: 'Invalid or expired download link' });
        return;
      }
      const { meta, buffer } = readDecryptedFile(fileId);
      recordFileAccessLog({
        fileId,
        actorUid: verified.uid,
        action: 'download',
      });
      res.setHeader('Content-Type', meta.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${meta.originalName}"`);
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(buffer);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Document unavailable' });
    }
  });

  // Securely delete private file
  app.delete('/api/files/:fileId', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const fileId = sanitizeId(String(req.params.fileId || ''));
      const meta = getFileMeta(fileId);
      if (!meta) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      if (meta.ownerUid !== req.user!.uid && !isBootstrappedAdmin(req.user)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      deleteStoredFile(fileId);
      recordFileAccessLog({
        fileId,
        actorUid: req.user!.uid,
        action: 'delete',
      });
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Deletion failed' });
    }
  });

  // Email & SMS OTP Verification
  app.post('/api/otp/send', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const channel = req.body?.channel === 'sms' ? 'sms' : 'email';
      const target = String(req.body?.target || '').trim();
      if (!target || target.length > 200) {
        res.status(400).json({ error: 'Valid target email or phone number is required.' });
        return;
      }
      const result = await sendVerificationOtp({
        uid: req.user!.uid,
        channel,
        target,
      });
      res.status(result.configured ? 200 : 503).json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'OTP delivery failed' });
    }
  });

  app.post('/api/otp/verify', requireAuth, (req: AuthRequest, res: Response) => {
    const channel = req.body?.channel === 'sms' ? 'sms' : 'email';
    const target = String(req.body?.target || '').trim();
    const code = String(req.body?.code || '').trim();
    if (!target || !code) {
      res.status(400).json({ error: 'Target and 6-digit code are required.' });
      return;
    }
    const result = verifyOtpCode({
      uid: req.user!.uid,
      channel,
      target,
      code,
    });
    res.status(result.verified ? 200 : 400).json(result);
  });

  // Ethiopian Payment Gateways & Subscription Verification
  app.get('/api/payments/providers', requireAuth, (_req: AuthRequest, res: Response) => {
    res.json({
      providers: getProviderAvailability(),
      currency: 'ETB',
      defaultMonthlyPriceEtb: 50,
      defaultDurationDays: 30,
    });
  });

  app.get('/api/payments/receipts', requireAuth, (req: AuthRequest, res: Response) => {
    res.json({ receipts: getUserVerifiedReceipts(req.user!.uid) });
  });

  app.post('/api/payments/initiate', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const providerRaw = String(req.body?.provider || 'chapa').toLowerCase();
      const provider: PaymentProvider =
        providerRaw === 'telebirr' || providerRaw === 'cbe_birr' ? providerRaw : 'chapa';
      const amountEtb = Number(req.body?.amountEtb ?? 50);
      const durationDays = Number(req.body?.durationDays ?? 30);
      const purpose =
        req.body?.purpose === 'subscription_renewal'
          ? 'subscription_renewal'
          : 'subscription_activation';

      if (!Number.isFinite(amountEtb) || amountEtb <= 0 || amountEtb > 100000) {
        res.status(400).json({ error: 'Invalid payment amount' });
        return;
      }

      const origin = `${req.protocol}://${req.get('host')}`;
      const result = await initiatePayment({
        uid: req.user!.uid,
        email: req.user!.email || 'member@aplusdrugfinder.et',
        displayName: req.user!.name || 'Aplus Member',
        provider,
        amountEtb,
        durationDays: Number.isFinite(durationDays) && durationDays > 0 ? durationDays : 30,
        purpose,
        returnUrl: `${origin}/?payment_verify=1`,
        callbackUrl: `${origin}/api/payments/webhook/chapa`,
      });

      res.status(result.configured ? 200 : 503).json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Payment initiation failed' });
    }
  });

  app.get('/api/payments/verify/:txRef', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const txRef = String(req.params.txRef || '').trim();
      if (!txRef) {
        res.status(400).json({ error: 'Transaction reference required' });
        return;
      }
      const result = await verifyPaymentWithProvider({
        txRef,
        uid: req.user!.uid,
      });
      res.status(result.verified ? 200 : 400).json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Verification failed' });
    }
  });

  // Admin Analytics CSV / Excel Report Export
  app.post('/api/reports/csv', requireAuth, (req: AuthRequest, res: Response) => {
    if (!isBootstrappedAdmin(req.user)) {
      res.status(403).json({ error: 'Administrator access required' });
      return;
    }
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const headers = Array.isArray(req.body?.headers) ? req.body.headers : [];
    const escapeCell = (val: unknown) => {
      const s = String(val ?? '').replace(/"/g, '""');
      return `"${s}"`;
    };
    const lines = [
      headers.map(escapeCell).join(','),
      ...rows.map((r: unknown[]) => (Array.isArray(r) ? r.map(escapeCell).join(',') : '')),
    ];
    const bom = '\uFEFF';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="aplus-analytics-${Date.now()}.csv"`);
    res.send(bom + lines.join('\r\n'));
  });

  const server = http.createServer(app);
  attachWebSocketServer(server);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Aplus Drug Finder server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
