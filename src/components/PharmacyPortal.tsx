import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  Eye,
  FileCheck2,
  MapPin,
  MessageSquare,
  Phone,
  ShieldAlert,
  Timer,
  Upload,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
import { getSignedFileUrl, uploadEncryptedFile } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  Conversation,
  PrescriptionAssignment,
  PrescriptionStatus,
} from '../types';
import { ETHIOPIA_LOCATIONS } from '../data/ethiopiaCatalog';
import { formatEtb, formatTimestamp } from '../lib/geo';
import { PharmacyMap } from './PharmacyMap';

interface PharmacyPortalProps {
  onOpenChat: (conv: Conversation, callMode?: 'audio' | 'video' | null) => void;
  onOpenSubscription: (reason?: string) => void;
}

export const PharmacyPortal: React.FC<PharmacyPortalProps> = ({
  onOpenChat,
  onOpenSubscription,
}) => {
  const {
    firebaseUser,
    profile,
    isAdmin,
    myPharmacy,
    subscription,
    settings,
    sendWsEvent,
    triggerNotificationAlert,
  } = useAuth();
  const [tab, setTab] = useState<'prescriptions' | 'profile'>('prescriptions');

  // Registration state (when !myPharmacy)
  const [regName, setRegName] = useState('');
  const [regPharmacist, setRegPharmacist] = useState(profile?.displayName || '');
  const [regLicense, setRegLicense] = useState('');
  const [regRegion, setRegRegion] = useState('Addis Ababa');
  const [regCity, setRegCity] = useState('Addis Ababa');
  const [regSubCity, setRegSubCity] = useState('');
  const [regWoreda, setRegWoreda] = useState('');
  const [regStreet, setRegStreet] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regHours, setRegHours] = useState('Mon–Sun: 08:00 – 21:00');
  const [regCoords, setRegCoords] = useState<{ lat: number; lng: number }>({
    lat: 9.0192,
    lng: 38.7525,
  });
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [regSubmitting, setRegSubmitting] = useState(false);

  // Dashboard data
  const [assignments, setAssignments] = useState<PrescriptionAssignment[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  // Prescription response modal
  const [activeRx, setActiveRx] = useState<PrescriptionAssignment | null>(null);
  const [rxStatus, setRxStatus] = useState<PrescriptionStatus>('available');
  const [rxPrice, setRxPrice] = useState('');
  const [rxPrepMins, setRxPrepMins] = useState('15');
  const [rxNotes, setRxNotes] = useState('');
  const [viewedDoc, setViewedDoc] = useState<{
    url: string;
    name: string;
    mimeType: string;
  } | null>(null);

  // Profile editor state
  const [editHours, setEditHours] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editStreet, setEditStreet] = useState('');
  const [editCoords, setEditCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const regions = useMemo(() => {
    const s = new Set<string>();
    ETHIOPIA_LOCATIONS.forEach((l) => s.add(l.region));
    return Array.from(s);
  }, []);

  const hasActiveFee =
    isAdmin ||
    subscription?.status === 'active' ||
    subscription?.status === 'expiring_soon';
  const feeAmount = settings.pharmacyMonthlyPriceEtb || 50;

  useEffect(() => {
    if (myPharmacy) {
      setEditHours(myPharmacy.openingHours || '');
      setEditPhone(myPharmacy.phone || '');
      setEditStreet(myPharmacy.street || '');
      if (typeof myPharmacy.lat === 'number' && typeof myPharmacy.lng === 'number') {
        setEditCoords({ lat: myPharmacy.lat, lng: myPharmacy.lng });
      }
    }
  }, [myPharmacy]);

  useEffect(() => {
    if (!firebaseUser || !myPharmacy) {
      setAssignments([]);
      setConversations([]);
      return;
    }

    const rxQ = query(
      collection(db, 'prescriptionAssignments'),
      where('pharmacyOwnerUid', '==', firebaseUser.uid)
    );
    const unsubRx = onSnapshot(rxQ, (snap) => {
      const list = snap.docs.map(
        (d) => ({ ...d.data(), id: d.id } as PrescriptionAssignment)
      );
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      setAssignments(list);
    });

    const convQ = query(
      collection(db, 'conversations'),
      where('pharmacyOwnerUid', '==', firebaseUser.uid)
    );
    const unsubConv = onSnapshot(convQ, (snap) => {
      const list = snap.docs.map((d) => ({ ...d.data(), id: d.id } as Conversation));
      setConversations(list);
    });

    return () => {
      unsubRx();
      unsubConv();
    };
  }, [firebaseUser, myPharmacy]);

  const pharmacyAnalytics = useMemo(() => {
    const toMillis = (val: unknown): number | null => {
      if (!val) return null;
      if (typeof val === 'number' && Number.isFinite(val)) return val;
      if (val instanceof Date) return val.getTime();
      if (typeof val === 'string') {
        const parsed = Date.parse(val);
        return Number.isNaN(parsed) ? null : parsed;
      }
      if (typeof val === 'object') {
        const obj = val as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
        if (typeof obj.toMillis === 'function') return obj.toMillis();
        if (typeof obj.seconds === 'number') {
          return obj.seconds * 1000 + Math.round((obj.nanoseconds || 0) / 1e6);
        }
      }
      return null;
    };

    const pendingStatuses = new Set<PrescriptionStatus>([
      'submitted',
      'received',
      'under_review',
      'clarification_required',
    ]);
    const pendingRequests = assignments.filter((a) => pendingStatuses.has(a.status)).length;
    const respondedAssignments = assignments.filter(
      (a) => a.status !== 'submitted' && a.status !== 'received'
    );

    const responseSamples: { label: string; minutes: number }[] = [];
    respondedAssignments.forEach((a, idx) => {
      const createdMs = toMillis(a.createdAt);
      const updatedMs = toMillis(a.updatedAt);
      if (createdMs !== null && updatedMs !== null && updatedMs >= createdMs) {
        const mins = Math.max(1, Math.round((updatedMs - createdMs) / 60000));
        responseSamples.push({
          label: a.customerName ? a.customerName.split(' ')[0] : `#${idx + 1}`,
          minutes: mins,
        });
      }
    });

    const avgResponseMinutes =
      responseSamples.length > 0
        ? Math.round(
            responseSamples.reduce((sum, s) => sum + s.minutes, 0) / responseSamples.length
          )
        : null;

    const formatDuration = (mins: number | null): string => {
      if (mins === null) return '—';
      if (mins < 60) return `${mins} min`;
      const hrs = (mins / 60).toFixed(1);
      return `${hrs} hr`;
    };

    const summaryBarData = [
      { metric: 'Pending', count: pendingRequests, fill: '#123F91' },
      { metric: 'Responded', count: respondedAssignments.length, fill: '#43B02A' },
      { metric: 'Conversations', count: conversations.length, fill: '#0ea5e9' },
    ];

    return {
      pendingRequests,
      totalConversations: conversations.length,
      respondedCount: respondedAssignments.length,
      avgResponseMinutes,
      avgResponseLabel: formatDuration(avgResponseMinutes),
      summaryBarData,
      responseTrendData: responseSamples.slice(0, 8).reverse(),
    };
  }, [assignments, conversations]);

  if (!firebaseUser || !profile) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <Building2 className="w-10 h-10 text-[#123F91] mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">Pharmacy Portal</h2>
        <p className="text-sm text-slate-600 mt-1">
          Sign in with your Google account and pay the {feeAmount} Birr 1-month registration fee to register your Ethiopian pharmacy.
        </p>
      </div>
    );
  }

  const handleUseMyGps = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (myPharmacy) setEditCoords(coords);
        else setRegCoords(coords);
      },
      () => setError('Unable to read GPS coordinates. Click the map directly to set location.')
    );
  };

  const handleRegisterPharmacy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasActiveFee) {
      onOpenSubscription(
        `Please pay the ${feeAmount} Birr registration fee for 1 month before submitting your pharmacy registration.`
      );
      return;
    }
    if (!regName.trim() || !regLicense.trim() || !regPhone.trim()) {
      setError('Pharmacy name, EFDA license number, and phone number are required.');
      return;
    }
    if (!licenseFile) {
      setError('Please upload your EFDA pharmacy license / verification document.');
      return;
    }

    setRegSubmitting(true);
    setError(null);
    setStatusMsg(null);
    try {
      const pharmacyId = `pharm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const uploaded = await uploadEncryptedFile({
        file: licenseFile,
        purpose: 'verification_doc',
        allowedUids: [],
      });

      await setDoc(doc(db, 'pharmacies', pharmacyId), {
        id: pharmacyId,
        ownerUid: firebaseUser.uid,
        name: regName.trim(),
        ownerPharmacistName: regPharmacist.trim() || profile.displayName || 'Lead Pharmacist',
        licenseNumber: regLicense.trim(),
        region: regRegion.trim(),
        city: regCity.trim(),
        subCity: regSubCity.trim(),
        woreda: regWoreda.trim(),
        street: regStreet.trim(),
        lat: regCoords.lat,
        lng: regCoords.lng,
        phone: regPhone.trim(),
        email: firebaseUser.email || '',
        openingHours: regHours.trim(),
        verificationStatus: 'pending',
        ratingAvg: 0,
        ratingCount: 0,
        subscriptionStatus:
          subscription?.status ||
          (profile.subscriptionStatus === 'free_tier' ? 'expired' : profile.subscriptionStatus),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'pharmacies', pharmacyId, 'verificationDocs', uploaded.fileId), {
        pharmacyId,
        ownerUid: firebaseUser.uid,
        fileId: uploaded.fileId,
        fileName: uploaded.originalName,
        docType: 'EFDA_LICENSE',
        uploadedAt: serverTimestamp(),
      });

      setStatusMsg(
        'Pharmacy registration submitted! An Aplus administrator will review your license before public listing.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pharmacy registration failed');
    } finally {
      setRegSubmitting(false);
    }
  };

  if (!myPharmacy) {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 space-y-6">
        <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-[#123F91]">
              Register Your Ethiopian Pharmacy
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">
              Submit your pharmacy license and GPS coordinates. Registration fee: {feeAmount} Birr for 1 month.
            </p>
          </div>
          {!hasActiveFee && (
            <button
              type="button"
              onClick={() =>
                onOpenSubscription(
                  `Pay the ${feeAmount} Birr registration fee (1 month) to register and operate your pharmacy on Aplus.`
                )
              }
              className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#43B02A] text-white text-xs font-bold hover:bg-[#389822] shrink-0"
            >
              <CreditCard className="w-4 h-4" />
              Pay {feeAmount} Birr Fee (1 Month)
            </button>
          )}
        </div>

        <form onSubmit={handleRegisterPharmacy} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Pharmacy Name *
              </label>
              <input
                required
                type="text"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="e.g. Selam Community Pharmacy"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Owner / Authorized Pharmacist *
              </label>
              <input
                required
                type="text"
                value={regPharmacist}
                onChange={(e) => setRegPharmacist(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                EFDA / Regional License Number *
              </label>
              <input
                required
                type="text"
                value={regLicense}
                onChange={(e) => setRegLicense(e.target.value)}
                placeholder="e.g. EFDA-AA-2025-4412"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Pharmacy Phone *
              </label>
              <input
                required
                type="tel"
                value={regPhone}
                onChange={(e) => setRegPhone(e.target.value)}
                placeholder="+25111..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Region *
              </label>
              <select
                value={regRegion}
                onChange={(e) => setRegRegion(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                City / Town *
              </label>
              <input
                required
                type="text"
                value={regCity}
                onChange={(e) => setRegCity(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Sub-city / Zone
              </label>
              <input
                type="text"
                value={regSubCity}
                onChange={(e) => setRegSubCity(e.target.value)}
                placeholder="e.g. Bole"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Woreda / Street / Landmark
              </label>
              <input
                type="text"
                value={regStreet}
                onChange={(e) => setRegStreet(e.target.value)}
                placeholder="e.g. Cameroon St, near Medhanialem"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Operating Hours
            </label>
            <input
              type="text"
              value={regHours}
              onChange={(e) => setRegHours(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-700">
                Pin Exact Pharmacy GPS Coordinates (Tap map or use GPS)
              </label>
              <button
                type="button"
                onClick={handleUseMyGps}
                className="min-h-[36px] inline-flex items-center gap-1 text-xs font-semibold text-[#123F91] hover:underline self-start sm:self-auto"
              >
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                Use Current GPS ({regCoords.lat.toFixed(4)}, {regCoords.lng.toFixed(4)})
              </button>
            </div>
            <PharmacyMap
              pharmacies={[]}
              userLocation={regCoords}
              selectedPharmacy={null}
              onSelectPharmacy={() => {}}
              routeTarget={null}
              pickMode
              pickedCoords={regCoords}
              onPickCoords={setRegCoords}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Upload License / Verification Document (PDF, JPG, PNG) *
            </label>
            <label className="min-h-[48px] flex items-center gap-3 p-3.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 cursor-pointer hover:bg-slate-100">
              <Upload className="w-5 h-5 text-[#123F91] shrink-0" />
              <span className="text-xs text-slate-700 truncate">
                {licenseFile ? licenseFile.name : 'Select encrypted verification document...'}
              </span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,image/*,application/pdf"
                className="hidden"
                onChange={(e) => setLicenseFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
              {error}
            </div>
          )}
          {statusMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
              {statusMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={regSubmitting}
            className="w-full min-h-[48px] py-3 rounded-xl bg-[#123F91] text-white text-sm font-bold hover:bg-[#0e3274] disabled:opacity-50"
          >
            {regSubmitting ? 'Submitting Verification...' : 'Submit Pharmacy Registration'}
          </button>
        </form>
      </div>
    );
  }

  const handleViewPrivateFile = async (fileId: string) => {
    try {
      const res = await getSignedFileUrl(fileId);
      setViewedDoc({ url: res.url, name: res.originalName, mimeType: res.mimeType });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open encrypted medical file');
    }
  };

  const handleSubmitRxResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRx) return;
    if (!hasActiveFee) {
      onOpenSubscription(
        `Pay the ${feeAmount} Birr 1-month registration fee to respond to prescription requests.`
      );
      return;
    }
    setError(null);
    try {
      const updatePayload: Record<string, unknown> = {
        status: rxStatus,
        responseNotes: rxNotes.trim(),
        updatedAt: serverTimestamp(),
      };
      if (rxPrice.trim() && Number.isFinite(Number(rxPrice))) {
        updatePayload.estimatedTotalEtb = Math.max(0, Number(rxPrice));
      }
      if (rxPrepMins.trim() && Number.isFinite(Number(rxPrepMins))) {
        updatePayload.estimatedPrepMinutes = Math.max(0, Number(rxPrepMins));
      }

      await updateDoc(doc(db, 'prescriptionAssignments', activeRx.id), updatePayload);

      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const title = `Pharmacy Response: ${myPharmacy.name}`;
      const body = `Status updated to "${rxStatus.replace('_', ' ')}"${
        updatePayload.estimatedTotalEtb !== undefined
          ? ` · Quote: ${formatEtb(Number(updatePayload.estimatedTotalEtb))}`
          : ''
      }.`;
      await setDoc(doc(db, 'notifications', notifId), {
        recipientUid: activeRx.customerUid,
        type: 'prescription_response',
        title,
        body,
        read: false,
        createdAt: serverTimestamp(),
      });
      sendWsEvent({
        type: 'notification:push',
        targetUid: activeRx.customerUid,
        notification: {
          title,
          body,
          type: 'prescription_response',
        },
      });
      triggerNotificationAlert({
        title: 'Customer Alert Sent',
        body: `Notified ${activeRx.customerName || 'customer'} about availability & quote.`,
        kind: 'sent',
      });

      setActiveRx(null);
      setStatusMsg('Customer notified with pharmacy availability & quote.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit prescription response');
    }
  };

  const openChatWithCustomer = async (
    assignment: PrescriptionAssignment,
    callMode?: 'audio' | 'video' | null
  ) => {
    if (!hasActiveFee) {
      onOpenSubscription(
        `Pay the ${feeAmount} Birr 1-month registration fee to message or call customers.`
      );
      return;
    }
    const convId = `${assignment.customerUid}_${myPharmacy.id}`;
    const convData: Conversation = {
      id: convId,
      customerUid: assignment.customerUid,
      pharmacyId: myPharmacy.id,
      pharmacyOwnerUid: myPharmacy.ownerUid,
      customerName: assignment.customerName || 'Customer',
      pharmacyName: myPharmacy.name,
    };
    await setDoc(
      doc(db, 'conversations', convId),
      {
        ...convData,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
    onOpenChat(convData, callMode || null);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusMsg(null);
    try {
      await updateDoc(doc(db, 'pharmacies', myPharmacy.id), {
        openingHours: editHours.trim(),
        phone: editPhone.trim(),
        street: editStreet.trim(),
        ...(editCoords ? { lat: editCoords.lat, lng: editCoords.lng } : {}),
        updatedAt: serverTimestamp(),
      });
      setStatusMsg('Pharmacy operating hours & coordinates updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update pharmacy profile');
    }
  };

  const verifiedApproved = myPharmacy.verificationStatus === 'approved';
  const openRxCount = assignments.filter(
    (a) => a.status !== 'completed' && a.status !== 'cancelled'
  ).length;

  return (
    <div className="space-y-6">
      {/* Verification & Registration Fee Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">{myPharmacy.name}</h2>
            <span
              className={`text-xs font-semibold ${
                verifiedApproved ? 'text-[#43B02A]' : 'text-amber-600'
              }`}
            >
              · {myPharmacy.verificationStatus.toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1">
            EFDA License: <span className="font-mono">{myPharmacy.licenseNumber}</span> ·{' '}
            {[myPharmacy.subCity, myPharmacy.city, myPharmacy.region].filter(Boolean).join(', ')}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full md:w-auto">
          <div className="sm:text-right text-xs">
            <div className="font-semibold text-slate-700">Registration Fee</div>
            <div className="text-[#123F91] font-bold tabular-nums">
              {hasActiveFee ? `Active (${feeAmount} Birr / 1 mo)` : `Unpaid (${feeAmount} Birr / 1 mo)`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenSubscription()}
            className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#123F91] text-white text-xs font-semibold hover:bg-[#0e3274] shrink-0"
          >
            <CreditCard className="w-4 h-4" />
            {hasActiveFee ? 'Manage 50 Birr Plan' : `Pay ${feeAmount} Birr Fee`}
          </button>
        </div>
      </div>

      {!verifiedApproved && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3 text-sm text-amber-900">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">Pending Administrator Verification</div>
            <p className="text-xs mt-0.5 text-amber-800">
              Your pharmacy will remain hidden from public discovery until an administrator approves your EFDA license document.
            </p>
          </div>
        </div>
      )}

      {/* Pharmacy Activity Summary Stats & Recharts Analytics Widget */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#123F91] shrink-0" />
            <h3 className="text-sm font-bold text-slate-900">
              Pharmacy Performance & Summary Stats
            </h3>
          </div>
          <span className="text-[11px] font-medium text-slate-500 tabular-nums">
            {assignments.length} total requests · {pharmacyAnalytics.respondedCount} responded
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between text-xs font-medium text-slate-600">
              <span>Pending Requests</span>
              <Clock className="w-4 h-4 text-[#123F91]" />
            </div>
            <div className="text-2xl font-extrabold text-[#123F91] mt-1.5 tabular-nums">
              {pharmacyAnalytics.pendingRequests}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
              {openRxCount} open in queue
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between text-xs font-medium text-slate-600">
              <span>Total Conversations</span>
              <MessageSquare className="w-4 h-4 text-[#43B02A]" />
            </div>
            <div className="text-2xl font-extrabold text-[#43B02A] mt-1.5 tabular-nums">
              {pharmacyAnalytics.totalConversations}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Direct patient chat threads
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between text-xs font-medium text-slate-600">
              <span>Average Response Time</span>
              <Timer className="w-4 h-4 text-sky-600" />
            </div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1.5 tabular-nums">
              {pharmacyAnalytics.avgResponseLabel}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
              {pharmacyAnalytics.responseTrendData.length > 0
                ? `Across ${pharmacyAnalytics.responseTrendData.length} recent responses`
                : 'Awaiting first response'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-6 rounded-xl border border-slate-200 p-3.5 sm:p-4">
            <div className="text-xs font-semibold text-slate-700 mb-3">
              Requests & Conversations Overview
            </div>
            <div className="h-48 sm:h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={pharmacyAnalytics.summaryBarData}
                  margin={{ top: 6, right: 12, left: -18, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="metric" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip
                    contentStyle={{
                      fontSize: '12px',
                      borderRadius: '10px',
                      borderColor: '#e2e8f0',
                    }}
                  />
                  <Bar dataKey="count" name="Count" radius={[6, 6, 0, 0]} maxBarSize={52}>
                    {pharmacyAnalytics.summaryBarData.map((entry) => (
                      <Cell key={entry.metric} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lg:col-span-6 rounded-xl border border-slate-200 p-3.5 sm:p-4 flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-xs font-semibold text-slate-700">
                Response Time Trend (Minutes)
              </span>
              {pharmacyAnalytics.avgResponseMinutes !== null && (
                <span className="text-[11px] font-semibold text-[#123F91] tabular-nums">
                  Avg {pharmacyAnalytics.avgResponseMinutes} min
                </span>
              )}
            </div>
            {pharmacyAnalytics.responseTrendData.length === 0 ? (
              <div className="flex-1 min-h-[12rem] flex items-center justify-center text-center text-xs text-slate-500 px-4">
                Respond to incoming prescription requests to view your live response-time trend.
              </div>
            ) : (
              <div className="h-48 sm:h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={pharmacyAnalytics.responseTrendData}
                    margin={{ top: 6, right: 12, left: -18, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="rxResponseGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#123F91" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#123F91" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip
                      formatter={(val: unknown) => [`${val} min`, 'Response Time']}
                      contentStyle={{
                        fontSize: '12px',
                        borderRadius: '10px',
                        borderColor: '#e2e8f0',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="minutes"
                      stroke="#123F91"
                      strokeWidth={2}
                      fill="url(#rxResponseGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Sub-navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setTab('prescriptions')}
          className={`min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap shrink-0 ${
            tab === 'prescriptions'
              ? 'bg-[#123F91] text-white'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <FileCheck2 className="w-4 h-4" />
          Prescription Requests ({assignments.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('profile')}
          className={`min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap shrink-0 ${
            tab === 'profile'
              ? 'bg-[#123F91] text-white'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Clock className="w-4 h-4" />
          Hours & GPS Location
        </button>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          {statusMsg}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* PRESCRIPTION REQUESTS TAB */}
      {tab === 'prescriptions' && (
        <div className="space-y-4">
          {assignments.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
              No prescription or packaging photo requests have been assigned to your pharmacy yet.
            </div>
          ) : (
            assignments.map((rx) => (
              <div
                key={rx.id}
                className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-3">
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      {rx.customerName || 'Patient'} ·{' '}
                      <span className="text-[#123F91] uppercase text-xs">
                        {rx.requestType.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Received: {formatTimestamp(rx.createdAt)} · City: {rx.city || myPharmacy.city}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold uppercase text-slate-700">
                      Status: {rx.status.replace('_', ' ')}
                    </span>
                    {typeof rx.estimatedTotalEtb === 'number' && (
                      <span className="font-bold text-[#43B02A] tabular-nums">
                        · {formatEtb(rx.estimatedTotalEtb)}
                      </span>
                    )}
                  </div>
                </div>

                {(rx.medicineNameKnown || rx.notes) && (
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 space-y-1">
                    {rx.medicineNameKnown && (
                      <div>
                        <span className="font-semibold">Patient Reference:</span>{' '}
                        {[rx.medicineNameKnown, rx.strengthKnown, rx.quantityKnown]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                    {rx.notes && (
                      <div>
                        <span className="font-semibold">Customer Notes:</span> {rx.notes}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {rx.fileIds?.map((fid, idx) => (
                    <button
                      key={fid}
                      type="button"
                      onClick={() => void handleViewPrivateFile(fid)}
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      <Eye className="w-3.5 h-3.5 text-[#123F91]" />
                      View Document {idx + 1}
                    </button>
                  ))}

                  {rx.status !== 'completed' && rx.status !== 'cancelled' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!hasActiveFee) {
                          onOpenSubscription(
                            `Pay the ${feeAmount} Birr 1-month registration fee to respond to prescription requests.`
                          );
                          return;
                        }
                        setActiveRx(rx);
                        setRxStatus(rx.status === 'submitted' ? 'available' : rx.status);
                        setRxPrice(
                          typeof rx.estimatedTotalEtb === 'number'
                            ? String(rx.estimatedTotalEtb)
                            : ''
                        );
                        setRxPrepMins(
                          typeof rx.estimatedPrepMinutes === 'number'
                            ? String(rx.estimatedPrepMinutes)
                            : '15'
                        );
                        setRxNotes(rx.responseNotes || '');
                      }}
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#43B02A] text-white text-xs font-semibold hover:bg-[#389822]"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Respond & Quote
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void openChatWithCustomer(rx)}
                    className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#123F91] text-white text-xs font-semibold hover:bg-[#0e3274]"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Message Customer
                  </button>
                  <button
                    type="button"
                    onClick={() => void openChatWithCustomer(rx, 'audio')}
                    className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Phone className="w-3.5 h-3.5 text-[#43B02A]" />
                    Audio Call
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* HOURS & LOCATION TAB */}
      {tab === 'profile' && (
        <form
          onSubmit={handleSaveProfile}
          className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6"
        >
          <div className="lg:col-span-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Operating Hours
              </label>
              <input
                type="text"
                value={editHours}
                onChange={(e) => setEditHours(e.target.value)}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Street / Neighborhood Address
              </label>
              <input
                type="text"
                value={editStreet}
                onChange={(e) => setEditStreet(e.target.value)}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-lg bg-[#123F91] text-white text-sm font-semibold hover:bg-[#0e3274]"
            >
              Save Profile & Location
            </button>
          </div>

          <div className="lg:col-span-7 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                Tap Map to Adjust Pharmacy Pin
              </span>
              <button
                type="button"
                onClick={handleUseMyGps}
                className="min-h-[36px] text-xs font-semibold text-[#123F91] hover:underline self-start sm:self-auto"
              >
                Detect Current GPS
              </button>
            </div>
            <PharmacyMap
              pharmacies={[myPharmacy]}
              userLocation={editCoords}
              selectedPharmacy={myPharmacy}
              onSelectPharmacy={() => {}}
              routeTarget={null}
              pickMode
              pickedCoords={editCoords}
              onPickCoords={setEditCoords}
              heightClassName="h-[260px] sm:h-[340px] lg:h-[380px]"
            />
          </div>
        </form>
      )}

      {/* Respond & Quote Modal */}
      {activeRx && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleSubmitRxResponse}
            className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 max-w-md w-full p-5 sm:p-6 pb-safe space-y-4 shadow-2xl max-h-[92dvh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-slate-900">
                Respond to Prescription Request
              </h3>
              <button
                type="button"
                onClick={() => setActiveRx(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Availability Status
              </label>
              <select
                value={rxStatus}
                onChange={(e) => setRxStatus(e.target.value as PrescriptionStatus)}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="received">Received</option>
                <option value="under_review">Under review</option>
                <option value="available">Available (Full Prescription)</option>
                <option value="partially_available">Partially available</option>
                <option value="out_of_stock">Out of stock</option>
                <option value="clarification_required">Clarification required</option>
                <option value="response_sent">Response sent</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Estimated Total (ETB)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={rxPrice}
                  onChange={(e) => setRxPrice(e.target.value)}
                  placeholder="320"
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Prep Time (Mins)
                </label>
                <input
                  type="number"
                  min="0"
                  value={rxPrepMins}
                  onChange={(e) => setRxPrepMins(e.target.value)}
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Pharmacist Notes & Dispensing Requirements
              </label>
              <textarea
                rows={3}
                value={rxNotes}
                onChange={(e) => setRxNotes(e.target.value)}
                placeholder="Original prescription required at pickup, preparation details, etc."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActiveRx(null)}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-lg bg-[#43B02A] text-white text-xs font-semibold hover:bg-[#389822]"
              >
                Send Quote to Customer
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Encrypted Document Viewer */}
      {viewedDoc && (
        <div className="fixed inset-0 z-50 bg-slate-900/75 flex items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-none sm:rounded-2xl max-w-3xl w-full h-[100dvh] sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <span className="text-sm font-bold text-slate-900 truncate">{viewedDoc.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={viewedDoc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[40px] inline-flex items-center text-xs font-semibold text-[#123F91] hover:underline px-2"
                >
                  Open Full Tab
                </a>
                <button
                  type="button"
                  onClick={() => setViewedDoc(null)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                  aria-label="Close document"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-3 sm:p-4 pb-safe flex items-center justify-center">
              {viewedDoc.mimeType === 'application/pdf' ? (
                <iframe
                  src={viewedDoc.url}
                  title={viewedDoc.name}
                  className="w-full h-full min-h-[65vh] rounded-lg border border-slate-300 bg-white"
                />
              ) : (
                <img
                  src={viewedDoc.url}
                  alt={viewedDoc.name}
                  className="max-h-[78vh] object-contain rounded-lg shadow-md"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
