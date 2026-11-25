import React, { useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  FileText,
  Image as ImageIcon,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { apiFetch, uploadEncryptedFile } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Pharmacy } from '../types';

interface PrescriptionUploadModalProps {
  open: boolean;
  initialMode: 'prescription' | 'medicine_image';
  pharmacies: Pharmacy[];
  preselectedPharmacyId?: string | null;
  onClose: () => void;
  onSubmitted: (requestId: string) => void;
}

interface PendingFileEntry {
  localId: string;
  file: File;
  previewUrl: string | null;
}

export const PrescriptionUploadModal: React.FC<PrescriptionUploadModalProps> = ({
  open,
  initialMode,
  pharmacies,
  preselectedPharmacyId,
  onClose,
  onSubmitted,
}) => {
  const { firebaseUser, profile, settings, t, sendWsEvent, triggerNotificationAlert } =
    useAuth();
  const [mode, setMode] = useState<'prescription' | 'medicine_image'>(initialMode);
  const [files, setFiles] = useState<PendingFileEntry[]>([]);
  const [cityFilter, setCityFilter] = useState<string>(profile?.city || '');
  const [selectedPharmacyIds, setSelectedPharmacyIds] = useState<string[]>(
    preselectedPharmacyId ? [preselectedPharmacyId] : []
  );
  const [medicineNameKnown, setMedicineNameKnown] = useState('');
  const [strengthKnown, setStrengthKnown] = useState('');
  const [quantityKnown, setQuantityKnown] = useState('');
  const [notes, setNotes] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  React.useEffect(() => {
    if (preselectedPharmacyId && !selectedPharmacyIds.includes(preselectedPharmacyId)) {
      setSelectedPharmacyIds((prev) => [...prev, preselectedPharmacyId].slice(0, 10));
    }
  }, [preselectedPharmacyId, selectedPharmacyIds]);

  const approvedPharmacies = useMemo(
    () => pharmacies.filter((p) => p.verificationStatus === 'approved'),
    [pharmacies]
  );

  const availableCities = useMemo(() => {
    const set = new Set<string>();
    approvedPharmacies.forEach((p) => {
      if (p.city) set.add(p.city);
    });
    return Array.from(set).sort();
  }, [approvedPharmacies]);

  const filteredPharmacies = useMemo(() => {
    if (!cityFilter) return approvedPharmacies;
    return approvedPharmacies.filter(
      (p) => p.city.toLowerCase() === cityFilter.toLowerCase()
    );
  }, [approvedPharmacies, cityFilter]);

  if (!open) return null;

  const maxFiles = settings.maxPrescriptionFiles || 8;
  const maxMb = settings.maxFileSizeMb || 15;

  const handleAddFiles = (incomingList: FileList | null) => {
    if (!incomingList) return;
    setError(null);
    const nextEntries: PendingFileEntry[] = [];
    for (let i = 0; i < incomingList.length; i++) {
      const f = incomingList[i];
      if (files.length + nextEntries.length >= maxFiles) {
        setError(`Maximum ${maxFiles} files allowed per request.`);
        break;
      }
      if (f.size > maxMb * 1024 * 1024) {
        setError(`${f.name} exceeds the ${maxMb} MB per-file limit.`);
        continue;
      }
      const lowerName = f.name.toLowerCase();
      const validExt = /\.(jpg|jpeg|png|webp|heic|heif|pdf)$/.test(lowerName);
      const validMime =
        f.type.startsWith('image/') || f.type === 'application/pdf' || validExt;
      if (!validMime) {
        setError(`${f.name}: Only JPG, PNG, WEBP, HEIC, or PDF files are accepted.`);
        continue;
      }
      const previewUrl = f.type.startsWith('image/') ? URL.createObjectURL(f) : null;
      nextEntries.push({
        localId: `${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
        file: f,
        previewUrl,
      });
    }
    if (nextEntries.length > 0) {
      setFiles((prev) => [...prev, ...nextEntries]);
    }
  };

  const removeFile = (localId: string) => {
    setFiles((prev) => {
      const target = prev.find((p) => p.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  };

  const togglePharmacy = (id: string) => {
    setSelectedPharmacyIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 10) {
        setError('You can send a single request to up to 10 verified pharmacies at once.');
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) {
      setError('Please sign in first to upload medical documents securely.');
      return;
    }
    if (files.length === 0) {
      setError('Please attach or capture at least one prescription or medicine image.');
      return;
    }
    if (selectedPharmacyIds.length === 0) {
      setError('Select at least one verified pharmacy to receive this request.');
      return;
    }
    if (!consentAccepted) {
      setError('You must confirm sharing consent before transmitting medical files.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const targetPharmacies = approvedPharmacies.filter((p) =>
        selectedPharmacyIds.includes(p.id)
      );
      if (targetPharmacies.length === 0) {
        throw new Error('Selected pharmacies are no longer active.');
      }

      const recipientOwnerUids = Array.from(
        new Set(targetPharmacies.map((p) => p.ownerUid))
      );

      const requestId = `rx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const uploadedMeta: Array<{
        fileId: string;
        originalName: string;
        mimeType: string;
        sizeBytes: number;
        pageIndex: number;
      }> = [];

      // 1. Encrypt and upload each file to private_storage
      for (let i = 0; i < files.length; i++) {
        setUploadProgress(`Encrypting & uploading file ${i + 1} of ${files.length}...`);
        const uploaded = await uploadEncryptedFile({
          file: files[i].file,
          purpose: mode,
          allowedUids: recipientOwnerUids,
          retentionDays: settings.retentionDays || 90,
        });
        await apiFetch(`/api/files/${encodeURIComponent(uploaded.fileId)}/authorize`, {
          method: 'POST',
          body: JSON.stringify({ allowedUids: recipientOwnerUids }),
        });
        uploadedMeta.push({
          fileId: uploaded.fileId,
          originalName: uploaded.originalName,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
          pageIndex: i,
        });
      }

      setUploadProgress('Creating isolated pharmacy requests...');

      const primaryCity =
        cityFilter || targetPharmacies[0]?.city || profile.city || 'Addis Ababa';

      // 2. Create parent prescriptionRequests doc
      const requestPayload: Record<string, unknown> = {
        id: requestId,
        customerUid: firebaseUser.uid,
        customerName: profile.displayName || firebaseUser.displayName || 'Customer',
        requestType: mode,
        city: primaryCity,
        consentAccepted: true,
        targetPharmacyIds: targetPharmacies.map((p) => p.id),
        status: 'submitted',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (notes.trim()) requestPayload.notes = notes.trim();
      if (medicineNameKnown.trim()) requestPayload.medicineNameKnown = medicineNameKnown.trim();
      if (strengthKnown.trim()) requestPayload.strengthKnown = strengthKnown.trim();
      if (quantityKnown.trim()) requestPayload.quantityKnown = quantityKnown.trim();

      await setDoc(doc(db, 'prescriptionRequests', requestId), requestPayload);

      // 3. Record file metadata in subcollection
      for (const fm of uploadedMeta) {
        await setDoc(doc(db, 'prescriptionRequests', requestId, 'files', fm.fileId), {
          requestId,
          uploadedByUid: firebaseUser.uid,
          fileId: fm.fileId,
          originalName: fm.originalName,
          mimeType: fm.mimeType,
          sizeBytes: fm.sizeBytes,
          pageIndex: fm.pageIndex,
          createdAt: serverTimestamp(),
        });
      }

      // 4. Create isolated per-pharmacy assignment + send notification
      const fileIds = uploadedMeta.map((m) => m.fileId);
      for (const pharm of targetPharmacies) {
        const assignmentId = `rxa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const assignmentPayload: Record<string, unknown> = {
          id: assignmentId,
          requestId,
          customerUid: firebaseUser.uid,
          customerName: profile.displayName || 'Customer',
          pharmacyId: pharm.id,
          pharmacyOwnerUid: pharm.ownerUid,
          pharmacyName: pharm.name,
          requestType: mode,
          city: pharm.city,
          fileIds,
          status: 'submitted',
          pharmacyLocationText: [pharm.street, pharm.subCity, pharm.city]
            .filter(Boolean)
            .join(', '),
          pharmacyPhone: pharm.phone,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (notes.trim()) assignmentPayload.notes = notes.trim();
        if (medicineNameKnown.trim())
          assignmentPayload.medicineNameKnown = medicineNameKnown.trim();
        if (strengthKnown.trim()) assignmentPayload.strengthKnown = strengthKnown.trim();
        if (quantityKnown.trim()) assignmentPayload.quantityKnown = quantityKnown.trim();

        await setDoc(doc(db, 'prescriptionAssignments', assignmentId), assignmentPayload);

        const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const notifTitle =
          mode === 'prescription'
            ? 'New Prescription Request Received'
            : 'New Medicine Image Request';
        const notifBody = `${profile.displayName || 'A customer'} sent ${
          fileIds.length
        } private medical file(s) to ${pharm.name}.`;

        await setDoc(doc(collection(db, 'notifications'), notifId), {
          recipientUid: pharm.ownerUid,
          type: 'prescription_request',
          title: notifTitle,
          body: notifBody,
          read: false,
          createdAt: serverTimestamp(),
        });

        sendWsEvent({
          type: 'notification:push',
          targetUid: pharm.ownerUid,
          notification: {
            title: notifTitle,
            body: notifBody,
            type: 'prescription_request',
          },
        });
      }

      triggerNotificationAlert({
        title: 'Notification Alert Sent',
        body: `Sent private request alert to ${selectedPharmacyIds.length} verified pharmac${
          selectedPharmacyIds.length === 1 ? 'y' : 'ies'
        }.`,
        kind: 'sent',
      });

      files.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
      setFiles([]);
      setNotes('');
      setMedicineNameKnown('');
      setStrengthKnown('');
      setQuantityKnown('');
      setConsentAccepted(false);
      onSubmitted(requestId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit prescription request');
    } finally {
      setSubmitting(false);
      setUploadProgress('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full my-0 sm:my-6 max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-[#123F91] text-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <ShieldCheck className="w-5 h-5 text-[#43B02A] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-bold truncate">
                {mode === 'prescription' ? t.uploadPrescriptionBtn : t.uploadMedicineImageBtn}
              </h2>
              <p className="text-xs text-blue-100 truncate">
                AES-256 Encrypted Transfer · Isolated Per-Pharmacy Quotes
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 pb-safe space-y-5 flex-1 overflow-y-auto">
          {/* Mode Switch */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 border border-slate-200">
            <button
              type="button"
              onClick={() => setMode('prescription')}
              className={`min-h-[44px] py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                mode === 'prescription'
                  ? 'bg-[#123F91] text-white'
                  : 'text-slate-700 hover:bg-white'
              }`}
            >
              {t.uploadPrescriptionBtn}
            </button>
            <button
              type="button"
              onClick={() => setMode('medicine_image')}
              className={`min-h-[44px] py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                mode === 'medicine_image'
                  ? 'bg-[#43B02A] text-white'
                  : 'text-slate-700 hover:bg-white'
              }`}
            >
              {t.uploadMedicineImageBtn}
            </button>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-xs text-slate-700">
            {t.pharmacistReviewNotice}
          </div>

          {/* File Upload & Camera Capture */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Attach Pages or Capture Photo (JPG, PNG, WEBP, HEIC, PDF · max {maxFiles} files, {maxMb} MB each)
            </label>
            <div className="flex flex-wrap gap-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  handleAddFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  handleAddFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#43B02A] text-white text-sm font-semibold hover:bg-[#389822] transition-colors"
              >
                <Camera className="w-4 h-4 shrink-0" />
                Capture with Camera
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-semibold hover:bg-slate-50 transition-colors"
              >
                <Upload className="w-4 h-4 text-[#123F91] shrink-0" />
                Choose Files / PDF
              </button>
            </div>

            {files.length > 0 && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {files.map((entry, idx) => (
                  <div
                    key={entry.localId}
                    className="relative rounded-xl border border-slate-200 bg-slate-50 p-2 flex flex-col gap-1.5"
                  >
                    <div className="h-24 rounded-lg bg-white border border-slate-200 overflow-hidden flex items-center justify-center">
                      {entry.previewUrl ? (
                        <img
                          src={entry.previewUrl}
                          alt={entry.file.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="flex flex-col items-center text-slate-500">
                          <FileText className="w-7 h-7 text-[#123F91]" />
                          <span className="text-[11px] mt-1 font-mono">PDF Page {idx + 1}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <span className="truncate text-slate-700 font-medium">
                        {entry.file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(entry.localId)}
                        className="text-red-600 hover:text-red-700 p-1 shrink-0"
                        title="Remove file"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Medicine Details (especially useful for medicine image requests) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Medicine Name (Optional)
              </label>
              <input
                type="text"
                value={medicineNameKnown}
                onChange={(e) => setMedicineNameKnown(e.target.value)}
                placeholder="e.g. Amoxicillin"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123F91]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Strength (Optional)
              </label>
              <input
                type="text"
                value={strengthKnown}
                onChange={(e) => setStrengthKnown(e.target.value)}
                placeholder="e.g. 500mg"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123F91]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Quantity Needed (Optional)
              </label>
              <input
                type="text"
                value={quantityKnown}
                onChange={(e) => setQuantityKnown(e.target.value)}
                placeholder="e.g. 2 strips"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123F91]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Instructions / Pharmacist Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Specify preferred pickup time, urgency, or dosage questions for the pharmacist..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123F91]"
            />
          </div>

          {/* Target Verified Pharmacies */}
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-sm font-semibold text-slate-900">
                Select Verified Pharmacies ({selectedPharmacyIds.length}/10 selected)
              </label>
              <select
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                className="w-full sm:w-auto min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs bg-white"
              >
                <option value="">All Cities</option>
                {availableCities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {filteredPharmacies.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                No verified pharmacies matched this city filter yet. Try switching to All Cities or check back after pharmacies complete EFDA license approval.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-200 rounded-xl border border-slate-200">
                {filteredPharmacies.map((p) => {
                  const selected = selectedPharmacyIds.includes(p.id);
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => togglePharmacy(p.id)}
                      className={`w-full min-h-[52px] px-3.5 py-2.5 text-left flex items-center justify-between gap-3 transition-colors ${
                        selected ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {p.name}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {[p.subCity, p.city, p.region].filter(Boolean).join(', ')} · {p.phone}
                        </div>
                      </div>
                      <span
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                          selected
                            ? 'bg-[#123F91] border-[#123F91] text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {selected && <Check className="w-3.5 h-3.5" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Consent */}
          <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={consentAccepted}
              onChange={(e) => setConsentAccepted(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-[#123F91] focus:ring-[#123F91]"
            />
            <span className="text-xs text-slate-700 leading-relaxed">
              {t.prescriptionConsentText}
            </span>
          </label>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
              {error}
            </div>
          )}

          {uploadProgress && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs text-[#123F91] font-medium flex items-center gap-2">
              <ImageIcon className="w-4 h-4 animate-pulse" />
              {uploadProgress}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 sm:gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !firebaseUser}
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-lg bg-[#123F91] text-white text-sm font-semibold hover:bg-[#0e3274] disabled:opacity-50"
            >
              {submitting ? 'Encrypting & Sending...' : 'Send Secure Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
