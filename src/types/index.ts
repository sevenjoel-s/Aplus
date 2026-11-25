export type LanguageCode = 'en' | 'am' | 'om' | 'ti' | 'so';

export type UserRole = 'customer' | 'pharmacy' | 'support' | 'moderator' | 'admin' | 'super_admin';

export type SubscriptionStatus =
  | 'active'
  | 'expiring_soon'
  | 'expired'
  | 'payment_pending'
  | 'payment_failed'
  | 'cancelled'
  | 'suspended'
  | 'free_tier';

export type StockStatus = 'available' | 'low_stock' | 'out_of_stock' | 'unconfirmed';

export type PrescriptionStatus =
  | 'submitted'
  | 'received'
  | 'under_review'
  | 'available'
  | 'partially_available'
  | 'out_of_stock'
  | 'clarification_required'
  | 'response_sent'
  | 'completed'
  | 'cancelled';

export interface UserProfile {
  uid: string;
  displayName: string;
  role: UserRole;
  city?: string;
  language: LanguageCode;
  photoUrl?: string;
  notificationSoundEnabled?: boolean;
  accessibilityHighContrast?: boolean;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  phone?: string;
  phoneVerified: boolean;
  emailVerified: boolean;
  mfaEnabled?: boolean;
  consentGivenAt?: string;
  updatedAt?: unknown;
}

export interface Pharmacy {
  id: string;
  ownerUid: string;
  name: string;
  ownerPharmacistName: string;
  licenseNumber: string;
  region: string;
  city: string;
  subCity?: string;
  woreda?: string;
  street?: string;
  lat?: number;
  lng?: number;
  phone: string;
  email?: string;
  openingHours?: string;
  verificationStatus: 'pending' | 'approved' | 'rejected' | 'suspended';
  ratingAvg?: number;
  ratingCount?: number;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionExpiresAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Medicine {
  id: string;
  name: string;
  genericName: string;
  brandName?: string;
  activeIngredient: string;
  strength?: string;
  dosageForm: string;
  packaging?: string;
  manufacturer?: string;
  countryOfOrigin?: string;
  registrationNumber?: string;
  prescriptionClass: 'OTC' | 'POM' | 'Controlled';
  description?: string;
  approvedUsage?: string;
  warnings?: string;
  storageInfo?: string;
  category: string;
  imageUrl?: string;
  verifiedSource: string;
  recallAlert?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PharmacyInventoryItem {
  id: string;
  pharmacyId: string;
  ownerUid: string;
  pharmacyName?: string;
  pharmacyCity?: string;
  pharmacyLat?: number;
  pharmacyLng?: number;
  pharmacyVerified?: boolean;
  medicineId?: string;
  medicineName: string;
  genericName?: string;
  brandName?: string;
  activeIngredient?: string;
  strength?: string;
  dosageForm?: string;
  category?: string;
  prescriptionClass?: 'OTC' | 'POM' | 'Controlled';
  priceEtb: number;
  stockStatus: StockStatus;
  quantity?: number;
  lastConfirmedAt: string;
  updatedAt?: unknown;
}

export interface LocationItem {
  id: string;
  region: string;
  city: string;
  subCity?: string;
  woreda?: string;
  neighborhood?: string;
  lat: number;
  lng: number;
  createdAt?: unknown;
}

export interface FavoriteItem {
  id: string;
  userUid: string;
  targetType: 'medicine' | 'pharmacy';
  targetId: string;
  targetName: string;
  createdAt?: unknown;
}

export interface SearchHistoryItem {
  id: string;
  userUid: string;
  query: string;
  city?: string;
  category?: string;
  createdAt?: unknown;
}

export interface Conversation {
  id: string;
  customerUid: string;
  pharmacyId: string;
  pharmacyOwnerUid: string;
  customerName: string;
  pharmacyName: string;
  lastMessage?: string;
  lastMessageAt?: unknown;
  createdAt?: unknown;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderUid: string;
  customerUid: string;
  pharmacyOwnerUid: string;
  senderRole: 'customer' | 'pharmacy';
  text: string;
  attachmentFileId?: string;
  attachmentName?: string;
  attachmentType?: string;
  readAt?: string;
  createdAt?: unknown;
}

export interface CallRecord {
  id: string;
  conversationId: string;
  callerUid: string;
  calleeUid: string;
  pharmacyId?: string;
  callType: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'declined';
  durationSeconds?: number;
  createdAt?: unknown;
}

export interface NotificationItem {
  id: string;
  recipientUid: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt?: unknown;
}

export interface SubscriptionRecord {
  uid: string;
  role: 'customer' | 'pharmacy';
  status: SubscriptionStatus;
  priceEtb: number;
  durationDays: number;
  startedAt?: string;
  expiresAt?: string;
  lastTxRef?: string;
  updatedAt?: unknown;
}

export interface PaymentTransaction {
  txRef: string;
  uid: string;
  amountEtb: number;
  currency: 'ETB';
  provider: 'chapa' | 'telebirr' | 'cbe_birr';
  status: 'pending' | 'verified' | 'failed';
  purpose: 'subscription_activation' | 'subscription_renewal';
  receiptNumber?: string;
  verificationSignature?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PrescriptionFileMeta {
  id: string;
  requestId: string;
  uploadedByUid: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  pageIndex?: number;
  createdAt?: unknown;
}

export interface PrescriptionRequest {
  id: string;
  customerUid: string;
  customerName: string;
  requestType: 'prescription' | 'medicine_image';
  city: string;
  notes?: string;
  medicineNameKnown?: string;
  strengthKnown?: string;
  quantityKnown?: string;
  consentAccepted: boolean;
  targetPharmacyIds: string[];
  status: PrescriptionStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PrescriptionAssignment {
  id: string;
  requestId: string;
  customerUid: string;
  customerName?: string;
  pharmacyId: string;
  pharmacyOwnerUid: string;
  pharmacyName: string;
  requestType: 'prescription' | 'medicine_image';
  city?: string;
  notes?: string;
  medicineNameKnown?: string;
  strengthKnown?: string;
  quantityKnown?: string;
  fileIds?: string[];
  status: PrescriptionStatus;
  responseNotes?: string;
  estimatedTotalEtb?: number;
  estimatedPrepMinutes?: number;
  pharmacyLocationText?: string;
  pharmacyPhone?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ReviewItem {
  id: string;
  pharmacyId: string;
  customerUid: string;
  customerName: string;
  rating: number;
  comment?: string;
  createdAt?: unknown;
}

export interface ComplaintItem {
  id: string;
  reporterUid: string;
  targetType: 'pharmacy' | 'medicine_listing' | 'prescription_abuse' | 'other';
  targetId?: string;
  subject: string;
  description: string;
  status: 'open' | 'investigating' | 'resolved' | 'dismissed';
  adminNotes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BannerItem {
  id: string;
  title: string;
  subtitle?: string;
  active: boolean;
  createdAt?: unknown;
}

export interface SystemSettings {
  customerMonthlyPriceEtb: number;
  pharmacyMonthlyPriceEtb: number;
  subscriptionDurationDays: number;
  maxPrescriptionFiles: number;
  maxFileSizeMb: number;
  retentionDays: number;
  updatedAt?: unknown;
}

export interface AuditLogItem {
  id: string;
  actorUid: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: string;
  createdAt?: unknown;
}
