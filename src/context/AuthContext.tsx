import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  googleAuthProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  LanguageCode,
  NotificationItem,
  Pharmacy,
  SubscriptionRecord,
  SystemSettings,
  UserPrivateInfo,
  UserProfile,
  UserRole,
} from '../types';
import { TRANSLATIONS, TranslationBundle } from '../i18n/translations';

export interface IncomingCallPayload {
  callId: string;
  conversationId: string;
  callerUid: string;
  callerName: string;
  callType: 'audio' | 'video';
}

export interface NotificationAlertItem {
  id: string;
  title: string;
  body: string;
  kind: 'received' | 'sent';
  createdAt: number;
}

interface AuthContextValue {
  firebaseUser: User | null;
  authReady: boolean;
  profile: UserProfile | null;
  privateInfo: UserPrivateInfo | null;
  isAdmin: boolean;
  myPharmacy: Pharmacy | null;
  subscription: SubscriptionRecord | null;
  settings: SystemSettings;
  notifications: NotificationItem[];
  unreadCount: number;
  language: LanguageCode;
  t: TranslationBundle;
  setLanguage: (lang: LanguageCode) => Promise<void>;
  signInWithGoogle: (preferredRole?: 'customer' | 'pharmacy') => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  needsRoleSelection: boolean;
  completeOnboarding: (params: {
    role: 'customer' | 'pharmacy';
    displayName: string;
    city: string;
    phone: string;
  }) => Promise<void>;
  wsConnected: boolean;
  onlineUids: string[];
  sendWsEvent: (payload: Record<string, unknown>) => void;
  addWsListener: (listener: (msg: Record<string, unknown>) => void) => () => void;
  incomingCall: IncomingCallPayload | null;
  clearIncomingCall: () => void;
  notificationPermission: NotificationPermission | 'unsupported';
  requestBrowserNotifications: () => Promise<void>;
  playNotificationChime: (variant?: 'alert' | 'sent' | 'call', force?: boolean) => void;
  activeAlert: NotificationAlertItem | null;
  dismissAlert: () => void;
  triggerNotificationAlert: (params: {
    title: string;
    body: string;
    kind?: 'received' | 'sent';
    playSound?: boolean;
  }) => void;
}

const DEFAULT_SETTINGS: SystemSettings = {
  customerMonthlyPriceEtb: 50,
  pharmacyMonthlyPriceEtb: 50,
  subscriptionDurationDays: 30,
  maxPrescriptionFiles: 8,
  maxFileSizeMb: 15,
  retentionDays: 90,
};

const AuthContext = createContext<AuthContextValue | null>(null);

const LANGUAGE_STORAGE_KEY = 'aplus_language';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [privateInfo, setPrivateInfo] = useState<UserPrivateInfo | null>(null);
  const [isAdminDoc, setIsAdminDoc] = useState(false);
  const [myPharmacy, setMyPharmacy] = useState<Pharmacy | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(null);
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [needsRoleSelection, setNeedsRoleSelection] = useState(false);
  const [preferredRoleOnSignIn, setPreferredRoleOnSignIn] = useState<'customer' | 'pharmacy' | null>(null);

  const [language, setLanguageState] = useState<LanguageCode>(() => {
    try {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY) as LanguageCode | null;
      if (saved && TRANSLATIONS[saved]) return saved;
    } catch {
      // Ignore storage errors
    }
    return 'en';
  });

  const [wsConnected, setWsConnected] = useState(false);
  const [onlineUids, setOnlineUids] = useState<string[]>([]);
  const [incomingCall, setIncomingCall] = useState<IncomingCallPayload | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'));

  const [activeAlert, setActiveAlert] = useState<NotificationAlertItem | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const wsListenersRef = useRef<Set<(msg: Record<string, unknown>) => void>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  const notifHydratedRef = useRef(false);
  const lastAlertSigRef = useRef<{ sig: string; at: number } | null>(null);
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getUnlockedAudioCtx = useCallback((): AudioContext | null => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx();
      }
      if (audioCtxRef.current.state === 'suspended') {
        void audioCtxRef.current.resume().catch(() => {});
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  // Unlock browser AudioContext on first user interaction so async alert sounds always play
  useEffect(() => {
    const unlock = () => {
      const ctx = getUnlockedAudioCtx();
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [getUnlockedAudioCtx]);

  const playNotificationChime = useCallback(
    (variant: 'alert' | 'sent' | 'call' = 'alert', force = false) => {
      if (!force && profile?.notificationSoundEnabled === false) return;
      const ctx = getUnlockedAudioCtx();
      if (!ctx) return;
      try {
        const playTone = (freq: number, startOffset: number, duration: number, peakGain: number) => {
          const startAt = ctx.currentTime + startOffset;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = variant === 'call' ? 'triangle' : 'sine';
          osc.frequency.setValueAtTime(freq, startAt);
          gain.gain.setValueAtTime(0.0001, startAt);
          gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startAt);
          osc.stop(startAt + duration + 0.02);
        };

        if (variant === 'sent') {
          playTone(587.33, 0, 0.11, 0.08); // D5
          playTone(880.0, 0.09, 0.18, 0.09); // A5
        } else if (variant === 'call') {
          playTone(659.25, 0, 0.16, 0.1);
          playTone(880.0, 0.14, 0.18, 0.1);
          playTone(659.25, 0.36, 0.16, 0.1);
          playTone(880.0, 0.5, 0.22, 0.1);
        } else {
          // Crisp two-tone medical alert chime
          playTone(783.99, 0, 0.14, 0.1); // G5
          playTone(1046.5, 0.11, 0.28, 0.11); // C6
        }
      } catch {
        // Audio playback blocked prior to user gesture
      }
    },
    [profile?.notificationSoundEnabled, getUnlockedAudioCtx]
  );

  const dismissAlert = useCallback(() => {
    if (alertTimerRef.current) {
      clearTimeout(alertTimerRef.current);
      alertTimerRef.current = null;
    }
    setActiveAlert(null);
  }, []);

  const triggerNotificationAlert = useCallback(
    (params: {
      title: string;
      body: string;
      kind?: 'received' | 'sent';
      playSound?: boolean;
    }) => {
      const kind = params.kind || 'received';
      const sig = `${kind}:${params.title}:${params.body}`;
      const now = Date.now();
      if (
        lastAlertSigRef.current &&
        lastAlertSigRef.current.sig === sig &&
        now - lastAlertSigRef.current.at < 3000
      ) {
        return;
      }
      lastAlertSigRef.current = { sig, at: now };

      if (params.playSound !== false) {
        playNotificationChime(kind === 'sent' ? 'sent' : 'alert');
      }

      setActiveAlert({
        id: `alert_${now}_${Math.random().toString(36).slice(2, 6)}`,
        title: params.title,
        body: params.body,
        kind,
        createdAt: now,
      });

      if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
      alertTimerRef.current = setTimeout(() => {
        setActiveAlert(null);
        alertTimerRef.current = null;
      }, 6000);
    },
    [playNotificationChime]
  );

  const requestBrowserNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      setNotificationPermission('unsupported');
      return;
    }
    const result = await Notification.requestPermission();
    setNotificationPermission(result);
  }, []);

  // Load systemSettings (public safety & pricing config)
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'systemSettings', 'global'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as SystemSettings;
          setSettings({ ...DEFAULT_SETTINGS, ...data });
        }
      },
      () => {
        // Use defaults if uninitialized
      }
    );
    return () => unsub();
  }, []);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setProfile(null);
        setPrivateInfo(null);
        setIsAdminDoc(false);
        setMyPharmacy(null);
        setSubscription(null);
        setNotifications([]);
        seenNotifIdsRef.current = new Set();
        notifHydratedRef.current = false;
        setNeedsRoleSelection(false);
      }
    });
    return () => unsub();
  }, []);

  // Load user profile, private info, admin status, pharmacy, subscription, and notifications
  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    const uid = firebaseUser.uid;

    const unsubUser = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setProfile(data);
          setNeedsRoleSelection(false);
          if (data.language && TRANSLATIONS[data.language]) {
            setLanguageState(data.language);
          }
        } else {
          setProfile(null);
          setNeedsRoleSelection(true);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}`)
    );

    const unsubPrivate = onSnapshot(
      doc(db, 'users', uid, 'private', 'info'),
      (snap) => {
        setPrivateInfo(snap.exists() ? (snap.data() as UserPrivateInfo) : null);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}/private/info`)
    );

    const unsubAdmin = onSnapshot(
      doc(db, 'admins', uid),
      (snap) => {
        setIsAdminDoc(snap.exists());
      },
      () => setIsAdminDoc(false)
    );

    const unsubSub = onSnapshot(
      doc(db, 'subscriptions', uid),
      (snap) => {
        setSubscription(snap.exists() ? (snap.data() as SubscriptionRecord) : null);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `subscriptions/${uid}`)
    );

    const pharmQ = query(collection(db, 'pharmacies'), where('ownerUid', '==', uid));
    const unsubPharm = onSnapshot(
      pharmQ,
      (snap) => {
        if (!snap.empty) {
          setMyPharmacy({ ...snap.docs[0].data(), id: snap.docs[0].id } as Pharmacy);
        } else {
          setMyPharmacy(null);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'pharmacies')
    );

    const handleNotifSnapshotItems = (rawItems: NotificationItem[]) => {
      const sorted = [...rawItems].sort((a, b) => {
        const aSec =
          typeof a.createdAt === 'object' && a.createdAt && 'seconds' in (a.createdAt as Record<string, unknown>)
            ? Number((a.createdAt as { seconds: number }).seconds)
            : 0;
        const bSec =
          typeof b.createdAt === 'object' && b.createdAt && 'seconds' in (b.createdAt as Record<string, unknown>)
            ? Number((b.createdAt as { seconds: number }).seconds)
            : 0;
        return bSec - aSec;
      });
      setNotifications(sorted);

      if (!notifHydratedRef.current) {
        sorted.forEach((n) => seenNotifIdsRef.current.add(n.id));
        notifHydratedRef.current = true;
        return;
      }

      const newlyArrivedUnread = sorted.filter(
        (n) => !n.read && !seenNotifIdsRef.current.has(n.id)
      );
      sorted.forEach((n) => seenNotifIdsRef.current.add(n.id));

      if (newlyArrivedUnread.length > 0) {
        const latest = newlyArrivedUnread[0];
        triggerNotificationAlert({
          title: latest.title,
          body: latest.body,
          kind: 'received',
        });
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(latest.title, { body: latest.body, icon: '/aplus-app-icon.png' });
        }
      }
    };

    const notifQ = query(
      collection(db, 'notifications'),
      where('recipientUid', '==', uid),
      orderBy('createdAt', 'desc')
    );
    let unsubFallbackNotif: (() => void) | null = null;
    const unsubNotif = onSnapshot(
      notifQ,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as NotificationItem));
        handleNotifSnapshotItems(items);
      },
      () => {
        // Fallback without orderBy if composite index isn't created yet
        const fallbackQ = query(collection(db, 'notifications'), where('recipientUid', '==', uid));
        unsubFallbackNotif = onSnapshot(
          fallbackQ,
          (snap2) => {
            const items = snap2.docs.map((d) => ({ id: d.id, ...d.data() } as NotificationItem));
            handleNotifSnapshotItems(items);
          },
          (err2) => handleFirestoreError(err2, OperationType.LIST, 'notifications')
        );
      }
    );

    return () => {
      unsubUser();
      unsubPrivate();
      unsubAdmin();
      unsubSub();
      unsubPharm();
      unsubNotif();
      if (unsubFallbackNotif) unsubFallbackNotif();
    };
  }, [authReady, firebaseUser, triggerNotificationAlert]);

  // WebSocket connection for real-time WebRTC signaling, typing indicators, and presence
  useEffect(() => {
    if (!firebaseUser) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWs = async () => {
      try {
        const token = await firebaseUser.getIdToken();
        if (cancelled) return;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as Record<string, unknown>;
            if (data.type === 'presence:list' && Array.isArray(data.onlineUids)) {
              setOnlineUids(data.onlineUids as string[]);
            } else if (data.type === 'call:incoming') {
              setIncomingCall({
                callId: String(data.callId || ''),
                conversationId: String(data.conversationId || ''),
                callerUid: String(data.callerUid || ''),
                callerName: String(data.callerName || 'Pharmacy Caller'),
                callType: data.callType === 'video' ? 'video' : 'audio',
              });
              playNotificationChime('call');
            } else if (data.type === 'notification:push') {
              const notifObj =
                data.notification && typeof data.notification === 'object'
                  ? (data.notification as { title?: unknown; body?: unknown })
                  : {};
              const title = String(notifObj.title || 'New Alert');
              const body = String(notifObj.body || 'You have a new update on Aplus Drug Finder.');
              triggerNotificationAlert({ title, body, kind: 'received' });
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                new Notification(title, { body, icon: '/aplus-app-icon.png' });
              }
            }
            for (const listener of wsListenersRef.current) {
              listener(data);
            }
          } catch {
            // Ignore malformed socket message
          }
        };

        ws.onclose = () => {
          setWsConnected(false);
          if (!cancelled) {
            reconnectTimer = setTimeout(connectWs, 4000);
          }
        };
      } catch {
        if (!cancelled) {
          reconnectTimer = setTimeout(connectWs, 5000);
        }
      }
    };

    void connectWs();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [firebaseUser, playNotificationChime, triggerNotificationAlert]);

  const sendWsEvent = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const addWsListener = useCallback((listener: (msg: Record<string, unknown>) => void) => {
    wsListenersRef.current.add(listener);
    return () => {
      wsListenersRef.current.delete(listener);
    };
  }, []);

  const isAdmin = Boolean(
    isAdminDoc ||
      (firebaseUser?.emailVerified &&
        firebaseUser?.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) ||
      (profile?.role && ['admin', 'super_admin', 'moderator', 'support'].includes(profile.role))
  );

  const completeOnboarding = useCallback(
    async (params: {
      role: 'customer' | 'pharmacy';
      displayName: string;
      city: string;
      phone: string;
    }) => {
      if (!firebaseUser) return;
      const uid = firebaseUser.uid;
      const isBootAdmin =
        firebaseUser.emailVerified &&
        firebaseUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

      const assignedRole: UserRole = isBootAdmin ? 'super_admin' : params.role;
      const initialSubStatus = isBootAdmin ? 'active' : 'expired';

      try {
        await setDoc(doc(db, 'users', uid), {
          uid,
          displayName: params.displayName.trim() || firebaseUser.displayName || 'Aplus Member',
          role: assignedRole,
          city: params.city.trim() || 'Addis Ababa',
          language,
          photoUrl: firebaseUser.photoURL || '',
          notificationSoundEnabled: true,
          accessibilityHighContrast: false,
          subscriptionStatus: initialSubStatus,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await setDoc(doc(db, 'users', uid, 'private', 'info'), {
          uid,
          email: firebaseUser.email || '',
          phone: params.phone.trim(),
          phoneVerified: false,
          emailVerified: Boolean(firebaseUser.emailVerified),
          mfaEnabled: isBootAdmin,
          consentGivenAt: new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });

        if (!isBootAdmin) {
          const priceEtb =
            params.role === 'pharmacy'
              ? settings.pharmacyMonthlyPriceEtb
              : settings.customerMonthlyPriceEtb;
          await setDoc(doc(db, 'subscriptions', uid), {
            uid,
            role: params.role,
            status: 'expired',
            priceEtb,
            durationDays: settings.subscriptionDurationDays,
            updatedAt: serverTimestamp(),
          });
        }
        setNeedsRoleSelection(false);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
      }
    },
    [firebaseUser, language, settings]
  );

  const signInWithGoogle = useCallback(
    async (preferredRole?: 'customer' | 'pharmacy') => {
      if (preferredRole) setPreferredRoleOnSignIn(preferredRole);
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const user = cred.user;
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists() && preferredRole) {
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          displayName: user.displayName || 'Aplus Member',
          role:
            user.emailVerified &&
            user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
              ? 'super_admin'
              : preferredRole,
          city: 'Addis Ababa',
          language,
          photoUrl: user.photoURL || '',
          notificationSoundEnabled: true,
          accessibilityHighContrast: false,
          subscriptionStatus:
            user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
              ? 'active'
              : 'expired',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await setDoc(doc(db, 'users', user.uid, 'private', 'info'), {
          uid: user.uid,
          email: user.email || '',
          phone: '',
          phoneVerified: false,
          emailVerified: Boolean(user.emailVerified),
          consentGivenAt: new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });
      }
    },
    [language]
  );

  // If preferredRoleOnSignIn wasn't passed, onboarding modal handles selection
  useEffect(() => {
    if (profile && preferredRoleOnSignIn) {
      setPreferredRoleOnSignIn(null);
    }
  }, [profile, preferredRoleOnSignIn]);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!firebaseUser) return;
    const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
    if (snap.exists()) {
      setProfile(snap.data() as UserProfile);
    }
  }, [firebaseUser]);

  const setLanguage = useCallback(
    async (lang: LanguageCode) => {
      setLanguageState(lang);
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      } catch {
        // Ignore
      }
      if (firebaseUser && profile) {
        try {
          await updateDoc(doc(db, 'users', firebaseUser.uid), {
            language: lang,
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Non-blocking
        }
      }
    },
    [firebaseUser, profile]
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        authReady,
        profile,
        privateInfo,
        isAdmin,
        myPharmacy,
        subscription,
        settings,
        notifications,
        unreadCount,
        language,
        t: TRANSLATIONS[language],
        setLanguage,
        signInWithGoogle,
        signOut,
        refreshProfile,
        needsRoleSelection,
        completeOnboarding,
        wsConnected,
        onlineUids,
        sendWsEvent,
        addWsListener,
        incomingCall,
        clearIncomingCall: () => setIncomingCall(null),
        notificationPermission,
        requestBrowserNotifications,
        playNotificationChime,
        activeAlert,
        dismissAlert,
        triggerNotificationAlert,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
