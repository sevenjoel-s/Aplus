import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Printer,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { PaymentTransaction } from '../types';
import { formatEtb, formatTimestamp } from '../lib/geo';

interface SubscriptionModalProps {
  open: boolean;
  reason?: string | null;
  onClose: () => void;
}

interface ProviderStatus {
  id: 'chapa' | 'telebirr' | 'cbe_birr';
  name: string;
  configured: boolean;
}

export const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
  open,
  reason,
  onClose,
}) => {
  const { firebaseUser, profile, myPharmacy, subscription, settings, t } = useAuth();
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [pendingTxRef, setPendingTxRef] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isPharmacy = profile?.role === 'pharmacy' || Boolean(myPharmacy);
  const priceEtb = isPharmacy
    ? settings.pharmacyMonthlyPriceEtb || 50
    : settings.customerMonthlyPriceEtb || 50;
  const durationDays = settings.subscriptionDurationDays || 30;

  useEffect(() => {
    if (!open || !firebaseUser) return;

    apiFetch<{ providers: ProviderStatus[] }>('/api/payments/providers')
      .then((res) => setProviders(res.providers))
      .catch(() => {});

    const txQ = query(
      collection(db, 'paymentTransactions'),
      where('uid', '==', firebaseUser.uid)
    );
    const unsub = onSnapshot(txQ, (snap) => {
      const list = snap.docs.map((d) => d.data() as PaymentTransaction);
      list.sort((a, b) => String(b.txRef).localeCompare(String(a.txRef)));
      setTransactions(list);
    });

    return () => unsub();
  }, [open, firebaseUser]);

  if (!open || !firebaseUser || !profile) return null;

  const isActive =
    subscription?.status === 'active' || subscription?.status === 'expiring_soon';

  const startPayment = async (providerId: 'chapa' | 'telebirr' | 'cbe_birr') => {
    setBusy(true);
    setError(null);
    setStatusMessage(null);
    setCheckoutUrl(null);
    try {
      const purpose = subscription?.startedAt
        ? 'subscription_renewal'
        : 'subscription_activation';

      const initRes = await apiFetch<{
        configured: boolean;
        provider: 'chapa' | 'telebirr' | 'cbe_birr';
        txRef?: string;
        checkoutUrl?: string;
        instructions?: string;
        message?: string;
      }>('/api/payments/initiate', {
        method: 'POST',
        body: JSON.stringify({
          provider: providerId,
          amountEtb: priceEtb,
          durationDays,
          purpose,
        }),
      });

      if (!initRes.configured || !initRes.txRef) {
        setError(initRes.message || 'Payment provider is not configured on this server.');
        return;
      }

      await setDoc(doc(db, 'paymentTransactions', initRes.txRef), {
        txRef: initRes.txRef,
        uid: firebaseUser.uid,
        amountEtb: priceEtb,
        currency: 'ETB',
        provider: providerId,
        status: 'pending',
        purpose,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setPendingTxRef(initRes.txRef);
      if (initRes.checkoutUrl) {
        setCheckoutUrl(initRes.checkoutUrl);
      }
      setStatusMessage(
        initRes.instructions ||
          `Registration payment reference ${initRes.txRef} initiated. Complete checkout and click Verify Payment.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initiate payment');
    } finally {
      setBusy(false);
    }
  };

  const verifyPayment = async (txRef: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{
        verified: boolean;
        status: 'pending' | 'verified' | 'failed';
        amountEtb?: number;
        receiptNumber?: string;
        verificationSignature?: string;
        expiresAt?: string;
        message?: string;
      }>(`/api/payments/verify/${encodeURIComponent(txRef)}`);

      if (!res.verified) {
        setError(res.message || 'Payment has not been confirmed by the gateway yet.');
        return;
      }

      const startedAt = new Date().toISOString();
      const expiresAt =
        res.expiresAt ||
        new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

      await updateDoc(doc(db, 'paymentTransactions', txRef), {
        status: 'verified',
        receiptNumber: res.receiptNumber || txRef,
        verificationSignature: res.verificationSignature || '',
        updatedAt: serverTimestamp(),
      });

      await setDoc(
        doc(db, 'subscriptions', firebaseUser.uid),
        {
          uid: firebaseUser.uid,
          role: isPharmacy ? 'pharmacy' : 'customer',
          status: 'active',
          priceEtb,
          durationDays,
          startedAt,
          expiresAt,
          lastTxRef: txRef,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        subscriptionStatus: 'active',
        subscriptionExpiresAt: expiresAt,
        updatedAt: serverTimestamp(),
      });

      if (myPharmacy) {
        await updateDoc(doc(db, 'pharmacies', myPharmacy.id), {
          subscriptionStatus: 'active',
          subscriptionExpiresAt: expiresAt,
          updatedAt: serverTimestamp(),
        });
      }

      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await setDoc(doc(db, 'notifications', notifId), {
        recipientUid: firebaseUser.uid,
        type: 'subscription_activated',
        title: '50 Birr Registration Fee Confirmed',
        body: `Verified payment of ${formatEtb(priceEtb)} (Receipt ${res.receiptNumber}). Valid for 1 month until ${new Date(expiresAt).toLocaleDateString()}.`,
        read: false,
        createdAt: serverTimestamp(),
      });

      setStatusMessage(
        `Verified! Your 1-month registration fee is active until ${new Date(expiresAt).toLocaleDateString()}.`
      );
      setPendingTxRef(null);
      setCheckoutUrl(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment verification failed');
    } finally {
      setBusy(false);
    }
  };

  const providerLabel = (id: 'chapa' | 'telebirr' | 'cbe_birr') => {
    if (id === 'chapa') return t.payWithChapa;
    if (id === 'telebirr') return t.payWithTelebirr;
    return t.payWithCbeBirr;
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full overflow-hidden my-0 sm:my-6 max-h-[92dvh] flex flex-col">
        <div className="px-4 sm:px-6 py-4 bg-[#123F91] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold truncate">{t.subscriptionTitle}</h2>
            <p className="text-xs text-blue-100 tabular-nums truncate">
              {priceEtb} Birr ({formatEtb(priceEtb)}) · 1 Month ({durationDays} Days) · All Users & Pharmacies
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-white/10 shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 pb-safe space-y-5 flex-1 overflow-y-auto">
          {reason && !isActive && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-xs text-[#123F91] font-medium">
              {reason}
            </div>
          )}

          {/* Status Summary */}
          <div
            className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 ${
              isActive
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50'
            }`}
          >
            <div className="flex items-start gap-3">
              {isActive ? (
                <CheckCircle2 className="w-5 h-5 text-[#43B02A] shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="text-sm font-bold text-slate-900">
                  {isActive ? t.subscriptionActive : t.subscriptionExpired}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {subscription?.expiresAt
                    ? `Expires: ${formatTimestamp(subscription.expiresAt)}`
                    : `Required fee: ${priceEtb} Birr (50 ETB) for 1 month (${durationDays} days). Your account stays permanently saved when renewed.`}
                </div>
              </div>
            </div>
            <div className="sm:text-right shrink-0 pl-8 sm:pl-0">
              <div className="text-lg font-bold text-[#123F91] tabular-nums">
                {formatEtb(priceEtb)}
              </div>
              <div className="text-[11px] text-slate-500">1 month ({durationDays}d)</div>
            </div>
          </div>

          {/* Ethiopian Payment Gateways */}
          <div>
            <div className="text-sm font-semibold text-slate-900 mb-2">
              Pay {priceEtb} Birr Registration Fee via Ethiopian Gateway
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {(['chapa', 'telebirr', 'cbe_birr'] as const).map((pid) => {
                const status = providers.find((p) => p.id === pid);
                const configured = status?.configured ?? false;
                return (
                  <button
                    key={pid}
                    type="button"
                    disabled={busy}
                    onClick={() => void startPayment(pid)}
                    className={`min-h-[56px] p-3 rounded-xl border text-left transition-colors ${
                      configured
                        ? 'border-slate-300 bg-white hover:border-[#123F91] hover:bg-blue-50/40'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <CreditCard className="w-4 h-4 text-[#123F91]" />
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {configured ? 'Live' : 'Setup Req.'}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-slate-900 mt-2">
                      {providerLabel(pid)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Pending Checkout Action */}
          {pendingTxRef && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
              <div className="text-xs font-semibold text-[#123F91] break-all">
                Pending Reference: <span className="font-mono">{pendingTxRef}</span>
              </div>
              <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                {checkoutUrl && (
                  <a
                    href={checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#123F91] text-white text-xs font-semibold hover:bg-[#0e3274]"
                  >
                    Open Gateway Checkout
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void verifyPayment(pendingTxRef)}
                  className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#43B02A] text-white text-xs font-semibold hover:bg-[#389822] disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Verify Server Confirmation
                </button>
              </div>
            </div>
          )}

          {statusMessage && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
              {statusMessage}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Verified Receipts */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-slate-900">
                Registration Fee Receipts
              </div>
              {transactions.length > 0 && (
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1 text-xs text-[#123F91] hover:underline"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Receipts
                </button>
              )}
            </div>
            {transactions.length === 0 ? (
              <div className="text-xs text-slate-500 rounded-xl border border-slate-200 p-4">
                No payment transactions recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                {transactions.map((tx) => (
                  <div
                    key={tx.txRef}
                    className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 uppercase break-all sm:break-normal">
                        {tx.provider.replace('_', ' ')} ·{' '}
                        <span className="font-mono text-[11px]">{tx.txRef}</span>
                      </div>
                      <div className="text-slate-500">
                        {tx.receiptNumber ? `Receipt: ${tx.receiptNumber} · ` : ''}
                        {formatTimestamp(tx.createdAt)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                      <span className="font-bold tabular-nums text-slate-900">
                        {formatEtb(tx.amountEtb)}
                      </span>
                      <span
                        className={`font-semibold capitalize ${
                          tx.status === 'verified'
                            ? 'text-[#43B02A]'
                            : tx.status === 'pending'
                              ? 'text-amber-600'
                              : 'text-red-600'
                        }`}
                      >
                        {tx.status}
                      </span>
                      {tx.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => void verifyPayment(tx.txRef)}
                          className="min-h-[36px] px-2 text-[#123F91] underline font-medium"
                        >
                          Verify
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
