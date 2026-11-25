import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileText,
  Mic,
  MicOff,
  Paperclip,
  Phone,
  PhoneOff,
  Send,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getSignedFileUrl, uploadEncryptedFile } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { CallRecord, ChatMessage, Conversation } from '../types';
import { formatTimestamp } from '../lib/geo';

interface ChatAndCallModalProps {
  open: boolean;
  conversation: Conversation | null;
  initialCallMode?: 'audio' | 'video' | null;
  acceptingIncomingCall?: {
    callId: string;
    callerUid: string;
    callerName: string;
    callType: 'audio' | 'video';
  } | null;
  onClose: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export const ChatAndCallModal: React.FC<ChatAndCallModalProps> = ({
  open,
  conversation,
  initialCallMode,
  acceptingIncomingCall,
  onClose,
}) => {
  const {
    firebaseUser,
    profile,
    onlineUids,
    sendWsEvent,
    addWsListener,
    clearIncomingCall,
    playNotificationChime,
  } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<{
    url: string;
    name: string;
    mimeType: string;
  } | null>(null);

  // WebRTC call state
  const [callState, setCallState] = useState<'idle' | 'calling' | 'connecting' | 'active'>('idle');
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myUid = firebaseUser?.uid || '';
  const peerUid = conversation
    ? conversation.customerUid === myUid
      ? conversation.pharmacyOwnerUid
      : conversation.customerUid
    : '';
  const peerName = conversation
    ? conversation.customerUid === myUid
      ? conversation.pharmacyName
      : conversation.customerName
    : '';
  const peerOnline = Boolean(peerUid && onlineUids.includes(peerUid));

  // Cleanup WebRTC media & connection
  const teardownCall = useCallback(
    async (finalStatus: 'ended' | 'declined' | 'missed' = 'ended') => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((tr) => tr.stop());
        localStreamRef.current = null;
      }
      remoteStreamRef.current = null;
      if (activeCallId) {
        try {
          await updateDoc(doc(db, 'calls', activeCallId), {
            status: finalStatus,
            durationSeconds: callSeconds,
          });
        } catch {
          // Non-blocking
        }
      }
      setCallState('idle');
      setActiveCallId(null);
      setCallSeconds(0);
      setMuted(false);
      setCameraOff(false);
    },
    [activeCallId, callSeconds]
  );

  // Call timer
  useEffect(() => {
    if (callState !== 'active') return;
    const timer = setInterval(() => {
      setCallSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [callState]);

  // Listen for Firestore messages
  useEffect(() => {
    if (!open || !conversation || !myUid) return;
    const q = query(
      collection(db, 'conversations', conversation.id, 'messages'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
      setMessages(rows);
      // Mark unread messages from peer as read
      rows.forEach((m) => {
        if (m.senderUid !== myUid && !m.readAt) {
          updateDoc(doc(db, 'conversations', conversation.id, 'messages', m.id), {
            readAt: new Date().toISOString(),
          }).catch(() => {});
        }
      });
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    });
    return () => unsub();
  }, [open, conversation, myUid]);

  const createPeerConnection = useCallback(
    async (targetCallId: string, mode: 'audio' | 'video') => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === 'video',
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const remoteStream = new MediaStream();
      remoteStreamRef.current = remoteStream;

      pc.ontrack = (ev) => {
        ev.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
        }
        setCallState('active');
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate && peerUid) {
          sendWsEvent({
            type: 'webrtc:ice-candidate',
            targetUid: peerUid,
            callId: targetCallId,
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setCallState('active');
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          void teardownCall('ended');
        }
      };

      return pc;
    },
    [peerUid, sendWsEvent, teardownCall]
  );

  const startCall = useCallback(
    async (mode: 'audio' | 'video') => {
      if (!conversation || !myUid || !peerUid) return;
      setError(null);
      try {
        const newCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        setCallType(mode);
        setActiveCallId(newCallId);
        setCallState('calling');

        await setDoc(doc(db, 'calls', newCallId), {
          conversationId: conversation.id,
          callerUid: myUid,
          calleeUid: peerUid,
          pharmacyId: conversation.pharmacyId,
          callType: mode,
          status: 'ringing',
          durationSeconds: 0,
          createdAt: serverTimestamp(),
        } as Omit<CallRecord, 'id'>);

        await createPeerConnection(newCallId, mode);

        sendWsEvent({
          type: 'call:initiate',
          targetUid: peerUid,
          callId: newCallId,
          conversationId: conversation.id,
          callerName: profile?.displayName || 'Aplus User',
          callType: mode,
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? `Microphone/camera permission error: ${err.message}`
            : 'Unable to access microphone or camera.'
        );
        void teardownCall('missed');
      }
    },
    [conversation, myUid, peerUid, profile?.displayName, createPeerConnection, sendWsEvent, teardownCall]
  );

  // Auto-trigger initial call mode or accept incoming call
  useEffect(() => {
    if (!open || !conversation) return;
    if (acceptingIncomingCall && callState === 'idle') {
      const { callId, callerUid, callType: incomingType } = acceptingIncomingCall;
      setCallType(incomingType);
      setActiveCallId(callId);
      setCallState('connecting');
      createPeerConnection(callId, incomingType)
        .then(() => {
          sendWsEvent({
            type: 'call:accept',
            targetUid: callerUid,
            callId,
          });
          clearIncomingCall();
        })
        .catch(() => {
          setError('Microphone/camera access denied.');
          clearIncomingCall();
          void teardownCall('declined');
        });
    } else if (initialCallMode && callState === 'idle') {
      void startCall(initialCallMode);
    }
  }, [
    open,
    conversation,
    acceptingIncomingCall,
    initialCallMode,
    callState,
    createPeerConnection,
    sendWsEvent,
    clearIncomingCall,
    startCall,
    teardownCall,
  ]);

  // Listen to WebSocket signaling events
  useEffect(() => {
    if (!open || !conversation) return;
    return addWsListener(async (msg) => {
      if (msg.type === 'chat:typing' && msg.conversationId === conversation.id && msg.senderUid === peerUid) {
        setPeerTyping(Boolean(msg.isTyping));
      } else if (msg.type === 'call:accepted' && activeCallId && msg.callId === activeCallId && pcRef.current) {
        const currentCallId = activeCallId;
        setCallState('connecting');
        const offer = await pcRef.current.createOffer();
        await pcRef.current.setLocalDescription(offer);
        sendWsEvent({
          type: 'webrtc:offer',
          targetUid: peerUid,
          callId: currentCallId,
          sdp: offer,
        });
        updateDoc(doc(db, 'calls', currentCallId), { status: 'active' }).catch(() => {});
      } else if (msg.type === 'call:declined' && msg.callId === activeCallId) {
        setError('Call declined by recipient.');
        await teardownCall('declined');
      } else if (msg.type === 'call:ended' && msg.callId === activeCallId) {
        await teardownCall('ended');
      } else if (msg.type === 'webrtc:offer' && msg.callId === activeCallId && pcRef.current) {
        await pcRef.current.setRemoteDescription(
          new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit)
        );
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        sendWsEvent({
          type: 'webrtc:answer',
          targetUid: peerUid,
          callId: activeCallId,
          sdp: answer,
        });
        setCallState('active');
      } else if (msg.type === 'webrtc:answer' && msg.callId === activeCallId && pcRef.current) {
        await pcRef.current.setRemoteDescription(
          new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit)
        );
        setCallState('active');
      } else if (msg.type === 'webrtc:ice-candidate' && msg.callId === activeCallId && pcRef.current) {
        try {
          await pcRef.current.addIceCandidate(
            new RTCIceCandidate(msg.candidate as RTCIceCandidateInit)
          );
        } catch {
          // Ignore late ICE candidate
        }
      }
    });
  }, [open, conversation, peerUid, activeCallId, addWsListener, sendWsEvent, teardownCall]);

  if (!open || !conversation) return null;

  const sendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !myUid || !profile) return;

    setSending(true);
    setError(null);
    try {
      const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const senderRole =
        conversation.pharmacyOwnerUid === myUid && profile.role === 'pharmacy'
          ? 'pharmacy'
          : 'customer';

      await setDoc(doc(db, 'conversations', conversation.id, 'messages', msgId), {
        conversationId: conversation.id,
        senderUid: myUid,
        customerUid: conversation.customerUid,
        pharmacyOwnerUid: conversation.pharmacyOwnerUid,
        senderRole,
        text: trimmed,
        createdAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'conversations', conversation.id), {
        lastMessage: trimmed.slice(0, 200),
        lastMessageAt: serverTimestamp(),
      });

      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const notifTitle = `Message from ${profile.displayName || 'Aplus Member'}`;
      const notifBody = trimmed.slice(0, 140);
      await setDoc(doc(db, 'notifications', notifId), {
        recipientUid: peerUid,
        type: 'new_message',
        title: notifTitle,
        body: notifBody,
        read: false,
        createdAt: serverTimestamp(),
      });

      sendWsEvent({
        type: 'notification:push',
        targetUid: peerUid,
        notification: {
          title: notifTitle,
          body: notifBody,
          type: 'new_message',
        },
      });
      playNotificationChime('sent');

      sendWsEvent({
        type: 'chat:typing',
        conversationId: conversation.id,
        targetUid: peerUid,
        isTyping: false,
      });

      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleAttachFile = async (file: File | undefined) => {
    if (!file || !myUid || !profile) return;
    setSending(true);
    setError(null);
    try {
      const uploaded = await uploadEncryptedFile({
        file,
        purpose: 'chat_attachment',
        allowedUids: [peerUid],
      });
      const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const senderRole =
        conversation.pharmacyOwnerUid === myUid && profile.role === 'pharmacy'
          ? 'pharmacy'
          : 'customer';

      await setDoc(doc(db, 'conversations', conversation.id, 'messages', msgId), {
        conversationId: conversation.id,
        senderUid: myUid,
        customerUid: conversation.customerUid,
        pharmacyOwnerUid: conversation.pharmacyOwnerUid,
        senderRole,
        text: `Shared encrypted attachment: ${uploaded.originalName}`,
        attachmentFileId: uploaded.fileId,
        attachmentName: uploaded.originalName,
        attachmentType: uploaded.mimeType,
        createdAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'conversations', conversation.id), {
        lastMessage: `Attachment: ${uploaded.originalName}`,
        lastMessageAt: serverTimestamp(),
      });

      const attNotifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const attTitle = `Attachment from ${profile.displayName || 'Aplus Member'}`;
      const attBody = `Shared encrypted file: ${uploaded.originalName}`;
      await setDoc(doc(db, 'notifications', attNotifId), {
        recipientUid: peerUid,
        type: 'new_message',
        title: attTitle,
        body: attBody,
        read: false,
        createdAt: serverTimestamp(),
      });
      sendWsEvent({
        type: 'notification:push',
        targetUid: peerUid,
        notification: {
          title: attTitle,
          body: attBody,
          type: 'new_message',
        },
      });
      playNotificationChime('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send attachment');
    } finally {
      setSending(false);
    }
  };

  const openAttachment = async (fileId: string) => {
    try {
      const signed = await getSignedFileUrl(fileId);
      setAttachmentPreview({
        url: signed.url,
        name: signed.originalName,
        mimeType: signed.mimeType,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open encrypted attachment');
    }
  };

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = muted;
    });
    setMuted(!muted);
  };

  const toggleCamera = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = cameraOff;
    });
    setCameraOff(!cameraOff);
  };

  const hangupCall = () => {
    if (activeCallId && peerUid) {
      sendWsEvent({ type: 'call:end', targetUid: peerUid, callId: activeCallId });
    }
    void teardownCall('ended');
  };

  const handleTyping = (val: string) => {
    setText(val);
    if (!peerUid) return;
    sendWsEvent({
      type: 'chat:typing',
      conversationId: conversation.id,
      targetUid: peerUid,
      isTyping: val.length > 0,
    });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendWsEvent({
        type: 'chat:typing',
        conversationId: conversation.id,
        targetUid: peerUid,
        isTyping: false,
      });
    }, 2200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-none sm:rounded-2xl border-0 sm:border border-slate-200 shadow-2xl w-full max-w-2xl h-[100dvh] sm:h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3 bg-[#123F91] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="font-bold text-sm truncate">{peerName}</div>
            <div className="text-xs text-blue-100 truncate">
              {peerTyping
                ? 'Typing...'
                : peerOnline
                  ? 'Online now · End-to-end private channel'
                  : 'Offline · Messages & call notifications delivered'}
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {callState === 'idle' && (
              <>
                <button
                  type="button"
                  onClick={() => void startCall('audio')}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                  title="Audio Call"
                  aria-label="Audio Call"
                >
                  <Phone className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void startCall('video')}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                  title="Video Call"
                  aria-label="Video Call"
                >
                  <Video className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                if (callState !== 'idle') hangupCall();
                onClose();
              }}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Active WebRTC Call Surface */}
        {callState !== 'idle' && (
          <div className="bg-slate-950 text-white p-3.5 sm:p-4 border-b border-slate-800 shrink-0">
            <audio ref={remoteAudioRef} autoPlay />
            {callType === 'video' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-video border border-slate-800">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-2 left-2 text-[11px] bg-black/60 px-2 py-0.5 rounded">
                    {peerName}
                  </span>
                </div>
                <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-video border border-slate-800 max-h-40 sm:max-h-none">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-2 left-2 text-[11px] bg-black/60 px-2 py-0.5 rounded">
                    You
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-3 sm:py-4 text-center">
                <div className="text-sm font-semibold">{peerName}</div>
                <div className="text-xs text-slate-400 mt-1 font-mono tabular-nums">
                  {callState === 'calling'
                    ? 'Ringing...'
                    : callState === 'connecting'
                      ? 'Connecting secure audio...'
                      : `Connected · ${Math.floor(callSeconds / 60)
                          .toString()
                          .padStart(2, '0')}:${(callSeconds % 60).toString().padStart(2, '0')}`}
                </div>
              </div>
            )}
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={toggleMute}
                className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full ${
                  muted ? 'bg-amber-600' : 'bg-slate-800 hover:bg-slate-700'
                }`}
                title={muted ? 'Unmute' : 'Mute'}
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              {callType === 'video' && (
                <button
                  type="button"
                  onClick={toggleCamera}
                  className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full ${
                    cameraOff ? 'bg-amber-600' : 'bg-slate-800 hover:bg-slate-700'
                  }`}
                  title={cameraOff ? 'Enable Camera' : 'Disable Camera'}
                  aria-label={cameraOff ? 'Enable Camera' : 'Disable Camera'}
                >
                  {cameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                </button>
              )}
              <button
                type="button"
                onClick={hangupCall}
                className="min-h-[44px] px-4 py-2 rounded-full bg-red-600 hover:bg-red-700 text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <PhoneOff className="w-4 h-4" />
                End Call
              </button>
            </div>
          </div>
        )}

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
          {messages.length === 0 ? (
            <div className="text-center text-xs text-slate-500 py-10">
              Start a private conversation with {peerName} regarding medicine availability, pickup times, or pharmacist guidance.
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.senderUid === myUid;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm shadow-xs ${
                      mine
                        ? 'bg-[#123F91] text-white'
                        : 'bg-white border border-slate-200 text-slate-900'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    {m.attachmentFileId && (
                      <button
                        type="button"
                        onClick={() => void openAttachment(m.attachmentFileId!)}
                        className={`mt-2 inline-flex items-center gap-1.5 text-xs underline ${
                          mine ? 'text-blue-100' : 'text-[#123F91]'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        View {m.attachmentName || 'Encrypted Attachment'}
                      </button>
                    )}
                    <div
                      className={`text-[10px] mt-1 flex items-center justify-end gap-1.5 ${
                        mine ? 'text-blue-200' : 'text-slate-400'
                      }`}
                    >
                      <span>{formatTimestamp(m.createdAt)}</span>
                      {mine && m.readAt && <span>· Read</span>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Attachment Preview Inline */}
        {attachmentPreview && (
          <div className="p-3 border-t border-slate-200 bg-slate-100 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {attachmentPreview.mimeType.startsWith('image/') ? (
                <img
                  src={attachmentPreview.url}
                  alt={attachmentPreview.name}
                  className="w-12 h-12 rounded object-cover border border-slate-300 shrink-0"
                />
              ) : (
                <a
                  href={attachmentPreview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-[#123F91] underline truncate"
                >
                  Open {attachmentPreview.name}
                </a>
              )}
              <span className="text-xs text-slate-700 truncate">{attachmentPreview.name}</span>
            </div>
            <button
              type="button"
              onClick={() => setAttachmentPreview(null)}
              className="min-h-[36px] px-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              Close
            </button>
          </div>
        )}

        {error && (
          <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-xs text-red-700 shrink-0">
            {error}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={sendMessage}
          className="p-3 pb-safe border-t border-slate-200 bg-white flex items-center gap-2 shrink-0"
        >
          <input
            ref={attachmentInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.pdf,image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              void handleAttachFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => attachmentInputRef.current?.click()}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 shrink-0"
            title="Attach encrypted file"
            aria-label="Attach encrypted file"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={text}
            onChange={(e) => handleTyping(e.target.value)}
            placeholder="Write a message..."
            className="flex-1 min-w-0 min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123F91]"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="min-h-[44px] px-3.5 sm:px-4 py-2 rounded-lg bg-[#123F91] text-white text-sm font-semibold hover:bg-[#0e3274] disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
          >
            <Send className="w-4 h-4" />
            <span className="hidden xs:inline sm:inline">Send</span>
          </button>
        </form>
      </div>
    </div>
  );
};
