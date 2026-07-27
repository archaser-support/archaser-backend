<!-- c16ab458-16d1-47da-8432-6fe77690e81c 7a5072fd-250b-4950-a215-9d005b1c3a32 -->

# Account Soft Deletion with GDPR Compliance

## Recommendation: SOFT DELETE with Data Anonymization

Based on GDPR requirements and business needs, I recommend **soft delete with data anonymization**.

### Why Soft Delete?

1. **Legal Obligations (GDPR Article 17(3)(b))**: Financial records must be retained for 7-10 years for tax/accounting compliance
2. **Audit Trail Requirements**: Business operations require maintaining history of who created/modified records (6 months retention)
3. **Data Integrity**: Prevents cascade deletion of 54+ related tables (Users, Customers, Invoices, Activities, Disputes)
4. **GDPR Compliance**: Allows "right to erasure" by anonymizing PII while retaining financial data

## Implementation Plan

### 1. Database Schema Changes

**Add soft delete fields to Account model** ([prisma/schema.prisma](prisma/schema.prisma)):

```prisma
model Account {
  // ... existing fields ...
  deleted_at                            DateTime?                       @db.Timestamptz(6)
  deletion_reason                       String?                         @db.VarChar(500)
  deleted_by                            String?                         @db.VarChar

  // Add relation for deleted_by
  User_Account_deleted_byToUser         User?                           @relation("Account_deleted_byToUser", fields: [deleted_by], references: [id], onDelete: NoAction, onUpdate: NoAction)

  // Add index for filtering
  @@index([deleted_at], map: "idx_account_deleted_at")
}
```

### 2. Create Migration Script

**File**: `scripts/database/add-account-soft-delete.sql`

- Add `deleted_at`, `deletion_reason`, `deleted_by` columns
- Create index on `deleted_at` for query performance
- Add foreign key constraint for `deleted_by`

### 3. Account Deletion Service

**File**: `server/services/AccountDeletionService.ts` (new file)

Implements:

**A. Soft Delete with Grace Period**:

- Mark Account with `deleted_at = now()`
- Store deletion reason and admin who deleted
- Keep all data intact for 30-day grace period

**B. Account Restoration**:

- Allow Archaser Admin to restore within 30 days
- Clear `deleted_at` and restore full access
- Log restoration action

**C. File Deletion** (both S3 and local):

- Delete activity attachments: `public/uploads/{accountId}/` or S3: `{accountId}/`
- Delete account logo files
- Clean up all uploaded files associated with account
- Use `FileUploadService` for S3 deletion
- Use filesystem operations for local files

**D. Data Anonymization** (triggered after 30 days by cron job):

- **Account**: Name → "Deleted Account {id}", address/email settings → null
- **Users**: Set `deactivated_at`, email → "deleted\_{id}@anonymized.local", names → "Deleted User"
- **Contacts**: Email → "deleted\_{id}@anonymized.local", phone → "**_REDACTED_**", names → "Deleted Contact"
- **Activities**: Redact email addresses and phone numbers from content/title
- **Email/SMS Activities**: Ensure no email or phone visible in activity logs
- **Keep unchanged**: Invoices, payments, amounts, dates, transaction records

**E. Audit Logging**:

- Log deletion/restoration with full details
- Track anonymization completion
- Maintain audit trail for 6 months

### 4. Fix Account Delete API

**File**: [`pages/api/entities/[...path].ts`](pages/api/entities/[...path].ts) (lines 1273-1309)

**Current bugs**:

- Uses `prisma.customer.delete()` instead of `prisma.account.delete()`
- Hard delete instead of soft delete

**Updates**:

- Fix bug: change customer → account
- Replace with `AccountDeletionService.softDeleteAccount()`
- Only allow Archaser Admin (account_id = 10013)
- Return grace period information

**New API endpoint for restoration**:

- `PUT /api/entities/accounts/{id}/restore`
- Only available within 30-day grace period
- Requires Archaser Admin permissions

### 5. Update Query Filters Everywhere

**Add `deleted_at: null` filter to**:

- [`server/services/AccountService.ts`](server/services/AccountService.ts) - All account queries
- [`pages/api/entities/[...path].ts`](pages/api/entities/[...path].ts) - Account GET handlers
- Authentication checks - Exclude deleted accounts from login
- All account lookups across the application

### 6. Data Anonymization Utilities

**File**: `utils/dataAnonymization.ts` (new file)

```typescript
// Email anonymization
anonymizeEmail(email: string, id: number): string
// → "deleted_account_12345@anonymized.local"

// Name anonymization
anonymizeName(type: 'account' | 'user' | 'contact', id: number): string
// → "Deleted Account 12345"

// Phone anonymization
anonymizePhone(phone: string): string
// → "***REDACTED***"

// Activity content anonymization (remove email/phone patterns)
anonymizeActivityContent(content: string): string
// → Replace emails and phones with "[REDACTED]"

// Address anonymization
anonymizeAddress(): object
// → Return null/empty object
```

### 7. File Deletion Service

**File**: `server/services/FileDeletionService.ts` (new file)

Handles deletion of:

- **S3 files**: Use AWS SDK to delete folder `{accountId}/`
- **Local files**: Delete `public/uploads/{accountId}/` recursively
- **Activity attachments**: Query and delete all `ActivityAttachment` records
- **Account logos**: Delete logo files from storage

Integration with `FileUploadService` for environment detection (S3 vs local).

### 8. Frontend Changes

**A. Account List UI** - [`app/[locale]/app/admin/accounts/AccountList.tsx`](app/[locale]/app/admin/accounts/AccountList.tsx):

- Add **status filter** with options: "All", "Active", "Deleted"
- Add **Actions column** with:
    - Trash icon (DeleteIcon) for active accounts
    - Restore icon (RestoreIcon) for deleted accounts within grace period
    - Show grace period countdown: "Restore available for X days"
- Visual indicators:
    - Deleted accounts shown with grey background
    - Badge showing "Deleted" status and date
    - Warning if nearing end of grace period

**B. Delete Confirmation Modal** - Use existing [`DeleteDialog`](shared/layout-components/modal/DeleteDialog.tsx):

```typescript
<DeleteDialog
  isOpen={deleteDialogOpen}
  onClose={() => setDeleteDialogOpen(false)}
  onConfirm={handleConfirmDelete}
  title={t('accounts.delete_account_title')}
  description={
    <Box>
      <Typography>
        {t('accounts.delete_warning', { accountName })}
      </Typography>
      <Typography sx={{ mt: 2, color: 'warning.main' }}>
        • All users will be deactivated
        • All contacts will be anonymized
        • All files will be deleted
        • Financial records will be preserved
        • 30-day grace period for restoration
      </Typography>
      <TextField
        label={t('accounts.type_account_name')}
        value={confirmationText}
        onChange={(e) => setConfirmationText(e.target.value)}
        fullWidth
        sx={{ mt: 2 }}
      />
    </Box>
  }
  type="delete"
  confirmLabel={t('common.actions.delete')}
  maxWidth="sm"
/>
```

**C. Restore Confirmation Modal** - Same pattern, different messaging:

- Show restore confirmation
- Explain what will be restored
- Confirm restoration action

**D. Prevent Operations on Deleted Accounts**:

- Redirect if user tries to access deleted account
- Show appropriate error message
- Disable all actions for deleted accounts (except restore)

### 9. Cron Job for Permanent Anonymization

**File**: `server/cron-jobs/anonymizeDeletedAccounts.ts` (new file)

- Run daily at 2 AM
- Find accounts where `deleted_at < now() - 30 days`
- For each account:
    - Call `AccountDeletionService.anonymizeAccount(accountId)`
    - Delete all files (S3/local)
    - Log completion
- Send notification to system admins with anonymization summary

### 10. Translation Keys

Add to translation files:

```json
{
    "accounts.delete_account_title": "Delete Account",
    "accounts.delete_warning": "Are you sure you want to delete {{accountName}}?",
    "accounts.delete_description": "This action will...",
    "accounts.type_account_name": "Type account name to confirm",
    "accounts.restore_account": "Restore Account",
    "accounts.restore_warning": "Restore {{accountName}}?",
    "accounts.grace_period_days": "{{days}} days remaining",
    "accounts.filter_active": "Active Accounts",
    "accounts.filter_deleted": "Deleted Accounts",
    "accounts.filter_all": "All Accounts"
}
```

## Data Retention Policy

| Data Type | Action | Retention | Reason |

|-----------|--------|-----------|--------|

| Account PII | Anonymize | 30 days grace | GDPR Article 17 |

| User PII | Anonymize | 30 days grace | GDPR Article 17 |

| Contact PII | Anonymize | 30 days grace | GDPR Article 17 |

| Email/SMS in activities | Anonymize | 30 days grace | GDPR Article 17 |

| Files (S3/local) | Delete | 30 days grace | GDPR compliance |

| Invoices | Keep | 10 years | Tax/accounting law |

| Payments | Keep | 10 years | Financial compliance |

| Audit logs | Keep | 6 months | Compliance requirement |

| Activity metadata | Keep | 6 months | Business intelligence |

## Testing Strategy

### Unit Tests

- `AccountDeletionService.test.ts` - Soft delete, restoration, anonymization
- `FileDeletionService.test.ts` - S3 and local file deletion
- `DataAnonymization.test.ts` - All anonymization functions
- `ActivityContentAnonymization.test.ts` - Email/phone redaction

### Integration Tests

- Account deletion API with permission checks
- Account restoration API within/outside grace period
- File deletion (mock S3 and filesystem)
- Cron job anonymization process
- Query filters excluding deleted accounts

### Manual Testing

- Delete test account → verify soft delete
- Check grace period countdown in UI
- Restore account → verify full restoration
- Wait for anonymization → verify PII removed
- Verify emails/phones hidden in activities
- Test file deletion (both S3 and local)
- Verify financial data intact

## Security & Compliance

1. **Access Control**: Only Archaser Admin (account_id = 10013)
2. **Confirmation**: Require typing account name to confirm deletion
3. **Audit Trail**: Log all deletion/restoration attempts (6 months)
4. **Grace Period**: 30 days for restoration, then permanent anonymization
5. **GDPR Compliance**:
    - Right to erasure (Article 17)
    - Legal basis for retention (Article 17(3)(b))
    - Data minimization (Article 5(1)(c))

6. **File Cleanup**: Ensure all S3 and local files removed

## Migration Path

1. Create and run database migration
2. Implement `DataAnonymizationUtils` and `FileDeletionService`
3. Implement `AccountDeletionService` with soft delete, restoration, anonymization
4. Fix Account delete API bug and add restoration endpoint
5. Update all account queries to filter deleted accounts
6. Implement frontend UI (filters, actions column, modals)
7. Add translation keys
8. Deploy anonymization cron job
9. Test thoroughly in staging
10. Document deletion policy for administrators

### To-dos

- [ ] Add deleted_at, deletion_reason, deleted_by fields to Account schema and create migration
- [ ] Create AccountDeletionService with soft delete and anonymization logic
- [ ] Create data anonymization utility functions
- [ ] Fix Account delete API bug and integrate soft delete service
- [ ] Update all Account queries to filter deleted_at: null
- [ ] Add deletion confirmation dialog and deleted account indicators
- [ ] Create cron job for permanent anonymization after grace period
