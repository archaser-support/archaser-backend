---
description: Add portal verification flow for guest users
---

# Add Portal Verification Flow

This workflow adds a verification step for guest users accessing the portal.

## 1. Database Schema Update

### Update `prisma/schema.prisma`

Add a `VerificationCode` model to store the OTP.

```prisma
model VerificationCode {
  id              Int       @id @default(autoincrement())
  customer_uuid   String    @db.Uuid
  code            String    @db.VarChar(6)
  expires_at      DateTime  @db.Timestamptz(6)
  created_at      DateTime  @default(now()) @db.Timestamptz(6)

  @@index([customer_uuid], map: "idx_verification_code_customer_uuid")
}
```

### Apply Migration

Run the migration command:
```bash
npx prisma migrate dev --name add_verification_code
```

## 2. Backend Services

### Create `server/services/VerificationService.ts`

This service will handle code generation, storage, and verification.

- `generateCode(customerUUID: string)`: Generates a 6-digit code, saves it to DB with expiration (e.g., 15 mins).
- `verifyCode(customerUUID: string, code: string)`: Checks if code matches and is valid. Deletes code after successful verification.
- `sendVerificationEmail(customerUUID: string)`: Retrieves customer email and sends the code using `EmailService`.

### Create Server Actions

Create `app/actions/portalVerification.ts` (or similar location) to expose these functions to the frontend.
- `sendVerificationCodeAction(customerUUID: string)`
- `verifyCodeAction(customerUUID: string, code: string)`

## 3. Frontend Implementation

### Create Verification Page

Create `app/[locale]/portal/[customerUUID]/verify/page.tsx`.
- Client component with input for 6-digit code.
- Button to "Verify" -> calls `verifyCodeAction`.
- On success, sets a cookie (e.g., `portal_verified_${customerUUID}`) and redirects to `/portal/${customerUUID}`.
- "Resend Code" button -> calls `sendVerificationCodeAction`.

### Protect Portal Routes

Create `app/[locale]/portal/[customerUUID]/layout.tsx`.
- Server component.
- Reads `cookies`.
- Checks if `portal_verified_${customerUUID}` exists.
- If not verified, redirect to `/portal/${customerUUID}/verify`.
- **Exception**: logic to allow the `/verify` page itself to render (or handle it via route structure).
  - *Note*: If `layout` wraps `verify` page, we need to be careful.
  - Better approach:
    - `app/[locale]/portal/[customerUUID]/layout.tsx` checks verification.
    - If verified, render `children`.
    - If NOT verified:
      - If current path is `/verify`, render `children`.
      - Else, redirect to `/verify`.
    - *Wait*: `layout.tsx` doesn't know the current path easily in Server Components without headers check.
    - And `middleware` sets `x-pathname`. We can use that.

## 4. Middleware/Header Check details

In `app/[locale]/portal/[customerUUID]/layout.tsx`:
```typescript
import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// ...
const headersList = headers();
const pathname = headersList.get("x-pathname") || "";
// logic to check if pathname ends with /verify
```

## 5. Implementation Steps

1.  Modify `prisma/schema.prisma`.
2.  Run migration.
3.  Create `VerificationService.ts`.
4.  Create `app/actions/portalVerification.ts`.
5.  Create `app/[locale]/portal/[customerUUID]/verify/page.tsx`.
6.  Create `app/[locale]/portal/[customerUUID]/layout.tsx`.

