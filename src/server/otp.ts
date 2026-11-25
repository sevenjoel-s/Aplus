import crypto from 'crypto';
import nodemailer from 'nodemailer';

interface OtpRecord {
  hash: string;
  target: string;
  channel: 'email' | 'sms';
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
  sendCountHour: number;
  hourWindowStart: number;
}

const otpStore = new Map<string, OtpRecord>();

function hashOtp(uid: string, target: string, code: string): string {
  return crypto.createHash('sha256').update(`${uid}:${target}:${code}`).digest('hex');
}

function isAllowedGatewayUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host === '169.254.169.254'
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function sendVerificationOtp(params: {
  uid: string;
  channel: 'email' | 'sms';
  target: string;
}): Promise<{ sent: boolean; configured: boolean; message: string; retryAfterSeconds?: number }> {
  const key = `${params.uid}:${params.channel}`;
  const now = Date.now();
  const existing = otpStore.get(key);

  if (existing) {
    const secondsSinceLast = Math.floor((now - existing.lastSentAt) / 1000);
    if (secondsSinceLast < 60) {
      return {
        sent: false,
        configured: true,
        retryAfterSeconds: 60 - secondsSinceLast,
        message: `Please wait ${60 - secondsSinceLast} seconds before requesting another OTP.`,
      };
    }
    if (now - existing.hourWindowStart < 3600_000 && existing.sendCountHour >= 5) {
      return {
        sent: false,
        configured: true,
        message: 'Hourly OTP limit reached. Please try again later.',
      };
    }
  }

  const code = String(crypto.randomInt(100000, 999999));

  if (params.channel === 'email') {
    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();
    const port = Number(process.env.SMTP_PORT || '587');
    const from = process.env.SMTP_FROM?.trim() || user;

    if (!host || !user || !pass) {
      return {
        sent: false,
        configured: false,
        message:
          'Email OTP delivery is not configured yet. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in AI Studio Secrets.',
      };
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to: params.target,
      subject: 'Aplus Drug Finder — Verification Code',
      text: `Your Aplus Drug Finder verification code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`,
    });
  } else {
    const gatewayUrl = process.env.ETHIO_SMS_GATEWAY_URL?.trim();
    const apiKey = process.env.ETHIO_SMS_API_KEY?.trim();
    const senderId = process.env.ETHIO_SMS_SENDER_ID?.trim() || 'AplusDrug';

    if (!gatewayUrl || !apiKey) {
      return {
        sent: false,
        configured: false,
        message:
          'SMS OTP gateway is not configured yet. Set ETHIO_SMS_GATEWAY_URL and ETHIO_SMS_API_KEY in AI Studio Secrets.',
      };
    }
    if (!isAllowedGatewayUrl(gatewayUrl)) {
      return {
        sent: false,
        configured: false,
        message: 'Configured SMS gateway URL must use HTTPS and a public host.',
      };
    }

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: params.target,
        sender: senderId,
        message: `Aplus Drug Finder OTP: ${code}. Valid for 10 minutes.`,
      }),
    });

    if (!response.ok) {
      throw new Error(`SMS gateway responded with status ${response.status}`);
    }
  }

  const sameHour = existing && now - existing.hourWindowStart < 3600_000;
  otpStore.set(key, {
    hash: hashOtp(params.uid, params.target, code),
    target: params.target,
    channel: params.channel,
    expiresAt: now + 10 * 60_000,
    attempts: 0,
    lastSentAt: now,
    sendCountHour: sameHour ? existing.sendCountHour + 1 : 1,
    hourWindowStart: sameHour ? existing.hourWindowStart : now,
  });

  return {
    sent: true,
    configured: true,
    message: `Verification code sent via ${params.channel.toUpperCase()}.`,
  };
}

export function verifyOtpCode(params: {
  uid: string;
  channel: 'email' | 'sms';
  target: string;
  code: string;
}): { verified: boolean; message: string } {
  const key = `${params.uid}:${params.channel}`;
  const record = otpStore.get(key);
  if (!record) {
    return { verified: false, message: 'No active OTP found. Request a new code.' };
  }
  if (Date.now() > record.expiresAt) {
    otpStore.delete(key);
    return { verified: false, message: 'Verification code expired. Request a new code.' };
  }
  if (record.attempts >= 5) {
    otpStore.delete(key);
    return { verified: false, message: 'Maximum verification attempts exceeded. Request a new code.' };
  }
  if (record.target !== params.target) {
    return { verified: false, message: 'Verification target mismatch.' };
  }

  record.attempts += 1;
  const candidateHash = hashOtp(params.uid, params.target, params.code.trim());
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(record.hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return {
      verified: false,
      message: `Invalid code. ${Math.max(0, 5 - record.attempts)} attempts remaining.`,
    };
  }

  otpStore.delete(key);
  return { verified: true, message: 'Verification confirmed.' };
}
