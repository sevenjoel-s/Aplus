import { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

const adminApp = getApps().length
  ? getApp()
  : initializeApp({
      projectId: firebaseConfig.projectId,
    });

export const adminAuth = getAuth(adminApp);

export const BOOTSTRAPPED_ADMIN_EMAIL = 'sevenjoel326@gmail.com';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

export async function verifyBearerToken(token: string): Promise<DecodedIdToken> {
  return adminAuth.verifyIdToken(token);
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Missing authentication token' });
    return;
  }
  try {
    const decoded = await verifyBearerToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Token verification failed:', err instanceof Error ? err.message : err);
    res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

export function isBootstrappedAdmin(user?: DecodedIdToken): boolean {
  return Boolean(
    user &&
      user.email_verified === true &&
      user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
  );
}
