import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import {
  Bell,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Flag,
  Heart,
  LogIn,
  LogOut,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  PhoneIncoming,
  PhoneOff,
  Search,
  Share2,
  ShieldCheck,
  Star,
  Upload,
  User as UserIcon,
  Video,
  Volume2,
  X,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './lib/firebase';
import { useAuth } from './context/AuthContext';
import { LANGUAGE_LABELS } from './i18n/translations';
import {
  BannerItem,
  Conversation,
  FavoriteItem,
  LanguageCode,
  LocationItem,
  Pharmacy,
  PrescriptionAssignment,
  ReviewItem,
} from './types';
import { ETHIOPIA_LOCATIONS } from './data/ethiopiaCatalog';
import { formatEtb, formatTimestamp, haversineKm } from './lib/geo';
import { OnboardingModal } from './components/OnboardingModal';
import { PharmacyMap } from './components/PharmacyMap';
import { PrescriptionUploadModal } from './components/PrescriptionUploadModal';
import { ChatAndCallModal } from './components/ChatAndCallModal';
import { SubscriptionModal } from './components/SubscriptionModal';
import { AccountModal } from './components/AccountModal';
import { PharmacyPortal } from './components/PharmacyPortal';
import { AdminPortal } from './components/AdminPortal';

type MainView = 'pharmacies' | 'prescriptions' | 'messages' | 'pharmacy_portal' | 'admin';

export default function App() {
  const {
    firebaseUser,
    profile,
    isAdmin,
    myPharmacy,
    subscription,
    settings,
    notifications,
    unreadCount,
    language,
    t,
    setLanguage,
    signInWithGoogle,
    signOut,
    incomingCall,
    clearIncomingCall,
    sendWsEvent,
    notificationPermission,
    requestBrowserNotifications,
    activeAlert,
    dismissAlert,
  } = useAuth();

  const [view, setView] = useState<MainView>('pharmacies');
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);

  // Live collections (pharmacies, locations, banners, reviews)
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [firestoreLocations, setFirestoreLocations] = useState<LocationItem[]>([]);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);

  // User-owned collections
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [myAssignments, setMyAssignments] = useState<PrescriptionAssignment[]>([]);

  // Pharmacy search & discovery state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  // Interactive drawers & modals
  const [selectedPharmacy, setSelectedPharmacy] = useState<Pharmacy | null>(null);
  const [routeTarget, setRouteTarget] = useState<Pharmacy | null>(null);
  const [rxModalOpen, setRxModalOpen] = useState(false);
  const [rxModalMode, setRxModalMode] = useState<'prescription' | 'medicine_image'>('prescription');
  const [rxPreselectedPharmacyId, setRxPreselectedPharmacyId] = useState<string | null>(null);

  const [activeChat, setActiveChat] = useState<{
    conversation: Conversation;
    callMode?: 'audio' | 'video' | null;
    accepting?: {
      callId: string;
      callerUid: string;
      callerName: string;
      callType: 'audio' | 'video';
    } | null;
  } | null>(null);

  const [subscriptionModalOpen, setSubscriptionModalOpen] = useState(false);
  const [subscriptionReason, setSubscriptionReason] = useState<string | null>(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [notifMenuOpen, setNotifMenuOpen] = useState(false);
  const promptedFeeRef = useRef<string | null>(null);

  // Complaint / Review inline state
  const [reportTarget, setReportTarget] = useState<{
    type: 'pharmacy';
    id: string;
    label: string;
  } | null>(null);
  const [reportSubject, setReportSubject] = useState('');
  const [reportDesc, setReportDesc] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const isPharmacyUser = profile?.role === 'pharmacy' || Boolean(myPharmacy);
  const registrationFeeEtb = isPharmacyUser
    ? settings.pharmacyMonthlyPriceEtb || 50
    : settings.customerMonthlyPriceEtb || 50;
  const hasActiveRegistrationFee = Boolean(
    isAdmin ||
      subscription?.status === 'active' ||
      subscription?.status === 'expiring_soon' ||
      profile?.subscriptionStatus === 'active'
  );

  // Prompt unpaid registered users once per session to pay the 50 Birr 1-month registration fee
  useEffect(() => {
    if (!firebaseUser || !profile || isAdmin || hasActiveRegistrationFee) return;
    if (promptedFeeRef.current === firebaseUser.uid) return;
    promptedFeeRef.current = firebaseUser.uid;
    setSubscriptionReason(
      `Welcome ${profile.displayName}! Please pay the ${registrationFeeEtb} Birr registration fee for 1 month (30 days) to unlock full platform access.`
    );
    setSubscriptionModalOpen(true);
  }, [firebaseUser, profile, isAdmin, hasActiveRegistrationFee, registrationFeeEtb]);

  // Listen for Google Maps Demo Key quota exceeded event
  useEffect(() => {
    const handler = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  // Public Firestore listeners (locations, banners, reviews)
  useEffect(() => {
    const uLocs = onSnapshot(collection(db, 'locations'), (snap) => {
      setFirestoreLocations(snap.docs.map((d) => ({ ...d.data(), id: d.id } as LocationItem)));
    });
    const uBanners = onSnapshot(
      query(collection(db, 'banners'), where('active', '==', true)),
      (snap) => {
        setBanners(snap.docs.map((d) => ({ ...d.data(), id: d.id } as BannerItem)));
      }
    );
    const uReviews = onSnapshot(collection(db, 'reviews'), (snap) => {
      setReviews(snap.docs.map((d) => ({ ...d.data(), id: d.id } as ReviewItem)));
    });

    return () => {
      uLocs();
      uBanners();
      uReviews();
    };
  }, []);

  // Pharmacies listener (admins load all; public loads approved only)
  useEffect(() => {
    const pharmQ = isAdmin
      ? collection(db, 'pharmacies')
      : query(collection(db, 'pharmacies'), where('verificationStatus', '==', 'approved'));

    const uPharm = onSnapshot(pharmQ, (snap) => {
      setPharmacies(snap.docs.map((d) => ({ ...d.data(), id: d.id } as Pharmacy)));
    });

    return () => {
      uPharm();
    };
  }, [isAdmin]);

  // Authenticated user-scoped listeners
  useEffect(() => {
    if (!firebaseUser) {
      setFavorites([]);
      setConversations([]);
      setMyAssignments([]);
      return;
    }
    const uid = firebaseUser.uid;

    const uFav = onSnapshot(
      query(collection(db, 'favorites'), where('userUid', '==', uid)),
      (snap) => {
        setFavorites(
          snap.docs
            .map((d) => ({ ...d.data(), id: d.id } as FavoriteItem))
            .filter((f) => f.targetType === 'pharmacy')
        );
      }
    );
    const uRx = onSnapshot(
      query(collection(db, 'prescriptionAssignments'), where('customerUid', '==', uid)),
      (snap) => {
        const list = snap.docs.map(
          (d) => ({ ...d.data(), id: d.id } as PrescriptionAssignment)
        );
        list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
        setMyAssignments(list);
      }
    );

    const convCustQ = query(collection(db, 'conversations'), where('customerUid', '==', uid));
    const convPharmQ = query(
      collection(db, 'conversations'),
      where('pharmacyOwnerUid', '==', uid)
    );
    let custConvs: Conversation[] = [];
    let pharmConvs: Conversation[] = [];
    const mergeConvs = () => {
      const seen: Record<string, Conversation> = {};
      [...custConvs, ...pharmConvs].forEach((c) => {
        seen[c.id] = c;
      });
      setConversations(Object.values(seen));
    };
    const uConv1 = onSnapshot(convCustQ, (snap) => {
      custConvs = snap.docs.map((d) => ({ ...d.data(), id: d.id } as Conversation));
      mergeConvs();
    });
    const uConv2 = onSnapshot(convPharmQ, (snap) => {
      pharmConvs = snap.docs.map((d) => ({ ...d.data(), id: d.id } as Conversation));
      mergeConvs();
    });

    return () => {
      uFav();
      uRx();
      uConv1();
      uConv2();
    };
  }, [firebaseUser]);

  const locations: LocationItem[] = useMemo(() => {
    if (firestoreLocations.length > 0) return firestoreLocations;
    return ETHIOPIA_LOCATIONS.map((l) => ({ ...l }));
  }, [firestoreLocations]);

  const approvedPharmacies = useMemo(
    () => pharmacies.filter((p) => p.verificationStatus === 'approved'),
    [pharmacies]
  );

  const cityOptions = useMemo(() => {
    const s = new Set<string>();
    locations.forEach((l) => s.add(l.city));
    approvedPharmacies.forEach((p) => {
      if (p.city) s.add(p.city);
    });
    return Array.from(s).sort();
  }, [locations, approvedPharmacies]);

  const sortedPharmacies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = approvedPharmacies.filter((p) => {
      if (selectedCity && p.city.toLowerCase() !== selectedCity.toLowerCase()) return false;
      if (q) {
        const hay = [p.name, p.city, p.subCity, p.region, p.street]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return filtered
      .map((p) => {
        const dist =
          userCoords && typeof p.lat === 'number' && typeof p.lng === 'number'
            ? haversineKm(userCoords, { lat: p.lat, lng: p.lng })
            : null;
        return { pharmacy: p, distanceKm: dist };
      })
      .sort((a, b) => {
        if (a.distanceKm !== null && b.distanceKm !== null) {
          return a.distanceKm - b.distanceKm;
        }
        return a.pharmacy.name.localeCompare(b.pharmacy.name);
      });
  }, [approvedPharmacies, selectedCity, searchQuery, userCoords]);

  const filterAnimationKey = useMemo(
    () =>
      `${selectedCity}|${searchQuery.trim().toLowerCase()}|${
        userCoords ? `${userCoords.lat.toFixed(3)},${userCoords.lng.toFixed(3)}` : 'nogps'
      }`,
    [selectedCity, searchQuery, userCoords]
  );

  const groupedPrescriptions = useMemo(() => {
    const groups: Record<string, PrescriptionAssignment[]> = {};
    myAssignments.forEach((a) => {
      if (!groups[a.requestId]) groups[a.requestId] = [];
      groups[a.requestId].push(a);
    });
    return Object.entries(groups);
  }, [myAssignments]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  const openFeeModal = (reason?: string) => {
    setSubscriptionReason(
      reason ||
        `All users and pharmacies pay a ${registrationFeeEtb} Birr registration fee for 1 month (30 days) of full access.`
    );
    setSubscriptionModalOpen(true);
  };

  const ensurePaidAccess = async (actionDescription: string): Promise<boolean> => {
    if (!firebaseUser) {
      await signInWithGoogle('customer');
      return false;
    }
    if (!hasActiveRegistrationFee) {
      openFeeModal(
        `Pay the ${registrationFeeEtb} Birr registration fee (1 month) to ${actionDescription}.`
      );
      return false;
    }
    return true;
  };

  const handleUseGps = () => {
    if (!navigator.geolocation) {
      showToast('Browser geolocation is unavailable.');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsLoading(false);
        showToast('GPS location updated for nearest Ethiopian pharmacy sorting.');
      },
      () => {
        setGpsLoading(false);
        showToast('Location permission denied. You can filter by Ethiopian city instead.');
      }
    );
  };

  const toggleFavorite = async (pharmacy: Pharmacy) => {
    if (!(await ensurePaidAccess('save favorite pharmacies'))) return;
    const existing = favorites.find(
      (f) => f.targetType === 'pharmacy' && f.targetId === pharmacy.id
    );
    if (existing) {
      await deleteDoc(doc(db, 'favorites', existing.id));
    } else {
      const id = `fav_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await setDoc(doc(db, 'favorites', id), {
        userUid: firebaseUser!.uid,
        targetType: 'pharmacy',
        targetId: pharmacy.id,
        targetName: pharmacy.name,
        createdAt: serverTimestamp(),
      });
    }
  };

  const openChatWithPharmacy = async (
    pharmacy: Pharmacy,
    callMode?: 'audio' | 'video' | null
  ) => {
    if (!(await ensurePaidAccess('message or call verified pharmacies'))) return;
    if (!firebaseUser || !profile) return;
    const convId = `${firebaseUser.uid}_${pharmacy.id}`;
    const convData: Conversation = {
      id: convId,
      customerUid: firebaseUser.uid,
      pharmacyId: pharmacy.id,
      pharmacyOwnerUid: pharmacy.ownerUid,
      customerName: profile.displayName || 'Customer',
      pharmacyName: pharmacy.name,
    };
    await setDoc(
      doc(db, 'conversations', convId),
      {
        ...convData,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
    setActiveChat({ conversation: convData, callMode: callMode || null });
  };

  const submitReview = async (pharmacy: Pharmacy) => {
    if (!(await ensurePaidAccess('submit pharmacy reviews'))) return;
    if (!firebaseUser || !profile) return;
    const id = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, 'reviews', id), {
      pharmacyId: pharmacy.id,
      customerUid: firebaseUser.uid,
      customerName: profile.displayName || 'Customer',
      rating: reviewRating,
      comment: reviewComment.trim(),
      createdAt: serverTimestamp(),
    });
    setReviewComment('');
    showToast('Thank you! Your verified review has been saved.');
  };

  const submitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !reportTarget) {
      await signInWithGoogle('customer');
      return;
    }
    if (reportDesc.trim().length < 5) {
      showToast('Please provide at least 5 characters describing the issue.');
      return;
    }
    const id = `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, 'complaints', id), {
      reporterUid: firebaseUser.uid,
      targetType: reportTarget.type,
      targetId: reportTarget.id,
      subject: reportSubject.trim() || `Issue with ${reportTarget.label}`,
      description: reportDesc.trim(),
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setReportTarget(null);
    setReportSubject('');
    setReportDesc('');
    showToast('Report submitted to Aplus moderation team.');
  };

  const openPrescriptionModal = async (
    mode: 'prescription' | 'medicine_image',
    pharmacyId?: string
  ) => {
    if (!(await ensurePaidAccess('upload prescriptions or packaging photos'))) return;
    setRxModalMode(mode);
    setRxPreselectedPharmacyId(pharmacyId || null);
    setRxModalOpen(true);
  };

  const handleSharePharmacy = async (pharmacy: Pharmacy, distanceKm: number | null) => {
    const address = [pharmacy.street, pharmacy.subCity, pharmacy.city, pharmacy.region]
      .filter(Boolean)
      .join(', ');
    const shareLines = [
      `${pharmacy.name} (Verified Pharmacy · Aplus Drug Finder)`,
      address ? `Location: ${address}` : null,
      pharmacy.phone ? `Phone: ${pharmacy.phone}` : null,
      pharmacy.openingHours ? `Hours: ${pharmacy.openingHours}` : null,
      distanceKm !== null ? `Distance: ${distanceKm.toFixed(1)} km away` : null,
    ].filter(Boolean);
    const shareText = shareLines.join('\n');
    const shareUrl = window.location.origin;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `${pharmacy.name} · Aplus Drug Finder`,
          text: shareText,
          url: shareUrl,
        });
        showToast(`Shared ${pharmacy.name} details.`);
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
      }
    }

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        showToast(`Copied ${pharmacy.name} contact details to clipboard.`);
      } else {
        showToast(`${pharmacy.name} · ${pharmacy.phone}`);
      }
    } catch {
      showToast(`${pharmacy.name} · ${pharmacy.phone}`);
    }
  };

  return (
    <div
      className={`min-h-screen bg-slate-50 text-slate-900 flex flex-col ${
        profile?.accessibilityHighContrast ? 'high-contrast' : ''
      }`}
    >
      {/* Google Maps Demo Key Quota Exceeded Sticky Banner */}
      {gmpQuotaExceeded && (
        <div
          id="gmp-quota-banner"
          className="sticky top-0 z-[9999] bg-amber-100 text-amber-950 px-4 py-2.5 text-center border-b border-amber-300 text-xs flex flex-wrap items-center justify-center gap-2"
        >
          <span>
            Map notice: Google Maps Demo API Key quota reached (up to 1,000 requests/day during preview).
          </span>
          <a
            href="https://console.cloud.google.com/apis/api/maps-backend.googleapis.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline text-[#123F91]"
          >
            Upgrade in Google Cloud Console
          </a>
        </div>
      )}

      {/* Top Navigation Bar (3-Zone Contract) */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-6">
          {/* Left: Brand */}
          <button
            type="button"
            onClick={() => setView('pharmacies')}
            className="flex items-center gap-2 sm:gap-2.5 min-w-0 shrink-0 text-left"
          >
            <img
              src="/aplus-app-icon.png"
              alt="Aplus Drug Finder"
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg object-cover border border-slate-200 shrink-0"
            />
            <div className="whitespace-nowrap">
              <div className="text-sm font-extrabold text-[#123F91] leading-tight">
                {t.appName}
              </div>
              <div className="hidden sm:block text-[11px] font-medium text-[#43B02A] leading-tight">
                {t.slogan}
              </div>
            </div>
          </button>

          {/* Center: Desktop Primary Navigation */}
          <nav className="hidden lg:flex items-center gap-1">
            {(
              [
                ['pharmacies', t.navPharmacies],
                ['prescriptions', t.navPrescriptions],
                ['messages', t.navMessages],
                ['pharmacy_portal', t.navPharmacyPortal],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  view === key
                    ? 'bg-[#123F91] text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setView('admin')}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  view === 'admin'
                    ? 'bg-[#43B02A] text-white'
                    : 'text-[#43B02A] hover:bg-emerald-50'
                }`}
              >
                {t.navAdmin}
              </button>
            )}
          </nav>

          {/* Right: Language, Notifications, Auth & Registration Fee */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <select
              aria-label="Language"
              value={language}
              onChange={(e) => void setLanguage(e.target.value as LanguageCode)}
              className="min-h-[38px] max-w-[92px] sm:max-w-none rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 whitespace-nowrap shrink-0"
            >
              {(Object.keys(LANGUAGE_LABELS) as LanguageCode[]).map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_LABELS[code]}
                </option>
              ))}
            </select>

            {firebaseUser && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifMenuOpen((v) => !v)}
                  className="relative min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50"
                  aria-label="Notifications"
                >
                  <Bell className="w-4 h-4 text-slate-700" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#43B02A] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {notifMenuOpen && (
                  <div className="fixed inset-x-3 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                      <span className="text-xs font-bold text-slate-900">Notifications</span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void requestBrowserNotifications()}
                          className="text-[11px] font-semibold text-[#123F91] hover:underline"
                        >
                          {notificationPermission === 'granted' ? 'Push Enabled' : 'Allow Push'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setNotifMenuOpen(false)}
                          className="sm:hidden p-1 text-slate-500"
                          aria-label="Close notifications"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-200">
                      {notifications.length === 0 ? (
                        <div className="p-4 text-xs text-slate-500 text-center">
                          No notifications yet.
                        </div>
                      ) : (
                        notifications.slice(0, 12).map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => {
                              if (!n.read) {
                                updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(
                                  () => {}
                                );
                              }
                            }}
                            className={`w-full text-left px-4 py-3 text-xs hover:bg-slate-50 ${
                              n.read ? 'bg-white' : 'bg-blue-50/50'
                            }`}
                          >
                            <div className="font-semibold text-slate-900">{n.title}</div>
                            <div className="text-slate-600 mt-0.5">{n.body}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {firebaseUser ? (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => openFeeModal()}
                  className={`hidden md:inline-flex items-center gap-1 min-h-[38px] px-2.5 py-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 tabular-nums ${
                    hasActiveRegistrationFee
                      ? 'border-emerald-200 bg-emerald-50 text-[#43B02A]'
                      : 'border-amber-300 bg-amber-50 text-amber-800'
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  {hasActiveRegistrationFee
                    ? `${registrationFeeEtb} Birr Active`
                    : `Pay ${registrationFeeEtb} Birr (1 Mo)`}
                </button>
                <button
                  type="button"
                  onClick={() => setAccountModalOpen(true)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  aria-label="Account"
                >
                  <UserIcon className="w-4 h-4 text-[#123F91]" />
                  <span className="hidden sm:inline max-w-[100px] truncate">
                    {profile?.displayName || firebaseUser.displayName || 'Account'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  title={t.signOut}
                  aria-label={t.signOut}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg bg-[#123F91] text-white text-xs font-semibold hover:bg-[#0e3274] whitespace-nowrap shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{t.signIn}</span>
                <span className="hidden sm:inline">· {registrationFeeEtb} Birr/Mo</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mandatory 50 Birr / 1-Month Registration Fee Prompt Banner */}
      {!isAdmin && (!firebaseUser || !hasActiveRegistrationFee) && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 text-xs">
            <div className="flex items-start sm:items-center gap-2 text-amber-950">
              <CreditCard className="w-4 h-4 text-[#123F91] shrink-0 mt-0.5 sm:mt-0" />
              <span>
                <strong>Registration Fee Required ({registrationFeeEtb} Birr / 1 Month):</strong>{' '}
                Everyone registering on Aplus Drug Finder pays{' '}
                <strong>{registrationFeeEtb} Birr (50 ETB)</strong> for 1 month (30 days) of full access to verified pharmacies, prescription uploads, and direct pharmacist calls.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!firebaseUser) {
                  void signInWithGoogle();
                } else {
                  openFeeModal();
                }
              }}
              className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-lg bg-[#123F91] text-white font-bold hover:bg-[#0e3274] whitespace-nowrap shrink-0"
            >
              {firebaseUser
                ? `Pay ${registrationFeeEtb} Birr Registration Fee`
                : `Sign In & Pay ${registrationFeeEtb} Birr`}
            </button>
          </div>
        </div>
      )}

      {/* Global Incoming WebRTC Call Bar */}
      {incomingCall && (
        <div className="bg-[#123F91] text-white px-4 py-3 border-b border-blue-800">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm font-semibold">
              <PhoneIncoming className="w-5 h-5 text-[#43B02A] animate-bounce" />
              <span>
                Incoming {incomingCall.callType} call from {incomingCall.callerName}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const conv = conversations.find((c) => c.id === incomingCall.conversationId) || {
                    id: incomingCall.conversationId,
                    customerUid: firebaseUser?.uid || '',
                    pharmacyId: '',
                    pharmacyOwnerUid: incomingCall.callerUid,
                    customerName: profile?.displayName || 'Customer',
                    pharmacyName: incomingCall.callerName,
                  };
                  setActiveChat({
                    conversation: conv,
                    accepting: incomingCall,
                  });
                }}
                className="px-4 py-1.5 rounded-lg bg-[#43B02A] text-white text-xs font-bold hover:bg-[#389822]"
              >
                Accept Call
              </button>
              <button
                type="button"
                onClick={() => {
                  sendWsEvent({
                    type: 'call:decline',
                    targetUid: incomingCall.callerUid,
                    callId: incomingCall.callId,
                  });
                  clearIncomingCall();
                }}
                className="px-3.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold inline-flex items-center gap-1"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Notification Alert Banner (Received & Sent with Sound) */}
      {activeAlert && (
        <motion.div
          key={activeAlert.id}
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          role="status"
          aria-live="polite"
          className={`fixed top-16 sm:top-20 inset-x-3 sm:inset-x-auto sm:right-5 sm:w-96 z-50 rounded-2xl border shadow-2xl px-4 py-3.5 flex items-start gap-3 ${
            activeAlert.kind === 'sent'
              ? 'bg-[#123F91] border-blue-800 text-white'
              : 'bg-white border-emerald-300 text-slate-900'
          }`}
        >
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              activeAlert.kind === 'sent'
                ? 'bg-white/15 text-emerald-300'
                : 'bg-emerald-50 text-[#43B02A]'
            }`}
          >
            <Volume2 className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <span className="truncate">{activeAlert.title}</span>
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                  activeAlert.kind === 'sent'
                    ? 'bg-[#43B02A] text-white'
                    : 'bg-blue-50 text-[#123F91]'
                }`}
              >
                {activeAlert.kind === 'sent' ? 'Sent' : 'Alert'}
              </span>
            </div>
            <p
              className={`text-xs mt-0.5 leading-snug ${
                activeAlert.kind === 'sent' ? 'text-blue-100' : 'text-slate-600'
              }`}
            >
              {activeAlert.body}
            </p>
          </div>
          <button
            type="button"
            onClick={dismissAlert}
            className={`min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg shrink-0 ${
              activeAlert.kind === 'sent'
                ? 'text-blue-100 hover:bg-white/10'
                : 'text-slate-400 hover:bg-slate-100'
            }`}
            aria-label="Dismiss notification alert"
          >
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}

      {/* Toast Feedback */}
      {toastMsg && (
        <div className="fixed bottom-20 lg:bottom-5 inset-x-3 sm:inset-x-auto sm:right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl text-xs font-medium flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-[#43B02A] shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Main Content Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        {/* Promotional Banners */}
        {banners.length > 0 && view === 'pharmacies' && (
          <div className="space-y-2">
            {banners.map((b) => (
              <div
                key={b.id}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
              >
                <div>
                  <span className="font-bold text-[#123F91]">{b.title}</span>
                  {b.subtitle && <span className="text-slate-700 ml-2">— {b.subtitle}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* PHARMACIES & MAP PRIMARY VIEW */}
        {view === 'pharmacies' && (
          <div className="space-y-6">
            {/* Hero Section */}
            <section className="rounded-2xl bg-[#123F91] text-white p-5 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              <div className="lg:col-span-6 space-y-4">
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-300">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Verified Ethiopian Pharmacy Network · 50 Birr / 1 Month Registration</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight text-balance">
                  {t.heroTitle}
                </h1>
                <p className="text-sm text-blue-100 leading-relaxed max-w-2xl">
                  {t.heroSubtitle}
                </p>

                <div className="flex flex-col sm:flex-row flex-wrap gap-2.5 sm:gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => void openPrescriptionModal('prescription')}
                    className="w-full sm:w-auto min-h-[46px] inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#43B02A] text-white text-sm font-bold hover:bg-[#389822] shadow-sm transition-colors"
                  >
                    <Upload className="w-4 h-4 shrink-0" />
                    {t.uploadPrescriptionBtn}
                  </button>
                  <button
                    type="button"
                    onClick={() => void openPrescriptionModal('medicine_image')}
                    className="w-full sm:w-auto min-h-[46px] inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white text-[#123F91] text-sm font-bold hover:bg-blue-50 transition-colors"
                  >
                    <Camera className="w-4 h-4 shrink-0" />
                    {t.uploadMedicineImageBtn}
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('pharmacy_portal')}
                    className="w-full sm:w-auto min-h-[46px] inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/30 text-white text-sm font-semibold hover:bg-white/10 transition-colors"
                  >
                    <Building2 className="w-4 h-4 shrink-0" />
                    {t.registerPharmacy}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/15 max-w-md">
                  <div>
                    <div className="text-lg font-bold tabular-nums">
                      {approvedPharmacies.length}
                    </div>
                    <div className="text-[11px] text-blue-200">Verified Pharmacies</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold tabular-nums">{registrationFeeEtb} ETB</div>
                    <div className="text-[11px] text-blue-200">1-Month Registration Fee</div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-6">
                <div className="bg-white rounded-xl border border-white/20 p-1.5 sm:p-2 shadow-lg overflow-hidden">
                  <img
                    src="/assets/aistudio/Aplus_Drug_Finder_Ethiopia_Branding_Mockup_31f76b6b.png"
                    alt="Aplus Drug Finder — Find Your Medicine Anywhere in Ethiopia"
                    className="w-full h-auto rounded-lg object-contain block"
                  />
                </div>
              </div>
            </section>

            {/* Pharmacy Search & Filter Bar */}
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t.searchPharmacyPlaceholder}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#123F91]"
                />
              </div>
              <select
                aria-label="Filter by Ethiopian city"
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                className="min-h-[44px] rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white"
              >
                <option value="">{t.allCities}</option>
                {cityOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleUseGps}
                disabled={gpsLoading}
                className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#123F91] text-white text-xs font-bold whitespace-nowrap shrink-0"
              >
                <MapPin className="w-4 h-4" />
                {gpsLoading ? 'Locating...' : t.nearMeBtn}
              </button>
            </div>

            {favorites.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 px-1">
                <Heart className="w-3.5 h-3.5 text-red-500" />
                <span>Saved Pharmacies ({favorites.length}):</span>
                {favorites.slice(0, 5).map((fav) => (
                  <button
                    key={fav.id}
                    type="button"
                    onClick={() => setSearchQuery(fav.targetName)}
                    className="min-h-[32px] text-[#123F91] hover:underline font-medium"
                  >
                    {fav.targetName}
                  </button>
                ))}
              </div>
            )}

            {/* Desktop Split Map + Discovery List; Mobile/Tablet Stacked */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              <div className="xl:col-span-5 xl:sticky xl:top-20">
                <PharmacyMap
                  pharmacies={sortedPharmacies.map((s) => s.pharmacy)}
                  userLocation={userCoords}
                  selectedPharmacy={selectedPharmacy}
                  onSelectPharmacy={setSelectedPharmacy}
                  routeTarget={routeTarget}
                  onClearRoute={() => setRouteTarget(null)}
                  heightClassName="h-[260px] sm:h-[340px] xl:h-[500px]"
                />
              </div>

              <MotionConfig reducedMotion="user">
                <div className="xl:col-span-7 min-w-0">
                  {sortedPharmacies.length === 0 ? (
                    <motion.div
                      key={`empty-${filterAnimationKey}`}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 text-center space-y-3"
                    >
                      <Building2 className="w-8 h-8 text-[#123F91] mx-auto" />
                      <div className="text-sm font-bold text-slate-900">
                        No Verified Pharmacies Found for This Filter
                      </div>
                      <p className="text-xs text-slate-600 max-w-md mx-auto">
                        Pharmacies must register with an authentic EFDA license and pass administrator verification before appearing in public search results.
                      </p>
                      <button
                        type="button"
                        onClick={() => setView('pharmacy_portal')}
                        className="min-h-[42px] px-4 py-2 rounded-lg bg-[#43B02A] text-white text-xs font-semibold"
                      >
                        {t.registerPharmacy}
                      </button>
                    </motion.div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-4">
                      {sortedPharmacies.map(({ pharmacy, distanceKm }, index) => {
                        const pharmReviews = reviews.filter((r) => r.pharmacyId === pharmacy.id);
                        const avgRating =
                          pharmReviews.length > 0
                            ? (
                                pharmReviews.reduce((s, r) => s + r.rating, 0) / pharmReviews.length
                              ).toFixed(1)
                            : null;
                        const isFav = favorites.some(
                          (f) => f.targetType === 'pharmacy' && f.targetId === pharmacy.id
                        );

                        return (
                          <motion.div
                            key={`${filterAnimationKey}-${pharmacy.id}`}
                            initial={{ opacity: 0, y: 14 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              duration: 0.28,
                              delay: Math.min(index * 0.04, 0.24),
                              ease: [0.22, 1, 0.36, 1],
                            }}
                            className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3"
                          >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <h3 className="text-base font-bold text-slate-900">
                                  {pharmacy.name}
                                </h3>
                                <span className="text-xs font-semibold text-[#43B02A]">
                                  · Verified
                                </span>
                              </div>
                              <div className="text-xs text-slate-600 mt-0.5">
                                {[
                                  pharmacy.street,
                                  pharmacy.subCity,
                                  pharmacy.city,
                                  pharmacy.region,
                                ]
                                  .filter(Boolean)
                                  .join(', ')}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void toggleFavorite(pharmacy)}
                              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-slate-100 shrink-0"
                              aria-label="Save pharmacy"
                            >
                              <Heart
                                className={`w-4 h-4 ${
                                  isFav ? 'fill-red-500 text-red-500' : 'text-slate-400'
                                }`}
                              />
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-600">
                            <span className="font-mono tabular-nums">{pharmacy.phone}</span>
                            {pharmacy.openingHours && (
                              <span className="inline-flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                {pharmacy.openingHours}
                              </span>
                            )}
                            {distanceKm !== null && (
                              <span className="font-bold text-[#123F91] tabular-nums">
                                {distanceKm.toFixed(1)} km away
                              </span>
                            )}
                            {avgRating && (
                              <span className="inline-flex items-center gap-1 font-semibold text-amber-600 tabular-nums">
                                <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                                {avgRating} ({pharmReviews.length})
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPharmacy(pharmacy);
                                setRouteTarget(pharmacy);
                              }}
                              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                            >
                              <Navigation className="w-3.5 h-3.5 text-[#123F91]" />
                              {t.getDirections}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void openPrescriptionModal('prescription', pharmacy.id)
                              }
                              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#43B02A] text-white text-xs font-semibold hover:bg-[#389822]"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Send Rx
                            </button>
                            <button
                              type="button"
                              onClick={() => void openChatWithPharmacy(pharmacy)}
                              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#123F91] text-white text-xs font-semibold hover:bg-[#0e3274]"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              Chat
                            </button>
                            <button
                              type="button"
                              onClick={() => void openChatWithPharmacy(pharmacy, 'audio')}
                              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                              title={t.audioCall}
                              aria-label={t.audioCall}
                            >
                              <Phone className="w-4 h-4 text-[#43B02A]" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void openChatWithPharmacy(pharmacy, 'video')}
                              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                              title={t.videoCall}
                              aria-label={t.videoCall}
                            >
                              <Video className="w-4 h-4 text-[#123F91]" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSharePharmacy(pharmacy, distanceKm)}
                              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                              title={`Share ${pharmacy.name}`}
                              aria-label={`Share ${pharmacy.name}`}
                            >
                              <Share2 className="w-3.5 h-3.5 text-[#123F91]" />
                              Share
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setReportTarget({
                                  type: 'pharmacy',
                                  id: pharmacy.id,
                                  label: pharmacy.name,
                                })
                              }
                              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-600"
                              title={t.reportIncorrectInfo}
                              aria-label={t.reportIncorrectInfo}
                            >
                              <Flag className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Reviews & Quick Review Form when selected */}
                          {selectedPharmacy?.id === pharmacy.id && (
                            <div className="pt-3 border-t border-slate-200 space-y-2.5">
                              {pharmReviews.length > 0 && (
                                <div className="space-y-1.5">
                                  <div className="text-xs font-semibold text-slate-800">
                                    Patient Feedback
                                  </div>
                                  {pharmReviews.slice(0, 3).map((rev) => (
                                    <div
                                      key={rev.id}
                                      className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700"
                                    >
                                      <span className="font-semibold text-slate-900">
                                        {rev.customerName}
                                      </span>{' '}
                                      · <span className="text-amber-600">{rev.rating}★</span>
                                      {rev.comment && (
                                        <span className="text-slate-600"> — {rev.comment}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {firebaseUser && (
                                <>
                                  <div className="text-xs font-semibold text-slate-800">
                                    Rate this Pharmacy
                                  </div>
                                  <div className="flex flex-col sm:flex-row gap-2">
                                    <select
                                      value={reviewRating}
                                      onChange={(e) => setReviewRating(Number(e.target.value))}
                                      className="min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
                                    >
                                      {[5, 4, 3, 2, 1].map((n) => (
                                        <option key={n} value={n}>
                                          {n} Stars
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="text"
                                      value={reviewComment}
                                      onChange={(e) => setReviewComment(e.target.value)}
                                      placeholder="Optional feedback..."
                                      className="flex-1 min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => void submitReview(pharmacy)}
                                      className="min-h-[40px] px-4 py-1.5 rounded-lg bg-[#123F91] text-white text-xs font-semibold"
                                    >
                                      Submit
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
              </MotionConfig>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
              {t.noFakeDiagnosisNotice}
            </div>
          </div>
        )}

        {/* PRESCRIPTION REQUESTS TRACKER VIEW */}
        {view === 'prescriptions' && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  My Prescription & Packaging Photo Requests
                </h2>
                <p className="text-xs text-slate-600">
                  Compare isolated availability responses, ETB totals, and preparation times from each selected pharmacy.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => void openPrescriptionModal('prescription')}
                  className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#43B02A] text-white text-xs font-bold"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {t.uploadPrescriptionBtn}
                </button>
                <button
                  type="button"
                  onClick={() => void openPrescriptionModal('medicine_image')}
                  className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#123F91] text-white text-xs font-bold"
                >
                  <Camera className="w-3.5 h-3.5" />
                  {t.uploadMedicineImageBtn}
                </button>
              </div>
            </div>

            {!firebaseUser ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 text-center space-y-3">
                <FileText className="w-8 h-8 text-[#123F91] mx-auto" />
                <p className="text-sm text-slate-600">
                  Sign in and pay the {registrationFeeEtb} Birr 1-month registration fee to upload prescriptions securely and compare pharmacy responses.
                </p>
                <button
                  type="button"
                  onClick={() => void signInWithGoogle('customer')}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#123F91] text-white text-xs font-semibold"
                >
                  {t.signIn}
                </button>
              </div>
            ) : groupedPrescriptions.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
                You have not sent any prescription requests yet.
              </div>
            ) : (
              groupedPrescriptions.map(([requestId, list]) => (
                <div
                  key={requestId}
                  className="bg-white rounded-2xl border border-slate-200 overflow-hidden"
                >
                  <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="min-w-0 break-all sm:break-normal">
                      <span className="font-bold text-slate-900 uppercase">
                        {list[0].requestType.replace('_', ' ')}
                      </span>{' '}
                      · Request ID <span className="font-mono">{requestId}</span> ·{' '}
                      {formatTimestamp(list[0].createdAt)}
                    </div>
                    <span className="text-slate-600 shrink-0">
                      Sent to {list.length} verified pharmac{list.length === 1 ? 'y' : 'ies'}
                    </span>
                  </div>

                  <div className="divide-y divide-slate-200">
                    {list.map((a) => {
                      const pharmObj = approvedPharmacies.find((p) => p.id === a.pharmacyId);
                      return (
                        <div
                          key={a.id}
                          className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                              <span>{a.pharmacyName}</span>
                              <span className="text-xs font-semibold uppercase text-[#123F91]">
                                · {a.status.replace('_', ' ')}
                              </span>
                            </div>
                            <div className="text-xs text-slate-600">
                              {a.pharmacyLocationText} · {a.pharmacyPhone}
                            </div>
                            {a.responseNotes && (
                              <div className="text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 mt-1">
                                Pharmacist Note: {a.responseNotes}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                            {typeof a.estimatedTotalEtb === 'number' && (
                              <div className="sm:text-right mr-2">
                                <div className="text-sm font-bold text-[#43B02A] tabular-nums">
                                  {formatEtb(a.estimatedTotalEtb)}
                                </div>
                                {typeof a.estimatedPrepMinutes === 'number' && (
                                  <div className="text-[11px] text-slate-500 tabular-nums">
                                    Ready in {a.estimatedPrepMinutes} mins
                                  </div>
                                )}
                              </div>
                            )}

                            {pharmObj && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void openChatWithPharmacy(pharmObj)}
                                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#123F91] text-white text-xs font-semibold"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                  Chat
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRouteTarget(pharmObj);
                                    setView('pharmacies');
                                  }}
                                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold"
                                >
                                  <Navigation className="w-3.5 h-3.5 text-[#123F91]" />
                                  Directions
                                </button>
                              </>
                            )}

                            {a.status !== 'completed' && a.status !== 'cancelled' && (
                              <button
                                type="button"
                                onClick={() =>
                                  void updateDoc(doc(db, 'prescriptionAssignments', a.id), {
                                    status: 'completed',
                                    updatedAt: serverTimestamp(),
                                  })
                                }
                                className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 text-[#43B02A] text-xs font-semibold hover:bg-emerald-50"
                              >
                                <Check className="w-3.5 h-3.5" />
                                Mark Picked Up
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* MESSAGES & CALLS INBOX VIEW */}
        {view === 'messages' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Direct Pharmacy Chats & WebRTC Calls
              </h2>
            </div>
            {!firebaseUser ? (
              <div className="p-6 sm:p-8 text-center text-sm text-slate-600">
                Sign in and pay the {registrationFeeEtb} Birr 1-month registration fee to message or call verified pharmacies directly.
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-6 sm:p-8 text-center text-sm text-slate-500">
                No conversations yet. Select any verified pharmacy to start a chat or audio/video call.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {conversations.map((conv) => {
                  const otherName =
                    conv.customerUid === firebaseUser.uid ? conv.pharmacyName : conv.customerName;
                  return (
                    <div
                      key={conv.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 truncate">
                          {otherName}
                        </div>
                        <div className="text-xs text-slate-500 truncate mt-0.5">
                          {conv.lastMessage || 'Open conversation'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            if (await ensurePaidAccess('open pharmacy chats')) {
                              setActiveChat({ conversation: conv });
                            }
                          }}
                          className="flex-1 sm:flex-none min-h-[42px] px-3.5 py-1.5 rounded-lg bg-[#123F91] text-white text-xs font-semibold"
                        >
                          Open Chat
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (await ensurePaidAccess('start audio calls')) {
                              setActiveChat({ conversation: conv, callMode: 'audio' });
                            }
                          }}
                          className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-lg border border-slate-300 text-[#43B02A]"
                          title={t.audioCall}
                          aria-label={t.audioCall}
                        >
                          <Phone className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (await ensurePaidAccess('start video calls')) {
                              setActiveChat({ conversation: conv, callMode: 'video' });
                            }
                          }}
                          className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-lg border border-slate-300 text-[#123F91]"
                          title={t.videoCall}
                          aria-label={t.videoCall}
                        >
                          <Video className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* PHARMACY PORTAL VIEW */}
        {view === 'pharmacy_portal' && (
          <PharmacyPortal
            onOpenChat={(conv, callMode) => setActiveChat({ conversation: conv, callMode })}
            onOpenSubscription={(reason) => openFeeModal(reason)}
          />
        )}

        {/* ADMIN PORTAL VIEW */}
        {view === 'admin' && isAdmin && (
          <AdminPortal
            pharmacies={pharmacies}
            locations={locations}
            banners={banners}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white mt-auto pb-16 lg:pb-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#123F91] shrink-0" />
            <span className="font-semibold text-slate-800">{t.appName}</span>
            <span>· {t.slogan}</span>
          </div>
          <div>
            Verified Ethiopian pharmacy connection platform · {registrationFeeEtb} Birr / 1-month registration fee
          </div>
        </div>
      </footer>

      {/* Mobile & Tablet Fixed Bottom Navigation Bar */}
      <nav
        aria-label="Primary mobile navigation"
        className={`lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe grid ${
          isAdmin ? 'grid-cols-5' : 'grid-cols-4'
        }`}
      >
        {(
          [
            ['pharmacies', t.navPharmacies, MapPin],
            ['prescriptions', t.navPrescriptions, FileText],
            ['messages', t.navMessages, MessageSquare],
            ['pharmacy_portal', t.navPharmacyPortal, Building2],
          ] as const
        ).map(([key, label, Icon]) => {
          const active = view === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`min-h-[56px] px-1 py-1.5 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-[#123F91]' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className={`w-5 h-5 ${active ? 'stroke-[2.4]' : ''}`} />
              <span className="text-[10px] font-semibold tracking-tight truncate max-w-full">
                {label}
              </span>
            </button>
          );
        })}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setView('admin')}
            className={`min-h-[56px] px-1 py-1.5 flex flex-col items-center justify-center gap-0.5 transition-colors ${
              view === 'admin' ? 'text-[#43B02A]' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldCheck className={`w-5 h-5 ${view === 'admin' ? 'stroke-[2.4]' : ''}`} />
            <span className="text-[10px] font-semibold tracking-tight truncate max-w-full">
              {t.navAdmin}
            </span>
          </button>
        )}
      </nav>

      {/* Report Incorrect Info Modal */}
      {reportTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={submitReport}
            className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 max-w-md w-full p-5 sm:p-6 pb-safe space-y-4 shadow-2xl max-h-[92dvh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-slate-900">Report Incorrect Info</h3>
              <button
                type="button"
                onClick={() => setReportTarget(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={reportSubject}
              onChange={(e) => setReportSubject(e.target.value)}
              placeholder={`Subject (${reportTarget.label})`}
              className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <textarea
              required
              rows={3}
              value={reportDesc}
              onChange={(e) => setReportDesc(e.target.value)}
              placeholder="Describe the incorrect location, hours, or pharmacy issue..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                type="button"
                onClick={() => setReportTarget(null)}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-lg bg-[#123F91] text-white text-xs font-semibold"
              >
                Submit Report
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Global Modals */}
      <OnboardingModal />
      <PrescriptionUploadModal
        open={rxModalOpen}
        initialMode={rxModalMode}
        pharmacies={approvedPharmacies}
        preselectedPharmacyId={rxPreselectedPharmacyId}
        onClose={() => setRxModalOpen(false)}
        onSubmitted={(reqId) => {
          setRxModalOpen(false);
          setView('prescriptions');
          showToast(`Encrypted request ${reqId} delivered to selected pharmacies.`);
        }}
      />
      <ChatAndCallModal
        open={Boolean(activeChat)}
        conversation={activeChat?.conversation || null}
        initialCallMode={activeChat?.callMode || null}
        acceptingIncomingCall={activeChat?.accepting || null}
        onClose={() => setActiveChat(null)}
      />
      <SubscriptionModal
        open={subscriptionModalOpen}
        reason={subscriptionReason}
        onClose={() => {
          setSubscriptionModalOpen(false);
          setSubscriptionReason(null);
        }}
      />
      <AccountModal
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        onOpenSubscription={() => openFeeModal()}
      />
    </div>
  );
}
