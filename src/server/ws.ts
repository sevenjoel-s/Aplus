import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyBearerToken } from './auth.ts';

interface AuthedSocket extends WebSocket {
  uid?: string;
  displayName?: string;
  isAlive?: boolean;
}

const userSockets = new Map<string, Set<AuthedSocket>>();

function sendJson(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function broadcastToUser(uid: string, payload: Record<string, unknown>) {
  const sockets = userSockets.get(uid);
  if (!sockets) return;
  for (const sock of sockets) {
    sendJson(sock, payload);
  }
}

function broadcastPresence() {
  const onlineUids = Array.from(userSockets.keys());
  const message = JSON.stringify({ type: 'presence:list', onlineUids });
  for (const sockets of userSockets.values()) {
    for (const sock of sockets) {
      if (sock.readyState === WebSocket.OPEN) {
        sock.send(message);
      }
    }
  }
}

export function attachWebSocketServer(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      const sock = client as AuthedSocket;
      if (sock.isAlive === false) {
        sock.terminate();
        continue;
      }
      sock.isAlive = false;
      sock.ping();
    }
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', async (ws: AuthedSocket, req) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    try {
      const url = new URL(req.url || '/ws', 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) {
        ws.close(4001, 'Authentication token required');
        return;
      }
      const decoded = await verifyBearerToken(token);
      ws.uid = decoded.uid;
      ws.displayName = decoded.name || decoded.email || 'Aplus User';

      if (!userSockets.has(decoded.uid)) {
        userSockets.set(decoded.uid, new Set());
      }
      userSockets.get(decoded.uid)!.add(ws);

      sendJson(ws, { type: 'ws:connected', uid: decoded.uid });
      broadcastPresence();
    } catch {
      ws.close(4003, 'Invalid authentication token');
      return;
    }

    ws.on('message', (raw) => {
      if (!ws.uid) return;
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          targetUid?: string;
          conversationId?: string;
          callId?: string;
          callType?: 'audio' | 'video';
          sdp?: unknown;
          candidate?: unknown;
          isTyping?: boolean;
          notification?: Record<string, unknown>;
        };

        if (!msg.type || !msg.targetUid) return;

        switch (msg.type) {
          case 'chat:typing':
            broadcastToUser(msg.targetUid, {
              type: 'chat:typing',
              fromUid: ws.uid,
              conversationId: msg.conversationId,
              isTyping: Boolean(msg.isTyping),
            });
            break;

          case 'notification:push':
            broadcastToUser(msg.targetUid, {
              type: 'notification:push',
              fromUid: ws.uid,
              notification: msg.notification || {},
            });
            break;

          case 'call:initiate':
            broadcastToUser(msg.targetUid, {
              type: 'call:incoming',
              callId: msg.callId,
              conversationId: msg.conversationId,
              callerUid: ws.uid,
              callerName: ws.displayName,
              callType: msg.callType === 'video' ? 'video' : 'audio',
            });
            break;

          case 'call:accept':
          case 'call:decline':
          case 'call:end':
            broadcastToUser(msg.targetUid, {
              type: msg.type,
              callId: msg.callId,
              conversationId: msg.conversationId,
              fromUid: ws.uid,
            });
            break;

          case 'webrtc:offer':
          case 'webrtc:answer':
          case 'webrtc:ice-candidate':
            broadcastToUser(msg.targetUid, {
              type: msg.type,
              callId: msg.callId,
              conversationId: msg.conversationId,
              fromUid: ws.uid,
              sdp: msg.sdp,
              candidate: msg.candidate,
            });
            break;
        }
      } catch {
        // Ignore malformed frames
      }
    });

    ws.on('close', () => {
      if (ws.uid && userSockets.has(ws.uid)) {
        const set = userSockets.get(ws.uid)!;
        set.delete(ws);
        if (set.size === 0) {
          userSockets.delete(ws.uid);
        }
        broadcastPresence();
      }
    });
  });

  return wss;
}
