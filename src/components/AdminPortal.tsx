import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  Eye,
  FileWarning,
  MapPin,
  Printer,
  Settings,
  ShieldCheck,
  Sliders,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { apiFetch, getSignedFileUrl } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  AuditLogItem,
  BannerItem,
  ComplaintItem,
  LocationItem,
  PaymentTransaction,
  Pharmacy,
  PrescriptionAssignment,
  SubscriptionRecord,
  UserProfile,
} from '../types';
import { ETHIOPIA_LOCATIONS } from '../data/ethiopiaCatalog';
import { formatEtb, formatTimestamp } from '../lib/geo';

interface AdminPortalProps {
  pharmacies: Pharmacy[];
  locations: LocationItem[];
  banners: BannerItem[];
}

export const AdminPortal: React.FC<AdminPortalProps> = ({
  pharmacies,
  locations,
  banners,
}) => {
  const { firebaseUser, isAdmin, settings, sendWsEvent, triggerNotificationAlert } = useAuth();
  const [tab, setTab] = useState<
    'analytics' | 'pharmacies' | 'locations' | 'settings' | 'complaints' | 'users'
  >('analytics');

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [assignments, setAssignments] = useState<PrescriptionAssignment[]>([]);
  const [complaints, setComplaints] = useState<ComplaintItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);

  // Settings form
  const [custPrice, setCustPrice] = useState(String(settings.customerMonthlyPriceEtb));
  const [pharmPrice, setPharmPrice] = useState(String(settings.pharmacyMonthlyPriceEtb));
  const [durationDays, setDurationDays] = useState(String(settings.subscriptionDurationDays));
  const [maxRxFiles, setMaxRxFiles] = useState(String(settings.maxPrescriptionFiles));
  const [maxMb, setMaxMb] = useState(String(settings.maxFileSizeMb));
  const [retentionDays, setRetentionDays] = useState(String(settings.retentionDays));

  // New Banner form
  const [bannerTitle, setBannerTitle] = useState('');
  const [bannerSubtitle, setBannerSubtitle] = useState('');

  // Direct Notification Alert Composer (with sound)
  const [alertTargetUid, setAlertTargetUid] = useState('ALL_USERS');
  const [alertTitle, setAlertTitle] = useState('');
  const [alertBody, setAlertBody] = useState('');
  const [alertSending, setAlertSending] = useState(false);

  // New Location form
  const [locRegion, setLocRegion] = useState('');
  const [locCity, setLocCity] = useState('');
  const [locLat, setLocLat] = useState('9.0192');
  const [locLng, setLocLng] = useState('38.7525');

  // Admin role assign
  const [roleUid, setRoleUid] = useState('');
  const [roleEmail, setRoleEmail] = useState('');
  const [roleType, setRoleType] = useState<'admin' | 'moderator' | 'support' | 'super_admin'>(
    'moderator'
  );

  // License doc preview
  const [docPreview, setDocPreview] = useState<{
    url: string;
    name: string;
    mimeType: string;
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCustPrice(String(settings.customerMonthlyPriceEtb));
    setPharmPrice(String(settings.pharmacyMonthlyPriceEtb));
    setDurationDays(String(settings.subscriptionDurationDays));
    setMaxRxFiles(String(settings.maxPrescriptionFiles));
    setMaxMb(String(settings.maxFileSizeMb));
    setRetentionDays(String(settings.retentionDays));
  }, [settings]);

  useEffect(() => {
    if (!isAdmin) return;
    const u1 = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map((d) => d.data() as UserProfile));
    });
    const u2 = onSnapshot(collection(db, 'subscriptions'), (snap) => {
      setSubscriptions(snap.docs.map((d) => d.data() as SubscriptionRecord));
    });
    const u3 = onSnapshot(collection(db, 'paymentTransactions'), (snap) => {
      setTransactions(snap.docs.map((d) => d.data() as PaymentTransaction));
    });
    const u4 = onSnapshot(collection(db, 'prescriptionAssignments'), (snap) => {
      setAssignments(
        snap.docs.map((d) => ({ ...d.data(), id: d.id } as PrescriptionAssignment))
      );
    });
    const u5 = onSnapshot(collection(db, 'complaints'), (snap) => {
      setComplaints(snap.docs.map((d) => ({ ...d.data(), id: d.id } as ComplaintItem)));
    });
    const u6 = onSnapshot(collection(db, 'auditLogs'), (snap) => {
      const list = snap.docs.map((d) => ({ ...d.data(), id: d.id } as AuditLogItem));
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      setAuditLogs(list.slice(0, 60));
    });
    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
    };
  }, [isAdmin]);

  const analytics = useMemo(() => {
    const activeSubs = subscriptions.filter((s) => s.status === 'active').length;
    const verifiedRevenueEtb = transactions
      .filter((t) => t.status === 'verified')
      .reduce((sum, t) => sum + (Number(t.amountEtb) || 0), 0);
    const approvedPharmacies = pharmacies.filter(
      (p) => p.verificationStatus === 'approved'
    ).length;
    const pendingPharmacies = pharmacies.filter(
      (p) => p.verificationStatus === 'pending'
    ).length;

    const cityCounts: Record<string, { city: string; pharmacies: number; prescriptions: number }> = {};
    pharmacies.forEach((p) => {
      const c = p.city || 'Other';
      if (!cityCounts[c]) cityCounts[c] = { city: c, pharmacies: 0, prescriptions: 0 };
      cityCounts[c].pharmacies += 1;
    });
    assignments.forEach((a) => {
      const c = a.city || 'Other';
      if (!cityCounts[c]) cityCounts[c] = { city: c, pharmacies: 0, prescriptions: 0 };
      cityCounts[c].prescriptions += 1;
    });

    return {
      activeSubs,
      verifiedRevenueEtb,
      approvedPharmacies,
      pendingPharmacies,
      cityChartData: Object.values(cityCounts).slice(0, 8),
    };
  }, [subscriptions, transactions, pharmacies, assignments]);

  if (!isAdmin || !firebaseUser) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-600">
        Administrator authorization required.
      </div>
    );
  }

  const writeAudit = async (
    action: string,
    resourceType: string,
    resourceId: string,
    details: string
  ) => {
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await setDoc(doc(db, 'auditLogs', logId), {
      actorUid: firebaseUser.uid,
      action,
      resourceType,
      resourceId,
      details,
      createdAt: serverTimestamp(),
    });
  };

  const initializeEthiopiaLocations = async () => {
    setBusy(true);
    setError(null);
    setStatusMsg(null);
    try {
      for (const loc of ETHIOPIA_LOCATIONS) {
        await setDoc(doc(db, 'locations', loc.id), {
          ...loc,
          createdAt: serverTimestamp(),
        });
      }
      await setDoc(
        doc(db, 'systemSettings', 'global'),
        {
          customerMonthlyPriceEtb: 50,
          pharmacyMonthlyPriceEtb: 50,
          subscriptionDurationDays: 30,
          maxPrescriptionFiles: 8,
          maxFileSizeMb: 15,
          retentionDays: 90,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await writeAudit(
        'SYNC_ETHIOPIA_LOCATIONS',
        'system',
        'global',
        `Loaded ${ETHIOPIA_LOCATIONS.length} Ethiopian locations & 50 ETB registration config`
      );
      setStatusMsg(
        `Initialized ${ETHIOPIA_LOCATIONS.length} Ethiopian locations and 50 Birr / 30-day registration fee settings.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize locations');
    } finally {
      setBusy(false);
    }
  };

  const handlePharmacyStatus = async (
    pharmacy: Pharmacy,
    nextStatus: 'approved' | 'rejected' | 'suspended'
  ) => {
    setError(null);
    try {
      await updateDoc(doc(db, 'pharmacies', pharmacy.id), {
        verificationStatus: nextStatus,
        updatedAt: serverTimestamp(),
      });

      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const notifTitle = `Pharmacy Verification: ${nextStatus.toUpperCase()}`;
      const notifBody =
        nextStatus === 'approved'
          ? `${pharmacy.name} has been verified and is now discoverable to users across Ethiopia.`
          : `${pharmacy.name} verification status updated to ${nextStatus}.`;
      await setDoc(doc(db, 'notifications', notifId), {
        recipientUid: pharmacy.ownerUid,
        type: 'pharmacy_verification',
        title: notifTitle,
        body: notifBody,
        read: false,
        createdAt: serverTimestamp(),
      });
      sendWsEvent({
        type: 'notification:push',
        targetUid: pharmacy.ownerUid,
        notification: {
          title: notifTitle,
          body: notifBody,
          type: 'pharmacy_verification',
        },
      });
      triggerNotificationAlert({
        title: 'Verification Alert Sent',
        body: `Notification alert sent to ${pharmacy.name}.`,
        kind: 'sent',
      });

      await writeAudit(
        `PHARMACY_${nextStatus.toUpperCase()}`,
        'pharmacy',
        pharmacy.id,
        `${pharmacy.name} (${pharmacy.licenseNumber})`
      );
      setStatusMsg(`${pharmacy.name} marked as ${nextStatus}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update pharmacy status');
    }
  };

  const inspectPharmacyDocs = async (pharmacyId: string) => {
    setError(null);
    try {
      const snap = await getDocs(collection(db, 'pharmacies', pharmacyId, 'verificationDocs'));
      if (snap.empty) {
        setError('No verification documents uploaded for this pharmacy yet.');
        return;
      }
      const firstDoc = snap.docs[0].data() as { fileId: string };
      const signed = await getSignedFileUrl(firstDoc.fileId);
      setDocPreview({
        url: signed.url,
        name: signed.originalName,
        mimeType: signed.mimeType,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch verification document');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await setDoc(doc(db, 'systemSettings', 'global'), {
        customerMonthlyPriceEtb: Number(custPrice) || 50,
        pharmacyMonthlyPriceEtb: Number(pharmPrice) || 50,
        subscriptionDurationDays: Number(durationDays) || 30,
        maxPrescriptionFiles: Math.min(20, Math.max(1, Number(maxRxFiles) || 8)),
        maxFileSizeMb: Math.min(25, Math.max(1, Number(maxMb) || 15)),
        retentionDays: Math.max(1, Number(retentionDays) || 90),
        updatedAt: serverTimestamp(),
      });
      await writeAudit('UPDATE_SYSTEM_SETTINGS', 'systemSettings', 'global', 'Updated pricing/limits');
      setStatusMsg('Registration fee & upload settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    }
  };

  const handleAddBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bannerTitle.trim()) return;
    const id = `ban_${Date.now()}`;
    await setDoc(doc(db, 'banners', id), {
      title: bannerTitle.trim(),
      subtitle: bannerSubtitle.trim(),
      active: true,
      createdAt: serverTimestamp(),
    });
    setBannerTitle('');
    setBannerSubtitle('');
    setStatusMsg('Promotional banner published.');
  };

  const handleSendNotificationAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = alertTitle.trim().slice(0, 160);
    const body = alertBody.trim().slice(0, 500);
    if (!title || !body) {
      setError('Alert title and message are required.');
      return;
    }
    setAlertSending(true);
    setError(null);
    try {
      const recipients =
        alertTargetUid === 'ALL_USERS'
          ? users.map((u) => u.uid)
          : [alertTargetUid];

      if (recipients.length === 0) {
        setError('No registered recipients available yet.');
        setAlertSending(false);
        return;
      }

      for (const uid of recipients) {
        const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await setDoc(doc(db, 'notifications', notifId), {
          recipientUid: uid,
          type: 'admin_alert',
          title,
          body,
          read: false,
          createdAt: serverTimestamp(),
        });
        sendWsEvent({
          type: 'notification:push',
          targetUid: uid,
          notification: {
            title,
            body,
            type: 'admin_alert',
          },
        });
      }

      await writeAudit(
        'SEND_NOTIFICATION_ALERT',
        'notifications',
        alertTargetUid,
        `${title} -> ${recipients.length} recipient(s)`
      );
      triggerNotificationAlert({
        title: 'Notification Alert Sent',
        body: `"${title}" delivered with alert sound to ${recipients.length} recipient(s).`,
        kind: 'sent',
      });
      setAlertTitle('');
      setAlertBody('');
      setStatusMsg(`Notification alert sent with sound to ${recipients.length} recipient(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send notification alert');
    } finally {
      setAlertSending(false);
    }
  };

  const handleAddLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locRegion.trim() || !locCity.trim()) return;
    const id = `loc_${Date.now()}`;
    await setDoc(doc(db, 'locations', id), {
      id,
      region: locRegion.trim(),
      city: locCity.trim(),
      lat: Number(locLat) || 9.0192,
      lng: Number(locLng) || 38.7525,
      createdAt: serverTimestamp(),
    });
    setLocRegion('');
    setLocCity('');
    setStatusMsg('Ethiopian city/location added.');
  };

  const handleAssignAdminRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleUid.trim() || !roleEmail.trim()) return;
    await setDoc(doc(db, 'admins', roleUid.trim()), {
      uid: roleUid.trim(),
      email: roleEmail.trim(),
      role: roleType,
      createdAt: serverTimestamp(),
    });
    await writeAudit('GRANT_ADMIN_ROLE', 'admins', roleUid.trim(), `${roleEmail} -> ${roleType}`);
    setRoleUid('');
    setRoleEmail('');
    setStatusMsg(`Granted ${roleType} role.`);
  };

  const handleExportCsv = async () => {
    const headers = ['Metric', 'Value'];
    const rows = [
      ['Total Users', users.length],
      ['Approved Pharmacies', analytics.approvedPharmacies],
      ['Pending Pharmacies', analytics.pendingPharmacies],
      ['Active 50 Birr Registrations', analytics.activeSubs],
      ['Verified Revenue (ETB)', analytics.verifiedRevenueEtb],
      ['Prescription Assignments', assignments.length],
      ['Open Complaints', complaints.filter((c) => c.status === 'open').length],
    ];
    try {
      const csvText = await apiFetch<string>('/api/reports/csv', {
        method: 'POST',
        body: JSON.stringify({ headers, rows }),
      });
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aplus-analytics-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      const lines = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob(['\uFEFF' + lines], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aplus-analytics-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const adminTabs = [
    ['analytics', 'Analytics & Payments', BarChart3],
    ['pharmacies', `Pharmacies (${pharmacies.length})`, ShieldCheck],
    ['locations', `Locations (${locations.length})`, MapPin],
    ['complaints', `Complaints (${complaints.length})`, FileWarning],
    ['settings', 'Registration Fee & Banners', Sliders],
    ['users', 'Users, Roles & Logs', Users],
  ] as const;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#123F91] shrink-0" />
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">
              Aplus Administration Console
            </h2>
          </div>
          <p className="text-xs text-slate-600 mt-1">
            Real-time pharmacy license verification, Ethiopian locations, 50 Birr registration revenue, and security audit logs.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void initializeEthiopiaLocations()}
            className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#43B02A] text-white text-xs font-semibold hover:bg-[#389822] disabled:opacity-50"
          >
            <Database className="w-4 h-4" />
            Sync Ethiopia Locations
          </button>
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            <Download className="w-4 h-4 text-[#123F91]" />
            CSV / Excel
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            <Printer className="w-4 h-4 text-[#123F91]" />
            Print / PDF
          </button>
        </div>
      </div>

      {/* Desktop Sidebar + Main Admin Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <aside className="lg:col-span-3 lg:sticky lg:top-20">
          {/* Mobile & Tablet Horizontal Scrollable Tabs */}
          <div className="flex lg:hidden gap-2 overflow-x-auto pb-1">
            {adminTabs.map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
                  tab === key
                    ? 'bg-[#123F91] text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Desktop Vertical Sidebar */}
          <nav
            aria-label="Admin sections"
            className="hidden lg:flex flex-col bg-white rounded-2xl border border-slate-200 p-2 space-y-1"
          >
            {adminTabs.map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`w-full min-h-[44px] inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-left transition-colors ${
                  tab === key
                    ? 'bg-[#123F91] text-white'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="lg:col-span-9 min-w-0 space-y-6">
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

          {/* ANALYTICS TAB */}
          {tab === 'analytics' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-500">Registered Users</div>
                  <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                    {users.length}
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-500">Approved Pharmacies</div>
                  <div className="text-2xl font-bold text-[#43B02A] mt-1 tabular-nums">
                    {analytics.approvedPharmacies}
                  </div>
                  <div className="text-[11px] text-amber-600 mt-0.5">
                    {analytics.pendingPharmacies} pending review
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-500">Verified Revenue (ETB)</div>
                  <div className="text-2xl font-bold text-[#123F91] mt-1 tabular-nums">
                    {formatEtb(analytics.verifiedRevenueEtb)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {analytics.activeSubs} active 1-mo registrations
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-500">Prescription Requests</div>
                  <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                    {assignments.length}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {complaints.filter((c) => c.status === 'open').length} open complaints
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5">
                <h3 className="text-sm font-bold text-slate-900 mb-4">
                  Ethiopian City Coverage: Verified Pharmacies vs Prescription Requests
                </h3>
                {analytics.cityChartData.length === 0 ? (
                  <div className="text-xs text-slate-500 py-8 text-center">
                    No pharmacy or prescription data recorded yet.
                  </div>
                ) : (
                  <div className="h-56 sm:h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.cityChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="city" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar
                          dataKey="pharmacies"
                          name="Pharmacies"
                          fill="#123F91"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          dataKey="prescriptions"
                          name="Prescriptions"
                          fill="#43B02A"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PHARMACIES TAB */}
          {tab === 'pharmacies' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 text-sm font-bold text-slate-900">
                Pharmacy License Verification Queue
              </div>
              {pharmacies.length === 0 ? (
                <div className="p-6 text-xs text-slate-500 text-center">
                  No pharmacies registered yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {pharmacies.map((p) => (
                    <div
                      key={p.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-slate-900">
                          {p.name}{' '}
                          <span
                            className={`text-xs font-semibold uppercase ${
                              p.verificationStatus === 'approved'
                                ? 'text-[#43B02A]'
                                : p.verificationStatus === 'pending'
                                  ? 'text-amber-600'
                                  : 'text-red-600'
                            }`}
                          >
                            · {p.verificationStatus}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5 break-words">
                          Pharmacist: {p.ownerPharmacistName} · License:{' '}
                          <span className="font-mono">{p.licenseNumber}</span> ·{' '}
                          {[p.subCity, p.city, p.region].filter(Boolean).join(', ')} · {p.phone}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => void inspectPharmacyDocs(p.id)}
                          className="min-h-[40px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                        >
                          <Eye className="w-3.5 h-3.5 text-[#123F91]" />
                          Inspect License
                        </button>
                        {p.verificationStatus !== 'approved' && (
                          <button
                            type="button"
                            onClick={() => void handlePharmacyStatus(p, 'approved')}
                            className="min-h-[40px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#43B02A] text-white text-xs font-semibold hover:bg-[#389822]"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Approve
                          </button>
                        )}
                        {p.verificationStatus !== 'suspended' && (
                          <button
                            type="button"
                            onClick={() => void handlePharmacyStatus(p, 'suspended')}
                            className="min-h-[40px] px-3 py-1.5 rounded-lg border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50"
                          >
                            Suspend
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* LOCATIONS TAB */}
          {tab === 'locations' && (
            <form
              onSubmit={handleAddLocation}
              className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4"
            >
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <MapPin className="w-4 h-4 text-[#43B02A]" />
                Ethiopian Locations Directory ({locations.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <input
                  required
                  placeholder="Region (e.g. Oromia)"
                  value={locRegion}
                  onChange={(e) => setLocRegion(e.target.value)}
                  className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
                <input
                  required
                  placeholder="City / Town"
                  value={locCity}
                  onChange={(e) => setLocCity(e.target.value)}
                  className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
                <input
                  placeholder="Latitude"
                  value={locLat}
                  onChange={(e) => setLocLat(e.target.value)}
                  className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs tabular-nums"
                />
                <input
                  placeholder="Longitude"
                  value={locLng}
                  onChange={(e) => setLocLng(e.target.value)}
                  className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs tabular-nums"
                />
              </div>
              <button
                type="submit"
                className="w-full sm:w-auto min-h-[42px] px-4 py-2 rounded-lg bg-[#43B02A] text-white text-xs font-semibold"
              >
                Add Ethiopian City
              </button>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-200 border border-slate-200 rounded-xl mt-2">
                {locations.map((loc) => (
                  <div
                    key={loc.id}
                    className="px-3.5 py-2.5 text-xs flex items-center justify-between gap-2"
                  >
                    <span>
                      <strong className="text-slate-900">{loc.city}</strong> · {loc.region}
                    </span>
                    <button
                      type="button"
                      onClick={() => void deleteDoc(doc(db, 'locations', loc.id))}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-600 hover:text-red-800"
                      aria-label={`Delete ${loc.city}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </form>
          )}

          {/* COMPLAINTS TAB */}
          {tab === 'complaints' && (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-200">
              {complaints.length === 0 ? (
                <div className="p-6 text-xs text-slate-500 text-center">
                  No customer reports or complaints logged.
                </div>
              ) : (
                complaints.map((c) => (
                  <div
                    key={c.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900">{c.subject}</div>
                      <div className="text-xs text-slate-600 mt-0.5">{c.description}</div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        Type: {c.targetType} · Status: {c.status} · {formatTimestamp(c.createdAt)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          void updateDoc(doc(db, 'complaints', c.id), {
                            status: 'resolved',
                            updatedAt: serverTimestamp(),
                          })
                        }
                        className="min-h-[40px] px-3 py-1.5 rounded-lg bg-[#43B02A] text-white text-xs font-semibold"
                      >
                        Mark Resolved
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void updateDoc(doc(db, 'complaints', c.id), {
                            status: 'dismissed',
                            updatedAt: serverTimestamp(),
                          })
                        }
                        className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* SETTINGS & BANNERS TAB */}
          {tab === 'settings' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <form
                onSubmit={handleSaveSettings}
                className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Settings className="w-4 h-4 text-[#123F91] shrink-0" />
                  Registration Fee (50 Birr / 1 Month) & Upload Rules
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">
                      User Fee (ETB)
                    </label>
                    <input
                      type="number"
                      value={custPrice}
                      onChange={(e) => setCustPrice(e.target.value)}
                      className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">
                      Pharmacy Fee (ETB)
                    </label>
                    <input
                      type="number"
                      value={pharmPrice}
                      onChange={(e) => setPharmPrice(e.target.value)}
                      className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">
                      Duration (Days)
                    </label>
                    <input
                      type="number"
                      value={durationDays}
                      onChange={(e) => setDurationDays(e.target.value)}
                      className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">
                      Max Prescription Files
                    </label>
                    <input
                      type="number"
                      value={maxRxFiles}
                      onChange={(e) => setMaxRxFiles(e.target.value)}
                      className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">
                      Max File Size (MB)
                    </label>
                    <input
                      type="number"
                      value={maxMb}
                      onChange={(e) => setMaxMb(e.target.value)}
                      className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">
                      File Retention (Days)
                    </label>
                    <input
                      type="number"
                      value={retentionDays}
                      onChange={(e) => setRetentionDays(e.target.value)}
                      className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full sm:w-auto min-h-[42px] px-4 py-2 rounded-lg bg-[#123F91] text-white text-xs font-semibold"
                >
                  Save Platform Settings
                </button>
              </form>

              <form
                onSubmit={handleAddBanner}
                className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3"
              >
                <div className="text-sm font-bold text-slate-900">
                  Promotional & Health Alert Banners ({banners.length})
                </div>
                <input
                  required
                  placeholder="Banner Title (e.g. 24/7 Verified Pharmacies in Addis Ababa)"
                  value={bannerTitle}
                  onChange={(e) => setBannerTitle(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
                <input
                  placeholder="Banner Subtitle / Details"
                  value={bannerSubtitle}
                  onChange={(e) => setBannerSubtitle(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
                <button
                  type="submit"
                  className="w-full sm:w-auto min-h-[42px] px-4 py-2 rounded-lg bg-[#43B02A] text-white text-xs font-semibold"
                >
                  Publish Banner
                </button>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl mt-2">
                  {banners.map((b) => (
                    <div
                      key={b.id}
                      className="px-3.5 py-2.5 text-xs flex justify-between items-center gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900">{b.title}</div>
                        {b.subtitle && <div className="text-slate-500">{b.subtitle}</div>}
                      </div>
                      <button
                        type="button"
                        onClick={() => void deleteDoc(doc(db, 'banners', b.id))}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-600 shrink-0"
                        aria-label="Delete banner"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </form>

              <form
                onSubmit={handleSendNotificationAlert}
                className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3"
              >
                <div className="text-sm font-bold text-slate-900">
                  Send Notification Alert (With Sound)
                </div>
                <p className="text-xs text-slate-600">
                  Send a real-time alert notification with chime sound to an individual customer/pharmacy or broadcast to all registered users.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">Recipient</label>
                    <select
                      value={alertTargetUid}
                      onChange={(e) => setAlertTargetUid(e.target.value)}
                      className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 bg-white"
                    >
                      <option value="ALL_USERS">All Registered Users ({users.length})</option>
                      {users.map((u) => (
                        <option key={u.uid} value={u.uid}>
                          {u.displayName} ({u.role})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">Alert Title</label>
                    <input
                      required
                      maxLength={160}
                      placeholder="e.g. Urgent Pharmacy Update or Payment Reminder"
                      value={alertTitle}
                      onChange={(e) => setAlertTitle(e.target.value)}
                      className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Alert Message
                  </label>
                  <textarea
                    required
                    rows={2}
                    maxLength={500}
                    placeholder="Write the notification alert message..."
                    value={alertBody}
                    onChange={(e) => setAlertBody(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  disabled={alertSending}
                  className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#123F91] text-white text-xs font-semibold hover:bg-[#0e3274] disabled:opacity-60"
                >
                  {alertSending ? 'Sending Alert...' : 'Send Notification Alert'}
                </button>
              </form>
            </div>
          )}

          {/* USERS, ROLES & LOGS TAB */}
          {tab === 'users' && (
            <div className="space-y-6">
              <form
                onSubmit={handleAssignAdminRole}
                className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3"
              >
                <div className="text-sm font-bold text-slate-900">
                  Assign Admin / Moderator / Support Role
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
                  <input
                    required
                    placeholder="User UID"
                    value={roleUid}
                    onChange={(e) => setRoleUid(e.target.value)}
                    className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                  <input
                    required
                    placeholder="User Email"
                    value={roleEmail}
                    onChange={(e) => setRoleEmail(e.target.value)}
                    className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2"
                  />
                  <select
                    value={roleType}
                    onChange={(e) =>
                      setRoleType(
                        e.target.value as 'admin' | 'moderator' | 'support' | 'super_admin'
                      )
                    }
                    className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 bg-white"
                  >
                    <option value="moderator">Pharmacy Moderator</option>
                    <option value="support">Customer Support</option>
                    <option value="admin">Administrator</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                  <button
                    type="submit"
                    className="min-h-[42px] rounded-lg bg-[#123F91] text-white font-semibold px-4 py-2"
                  >
                    Grant Role
                  </button>
                </div>
              </form>

              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 text-sm font-bold text-slate-900">
                  Platform Accounts ({users.length})
                </div>

                {/* Mobile Card List */}
                <div className="md:hidden divide-y divide-slate-200">
                  {users.map((u) => (
                    <div key={u.uid} className="p-4 space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900">{u.displayName}</span>
                        <span className="capitalize font-semibold text-[#123F91]">
                          {u.role.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="text-slate-600">
                        City: {u.city} · Fee:{' '}
                        <span className="capitalize font-medium">{u.subscriptionStatus}</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-400 break-all">{u.uid}</div>
                    </div>
                  ))}
                </div>

                {/* Desktop & Tablet Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5">User</th>
                        <th className="px-4 py-2.5">UID</th>
                        <th className="px-4 py-2.5">Role</th>
                        <th className="px-4 py-2.5">Registration Fee</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {users.map((u) => (
                        <tr key={u.uid}>
                          <td className="px-4 py-2.5 font-semibold text-slate-900">
                            {u.displayName} · <span className="text-slate-500">{u.city}</span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">
                            {u.uid}
                          </td>
                          <td className="px-4 py-2.5 capitalize">{u.role.replace('_', ' ')}</td>
                          <td className="px-4 py-2.5 capitalize">{u.subscriptionStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 text-sm font-bold text-slate-900">
                  Recent Security & Verification Audit Logs ({auditLogs.length})
                </div>
                <div className="divide-y divide-slate-200 max-h-64 overflow-y-auto">
                  {auditLogs.map((l) => (
                    <div
                      key={l.id}
                      className="px-4 py-2.5 text-xs flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-4"
                    >
                      <div className="min-w-0 break-words">
                        <span className="font-mono font-semibold text-[#123F91]">{l.action}</span>{' '}
                        · <span className="text-slate-700">{l.details}</span>
                      </div>
                      <span className="text-slate-400 shrink-0 tabular-nums">
                        {formatTimestamp(l.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* License Document Viewer */}
      {docPreview && (
        <div className="fixed inset-0 z-50 bg-slate-900/75 flex items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-none sm:rounded-2xl max-w-3xl w-full h-[100dvh] sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <span className="text-sm font-bold text-slate-900 truncate">{docPreview.name}</span>
              <button
                type="button"
                onClick={() => setDocPreview(null)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 shrink-0"
                aria-label="Close document"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-3 sm:p-4 pb-safe flex items-center justify-center">
              {docPreview.mimeType === 'application/pdf' ? (
                <iframe
                  src={docPreview.url}
                  title={docPreview.name}
                  className="w-full h-full min-h-[65vh] rounded-lg border border-slate-300 bg-white"
                />
              ) : (
                <img
                  src={docPreview.url}
                  alt={docPreview.name}
                  className="max-h-[78vh] object-contain rounded-lg"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
