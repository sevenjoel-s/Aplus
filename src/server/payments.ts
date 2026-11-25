import crypto from 'crypto';

export type PaymentProvider = 'chapa' | 'telebirr' | 'cbe_birr';

export interface VerifiedPaymentReceipt {
  txRef: string;
  uid: string;
  amountEtb: number;
  currency: 'ETB';
  provider: PaymentProvider;
  purpose: 'subscription_activation' | 'subscription_renewal';
  receiptNumber: string;
  verifiedAt: string;
  expiresAt: string;
  verificationSignature: string;
}

const EPHEMERAL_PAYMENT_SECRET = crypto.randomBytes(32);

function getPaymentSecret(): Buffer {
  const secret = process.env.PAYMENT_SIGNING_SECRET?.trim();
  if (secret) {
    return crypto.createHash('sha256').update(secret).digest();
  }
  return EPHEMERAL_PAYMENT_SECRET;
}

const pendingTxRefs = new Map<
  string,
  {
    txRef: string;
    uid: string;
    amountEtb: number;
    provider: PaymentProvider;
    purpose: 'subscription_activation' | 'subscription_renewal';
    durationDays: number;
    createdAt: number;
  }
>();

const verifiedReceipts = new Map<string, VerifiedPaymentReceipt>();

export function getProviderAvailability(): Record<PaymentProvider, boolean> {
  return {
    chapa: Boolean(process.env.CHAPA_SECRET_KEY?.trim()),
    telebirr: Boolean(process.env.TELEBIRR_APP_ID?.trim() && process.env.TELEBIRR_APP_KEY?.trim()),
    cbe_birr: Boolean(process.env.CBE_BIRR_API_KEY?.trim() && process.env.CBE_BIRR_MERCHANT_ID?.trim()),
  };
}

export function signPaymentReceipt(receipt: Omit<VerifiedPaymentReceipt, 'verificationSignature'>): string {
  const canonical = `${receipt.txRef}|${receipt.uid}|${receipt.amountEtb}|${receipt.currency}|${receipt.provider}|${receipt.receiptNumber}|${receipt.expiresAt}`;
  return crypto.createHmac('sha256', getPaymentSecret()).update(canonical).digest('hex');
}

export async function initiatePayment(params: {
  uid: string;
  email: string;
  displayName: string;
  provider: PaymentProvider;
  amountEtb: number;
  durationDays: number;
  purpose: 'subscription_activation' | 'subscription_renewal';
  returnUrl: string;
  callbackUrl: string;
}): Promise<{
  txRef: string;
  checkoutUrl?: string;
  provider: PaymentProvider;
  configured: boolean;
  message: string;
}> {
  const availability = getProviderAvailability();
  if (!availability[params.provider]) {
    const requiredVars =
      params.provider === 'chapa'
        ? ['CHAPA_SECRET_KEY']
        : params.provider === 'telebirr'
          ? ['TELEBIRR_APP_ID', 'TELEBIRR_APP_KEY']
          : ['CBE_BIRR_API_KEY', 'CBE_BIRR_MERCHANT_ID'];
    return {
      txRef: '',
      provider: params.provider,
      configured: false,
      message: `${params.provider.toUpperCase()} merchant credentials are not configured. Set ${requiredVars.join(', ')} in AI Studio Secrets to enable live ETB checkout.`,
    };
  }

  const txRef = `APLUS_${params.provider.toUpperCase()}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  pendingTxRefs.set(txRef, {
    txRef,
    uid: params.uid,
    amountEtb: params.amountEtb,
    provider: params.provider,
    purpose: params.purpose,
    durationDays: params.durationDays,
    createdAt: Date.now(),
  });

  if (params.provider === 'chapa') {
    const nameParts = params.displayName.trim().split(/\s+/);
    const firstName = nameParts[0] || 'Aplus';
    const lastName = nameParts.slice(1).join(' ') || 'Member';
    const res = await fetch('https://api.chapa.co/v1/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: String(params.amountEtb),
        currency: 'ETB',
        email: params.email,
        first_name: firstName,
        last_name: lastName,
        tx_ref: txRef,
        callback_url: params.callbackUrl,
        return_url: params.returnUrl,
        customization: {
          title: 'Aplus Drug Finder',
          description: `Monthly Subscription (${params.durationDays} days)`,
        },
      }),
    });

    const data = (await res.json()) as { status?: string; message?: string; data?: { checkout_url?: string } };
    if (!res.ok || data.status !== 'success' || !data.data?.checkout_url) {
      pendingTxRefs.delete(txRef);
      throw new Error(data.message || 'Chapa initialization failed');
    }

    return {
      txRef,
      checkoutUrl: data.data.checkout_url,
      provider: 'chapa',
      configured: true,
      message: 'Checkout session created with Chapa.',
    };
  }

  // Telebirr / CBE Birr merchant gateway integration hooks when credentials are supplied
  return {
    txRef,
    provider: params.provider,
    configured: true,
    message: `Payment session ${txRef} initialized for ${params.provider.toUpperCase()}. Complete payment confirmation via webhook/verify.`,
  };
}

export async function verifyPaymentWithProvider(params: {
  txRef: string;
  uid: string;
}): Promise<{ verified: boolean; receipt?: VerifiedPaymentReceipt; message: string }> {
  const alreadyVerified = verifiedReceipts.get(params.txRef);
  if (alreadyVerified) {
    if (alreadyVerified.uid !== params.uid) {
      return { verified: false, message: 'Transaction ownership mismatch' };
    }
    return { verified: true, receipt: alreadyVerified, message: 'Payment already verified' };
  }

  const pending = pendingTxRefs.get(params.txRef);
  if (!pending) {
    return { verified: false, message: 'Transaction reference not found on server' };
  }
  if (pending.uid !== params.uid) {
    return { verified: false, message: 'Unauthorized transaction verification' };
  }

  if (pending.provider === 'chapa') {
    const chapaKey = process.env.CHAPA_SECRET_KEY?.trim();
    if (!chapaKey) {
      return { verified: false, message: 'CHAPA_SECRET_KEY not configured' };
    }
    const verifyRes = await fetch(`https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(params.txRef)}`, {
      headers: { Authorization: `Bearer ${chapaKey}` },
    });
    const payload = (await verifyRes.json()) as {
      status?: string;
      data?: { status?: string; amount?: string | number; currency?: string; reference?: string };
    };

    if (
      !verifyRes.ok ||
      payload.status !== 'success' ||
      payload.data?.status !== 'success' ||
      payload.data?.currency !== 'ETB' ||
      Number(payload.data?.amount) < pending.amountEtb
    ) {
      return { verified: false, message: 'Chapa transaction not yet completed or amount mismatch.' };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + pending.durationDays * 86400 * 1000);
    const unsigned: Omit<VerifiedPaymentReceipt, 'verificationSignature'> = {
      txRef: pending.txRef,
      uid: pending.uid,
      amountEtb: pending.amountEtb,
      currency: 'ETB',
      provider: 'chapa',
      purpose: pending.purpose,
      receiptNumber: payload.data?.reference || `RCP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      verifiedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    const receipt: VerifiedPaymentReceipt = {
      ...unsigned,
      verificationSignature: signPaymentReceipt(unsigned),
    };
    verifiedReceipts.set(pending.txRef, receipt);
    pendingTxRefs.delete(pending.txRef);
    return { verified: true, receipt, message: 'Payment verified by Chapa.' };
  }

  return {
    verified: false,
    message: `Awaiting live server callback verification from ${pending.provider.toUpperCase()}.`,
  };
}

export function verifyChapaWebhookSignature(rawBody: string, signatureHeader?: string): boolean {
  const secret = process.env.CHAPA_WEBHOOK_SECRET?.trim() || process.env.CHAPA_SECRET_KEY?.trim();
  if (!secret || !signatureHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signatureHeader, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function getUserVerifiedReceipts(uid: string): VerifiedPaymentReceipt[] {
  return Array.from(verifiedReceipts.values()).filter((r) => r.uid === uid);
}
