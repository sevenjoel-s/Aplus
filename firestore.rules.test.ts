/**
 * Phase 0 Security Rules Verification Spec for Aplus Drug Finder.
 * Verifies the "Dirty Dozen" adversarial payloads against firestore.rules invariants.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expectedOutcome: 'PERMISSION_DENIED';
  payload: Record<string, unknown>;
}

export const DIRTY_DOZEN_PAYLOADS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Read on Private PII',
    collection: 'users/userA/private/info',
    operation: 'get',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: null },
  },
  {
    id: 2,
    name: 'Email Spoofing Admin Escalation',
    collection: 'pharmacies/pharm1',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      auth: { uid: 'attacker', token: { email: 'sevenjoel326@gmail.com', email_verified: false } },
      data: { verificationStatus: 'approved' },
    },
  },
  {
    id: 3,
    name: 'Self-Assigned Super Admin Role',
    collection: 'users/userA',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      auth: { uid: 'userA', token: { email_verified: true } },
      data: { uid: 'userA', displayName: 'Attacker', role: 'super_admin', language: 'en', subscriptionStatus: 'active' },
    },
  },
  {
    id: 4,
    name: 'Cross-Pharmacy Prescription Spying',
    collection: 'prescriptionAssignments',
    operation: 'list',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      auth: { uid: 'pharmacyB_owner', token: { email_verified: true } },
      query: 'unfiltered list',
    },
  },
  {
    id: 5,
    name: 'Shadow Ghost Field Injection',
    collection: 'favorites/fav1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      auth: { uid: 'userA', token: { email_verified: true } },
      data: { userUid: 'userA', targetType: 'medicine', targetId: 'med1', targetName: 'Amoxicillin', isAdminBypass: true },
    },
  },
  {
    id: 6,
    name: 'Oversized Document ID Poisoning',
    collection: `pharmacies/${'a'.repeat(200)}`,
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: { uid: 'userA', token: { email_verified: true } } },
  },
  {
    id: 7,
    name: 'Unapproved Pharmacy Self-Verification',
    collection: 'pharmacies/pharm1',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      auth: { uid: 'pharmOwner1', token: { email_verified: true } },
      data: { verificationStatus: 'approved' },
    },
  },
  {
    id: 8,
    name: 'Cross-Tenant Inventory Tampering',
    collection: 'pharmacyInventory/inv1',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      auth: { uid: 'otherUser', token: { email_verified: true } },
      data: { priceEtb: 1 },
    },
  },
  {
    id: 9,
    name: 'Terminal State Mutation on Completed Prescription',
    collection: 'prescriptionAssignments/assign1',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      auth: { uid: 'pharmOwner1', token: { email_verified: true } },
      existing: { status: 'completed' },
      data: { status: 'available', estimatedTotalEtb: 9999 },
    },
  },
  {
    id: 10,
    name: 'Audit Log Tampering',
    collection: 'auditLogs/log1',
    operation: 'delete',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: { uid: 'userA', token: { email_verified: true } } },
  },
  {
    id: 11,
    name: 'Fake Verified Payment Injection',
    collection: 'paymentTransactions/tx_fake',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      auth: { uid: 'userA', token: { email_verified: true } },
      data: { txRef: 'tx_fake', uid: 'userA', amountEtb: 50, currency: 'ETB', provider: 'chapa', status: 'verified', purpose: 'subscription_activation' },
    },
  },
  {
    id: 12,
    name: 'Chat Message Sender Impersonation',
    collection: 'conversations/conv1/messages/msg1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      auth: { uid: 'userA', token: { email_verified: true } },
      data: { conversationId: 'conv1', senderUid: 'userB', senderRole: 'pharmacy', text: 'Fake quote' },
    },
  },
];
