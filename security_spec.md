# Aplus Drug Finder — Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Identity Integrity**: Every user-owned document (`users`, `favorites`, `searchHistory`, `prescriptionRequests`, `subscriptions`, `paymentTransactions`, `complaints`, `reviews`) MUST verify `incoming().userUid == request.auth.uid` (or `customerUid` / `ownerUid` / `uid`) on create and enforce immutability of the owner UID on update.
2. **Role & Privilege Isolation**: Users registering via client SDK may only self-assign `'customer'` or `'pharmacy'` roles in `users/{uid}` and cannot write to `admins/{uid}` or set `verificationStatus: 'approved'` on `pharmacies/{pharmacyId}`.
3. **PII Isolation**: Email addresses and phone numbers are stored in `users/{uid}/private/{docId}` and strictly readable/writable only by the owning user or verified admins.
4. **Pharmacy Isolation for Prescriptions**: Each pharmacy receives a separate `prescriptionAssignments/{assignmentId}` document. Pharmacy B cannot read or list Pharmacy A's assignment, pricing quotation, or response notes.
5. **Immutable Audit & Terminal State Locking**: `inventoryHistory`, `prescriptionAccessLogs`, and `auditLogs` are append-only (`update: if false`, `delete: if false`). Terminal states (`completed`, `cancelled` on prescriptions; `verified` on payment transactions) cannot be mutated by non-admin callers.
6. **Temporal & ID Integrity**: All document IDs are validated with `isValidId()` (`^[a-zA-Z0-9_\-]+$`, `<= 128` chars), and every string field has explicit `.size()` bounds.

## 2. The "Dirty Dozen" Adversarial Test Payloads
1. **Unauthenticated Read on Private PII**: `GET /users/userA/private/info` with `auth == null` -> `PERMISSION_DENIED`.
2. **Email Spoofing Admin Escalation**: `UPDATE /pharmacies/pharm1` setting `verificationStatus: 'approved'` with `email: 'sevenjoel326@gmail.com'` and `email_verified: false` -> `PERMISSION_DENIED`.
3. **Self-Assigned Super Admin Role**: `CREATE /users/userA` with `role: 'super_admin'` -> `PERMISSION_DENIED`.
4. **Cross-Pharmacy Prescription Spying**: `LIST /prescriptionAssignments` without `where('pharmacyOwnerUid', '==', auth.uid)` as Pharmacy B -> `PERMISSION_DENIED`.
5. **Shadow Ghost Field Injection**: `CREATE /favorites/fav1` with valid fields + `isAdminBypass: true` -> `PERMISSION_DENIED`.
6. **Resource Poisoning / Oversized ID**: `CREATE /pharmacies/<1500-char-id>` -> `PERMISSION_DENIED`.
7. **Unapproved Pharmacy Self-Verification**: `UPDATE /pharmacies/pharm1` by `ownerUid` changing `verificationStatus` from `'pending'` to `'approved'` -> `PERMISSION_DENIED`.
8. **Cross-Tenant Inventory Tampering**: `UPDATE /pharmacyInventory/inv1` by non-owner UID changing `priceEtb` to `1` -> `PERMISSION_DENIED`.
9. **Terminal State Mutation**: `UPDATE /prescriptionAssignments/assign1` by pharmacy after `status == 'completed'` -> `PERMISSION_DENIED`.
10. **Audit Log Tampering**: `DELETE /auditLogs/log1` or `UPDATE /auditLogs/log1` by non-admin -> `PERMISSION_DENIED`.
11. **Fake Verified Payment Injection**: `CREATE /paymentTransactions/tx1` by customer with `status: 'verified'` without verified server receipt -> `PERMISSION_DENIED`.
12. **Chat Message Impersonation**: `CREATE /conversations/conv1/messages/msg1` where `senderUid != auth.uid` -> `PERMISSION_DENIED`.
