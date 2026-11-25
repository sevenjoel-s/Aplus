import React, { useState } from 'react';
import {
  Bell,
  BellOff,
  CheckCircle2,
  Download,
  Eye,
  MailCheck,
  Smartphone,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface AccountModalProps {
  open: boolean;
  onClose: () => void;
  onOpenSubscription: () => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  open,
  onClose,
  onOpenSubscription,
}) => {
  const {
    firebaseUser,
    profile,
    privateInfo,
    notificationPermission,
    requestBrowserNotifications,
    playNotificationChime,
    triggerNotificationAlert,
    signOut,
    t,
  } = useAuth();

  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [city, setCity] = useState(profile?.city || '');
  const [phone, setPhone] = useState(privateInfo?.phone || '');
  const [emailOtpCode, setEmailOtpCode] = useState('');
  const [smsOtpCode, setSmsOtpCode] = useState('');
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [smsOtpSent, setSmsOtpSent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  React.useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '');
      setCity(profile.city || '');
    }
    if (privateInfo) {
      setPhone(privateInfo.phone || '');
    }
  }, [profile, privateInfo]);

  if (!open || !firebaseUser || !profile) return null;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setStatusMsg(null);
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        displayName: displayName.trim() || profile.displayName,
        city: city.trim() || 'Addis Ababa',
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', firebaseUser.uid, 'private', 'info'), {
        uid: firebaseUser.uid,
        email: privateInfo?.email || firebaseUser.email || '',
        phone: phone.trim(),
        phoneVerified:
          phone.trim() === (privateInfo?.phone || '')
            ? Boolean(privateInfo?.phoneVerified)
            : false,
        emailVerified: Boolean(privateInfo?.emailVerified || firebaseUser.emailVerified),
        updatedAt: serverTimestamp(),
      });
      setStatusMsg('Profile details saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const toggleSound = async () => {
    const next = profile.notificationSoundEnabled === false;
    await updateDoc(doc(db, 'users', firebaseUser.uid), {
      notificationSoundEnabled: next,
      updatedAt: serverTimestamp(),
    });
    if (next) {
      playNotificationChime('alert', true);
    }
  };

  const testAlertSound = () => {
    triggerNotificationAlert({
      title: 'Aplus Alert Sound Active',
      body: 'Notification alert tone verified on your device.',
      kind: 'received',
      playSound: false,
    });
    playNotificationChime('alert', true);
    setStatusMsg('Played notification alert sound.');
  };

  const toggleHighContrast = async () => {
    const next = !profile.accessibilityHighContrast;
    await updateDoc(doc(db, 'users', firebaseUser.uid), {
      accessibilityHighContrast: next,
      updatedAt: serverTimestamp(),
    });
  };

  const sendOtp = async (channel: 'email' | 'sms') => {
    setError(null);
    setStatusMsg(null);
    const target = channel === 'email' ? privateInfo?.email || firebaseUser.email || '' : phone.trim();
    if (!target) {
      setError(channel === 'sms' ? 'Enter a valid Ethiopian phone number first.' : 'No email found.');
      return;
    }
    try {
      const res = await apiFetch<{ configured: boolean; message: string }>('/api/otp/send', {
        method: 'POST',
        body: JSON.stringify({ channel, target }),
      });
      if (channel === 'email') setEmailOtpSent(true);
      else setSmsOtpSent(true);
      setStatusMsg(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP dispatch failed');
    }
  };

  const verifyOtp = async (channel: 'email' | 'sms') => {
    setError(null);
    setStatusMsg(null);
    const target = channel === 'email' ? privateInfo?.email || firebaseUser.email || '' : phone.trim();
    const code = channel === 'email' ? emailOtpCode.trim() : smsOtpCode.trim();
    try {
      const res = await apiFetch<{ verified: boolean; message: string }>('/api/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ channel, target, code }),
      });
      if (res.verified) {
        await updateDoc(doc(db, 'users', firebaseUser.uid, 'private', 'info'), {
          uid: firebaseUser.uid,
          email: privateInfo?.email || firebaseUser.email || '',
          phone: phone.trim(),
          phoneVerified: channel === 'sms' ? true : Boolean(privateInfo?.phoneVerified),
          emailVerified: channel === 'email' ? true : Boolean(privateInfo?.emailVerified),
          updatedAt: serverTimestamp(),
        });
        setStatusMsg(`${channel.toUpperCase()} verified successfully.`);
        if (channel === 'email') setEmailOtpSent(false);
        else setSmsOtpSent(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  const exportMyData = async () => {
    try {
      const [favSnap, histSnap, rxSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, 'favorites'), where('userUid', '==', firebaseUser.uid))),
        getDocs(query(collection(db, 'searchHistory'), where('userUid', '==', firebaseUser.uid))),
        getDocs(
          query(
            collection(db, 'prescriptionRequests'),
            where('customerUid', '==', firebaseUser.uid)
          )
        ),
        getDocs(
          query(collection(db, 'paymentTransactions'), where('uid', '==', firebaseUser.uid))
        ),
      ]);
      const exportPayload = {
        exportedAt: new Date().toISOString(),
        profile,
        privateInfo,
        favorites: favSnap.docs.map((d) => d.data()),
        searchHistory: histSnap.docs.map((d) => d.data()),
        prescriptionRequests: rxSnap.docs.map((d) => d.data()),
        paymentTransactions: paySnap.docs.map((d) => d.data()),
      };
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aplus-account-export-${firebaseUser.uid.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to export account data');
    }
  };

  const deleteAccountData = async () => {
    try {
      await deleteDoc(doc(db, 'users', firebaseUser.uid, 'private', 'info')).catch(() => {});
      await deleteDoc(doc(db, 'users', firebaseUser.uid));
      await signOut();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete account record');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full my-0 sm:my-6 max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="px-4 sm:px-6 py-4 bg-[#123F91] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold truncate">Account, Verification & Privacy</h2>
            <p className="text-xs text-blue-100 capitalize truncate">
              Role: {profile.role.replace('_', ' ')} · {privateInfo?.email || firebaseUser.email}
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
          {/* Profile Form */}
          <form onSubmit={saveProfile} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Phone Number (+251...)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+251911000000"
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-lg bg-[#123F91] text-white text-sm font-semibold hover:bg-[#0e3274] shrink-0"
              >
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>

          {/* Email & SMS OTP Verification */}
          <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-slate-50">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Identity Verification (OTP)
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <MailCheck className="w-4 h-4 text-[#123F91]" />
                <span>Email: {privateInfo?.email || firebaseUser.email}</span>
                {privateInfo?.emailVerified && (
                  <span className="text-[#43B02A] font-semibold inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void sendOtp('email')}
                className="min-h-[36px] text-[#123F91] font-semibold hover:underline"
              >
                Send Email OTP
              </button>
            </div>
            {emailOtpSent && (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={emailOtpCode}
                  onChange={(e) => setEmailOtpCode(e.target.value)}
                  placeholder="6-digit Email OTP"
                  className="flex-1 min-h-[42px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs bg-white"
                />
                <button
                  type="button"
                  onClick={() => void verifyOtp('email')}
                  className="min-h-[42px] px-4 py-1.5 rounded-lg bg-[#43B02A] text-white text-xs font-semibold"
                >
                  Verify
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-2 border-t border-slate-200">
              <div className="flex items-center gap-2 min-w-0">
                <Smartphone className="w-4 h-4 text-[#123F91] shrink-0" />
                <span className="truncate">SMS: {phone || 'Not set'}</span>
                {privateInfo?.phoneVerified && (
                  <span className="text-[#43B02A] font-semibold inline-flex items-center gap-1 shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void sendOtp('sms')}
                className="min-h-[36px] text-[#123F91] font-semibold hover:underline"
              >
                Send SMS OTP
              </button>
            </div>
            {smsOtpSent && (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={smsOtpCode}
                  onChange={(e) => setSmsOtpCode(e.target.value)}
                  placeholder="6-digit SMS OTP"
                  className="flex-1 min-h-[42px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs bg-white"
                />
                <button
                  type="button"
                  onClick={() => void verifyOtp('sms')}
                  className="min-h-[42px] px-4 py-1.5 rounded-lg bg-[#43B02A] text-white text-xs font-semibold"
                >
                  Verify
                </button>
              </div>
            )}
          </div>

          {/* Notification & Accessibility Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => void requestBrowserNotifications()}
              className="min-h-[48px] flex items-center justify-between p-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <span className="inline-flex items-center gap-2">
                {notificationPermission === 'granted' ? (
                  <Bell className="w-4 h-4 text-[#43B02A]" />
                ) : (
                  <BellOff className="w-4 h-4 text-slate-500" />
                )}
                {notificationPermission === 'granted'
                  ? t.allowNotifications + ' (On)'
                  : t.allowNotifications}
              </span>
              <span className="text-[#123F91]">Enable</span>
            </button>

            <div className="min-h-[48px] flex items-center justify-between gap-2 p-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800">
              <button
                type="button"
                onClick={() => void toggleSound()}
                className="flex-1 inline-flex items-center justify-between gap-2 text-left hover:opacity-80"
              >
                <span className="inline-flex items-center gap-2">
                  {profile.notificationSoundEnabled === false ? (
                    <VolumeX className="w-4 h-4 text-slate-500" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-[#43B02A]" />
                  )}
                  Notification Sound
                </span>
                <span className="text-[#123F91]">
                  {profile.notificationSoundEnabled === false ? 'Muted' : 'Active'}
                </span>
              </button>
              <button
                type="button"
                onClick={testAlertSound}
                className="min-h-[30px] px-2.5 py-1 rounded-lg bg-slate-100 text-[#123F91] hover:bg-blue-50 text-[11px] font-bold shrink-0"
              >
                Test
              </button>
            </div>

            <button
              type="button"
              onClick={() => void toggleHighContrast()}
              className="min-h-[48px] flex items-center justify-between p-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <span className="inline-flex items-center gap-2">
                <Eye className="w-4 h-4 text-[#123F91]" />
                High Contrast Mode
              </span>
              <span className="text-[#123F91]">
                {profile.accessibilityHighContrast ? 'On' : 'Off'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSubscription();
              }}
              className="min-h-[48px] flex items-center justify-between p-3 rounded-xl border border-blue-200 bg-blue-50/50 text-xs font-semibold text-[#123F91] hover:bg-blue-50"
            >
              <span>50 Birr Fee (1 Month)</span>
              <span className="capitalize">{profile.subscriptionStatus.replace('_', ' ')}</span>
            </button>
          </div>

          {statusMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-800">
              {statusMsg}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Data Export & Account Deletion */}
          <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void exportMyData()}
              className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="w-4 h-4 text-[#123F91]" />
              Export My Data (JSON)
            </button>

            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
                Delete Account
              </button>
            ) : (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => void deleteAccountData()}
                  className="flex-1 sm:flex-none min-h-[44px] px-3.5 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 sm:flex-none min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-medium"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
