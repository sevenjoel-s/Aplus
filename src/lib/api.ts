import { auth } from './firebase';

export async function getAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Authentication required');
  }
  return user.getIdToken();
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...init,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || data.message || `Request failed (${res.status})`);
    }
    return data as T;
  }

  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }
  return (await res.text()) as unknown as T;
}

export async function uploadEncryptedFile(params: {
  file: File;
  purpose: 'prescription' | 'medicine_image' | 'verification_doc' | 'chat_attachment';
  allowedUids?: string[];
  retentionDays?: number;
}): Promise<{
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
}> {
  const token = await getAuthToken();
  const form = new FormData();
  form.append('file', params.file);
  form.append('purpose', params.purpose);
  if (params.allowedUids?.length) {
    form.append('allowedUids', params.allowedUids.join(','));
  }
  if (params.retentionDays) {
    form.append('retentionDays', String(params.retentionDays));
  }

  const res = await fetch('/api/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Encrypted upload failed');
  }
  return data;
}

export async function getSignedFileUrl(fileId: string): Promise<{
  url: string;
  mimeType: string;
  originalName: string;
  expiresInSeconds: number;
}> {
  return apiFetch(`/api/files/${encodeURIComponent(fileId)}/sign-url`, {
    method: 'POST',
  });
}
