<!-- 7f9f7d62-a8f7-4dd5-a896-3297504defa8 e7bf32dd-e1ef-4b58-ad41-e547289ef3d8 -->

# 2FA Implementation Plan: Account-Level SMS and Authenticator App Support

## Overview

Add two-factor authentication (2FA) support at the **Account level** (not User level) with two methods:

- **SMS-based**: Send verification codes via SMS using Inforu provider (only for accounts in Israel)
- **Authenticator App (TOTP)**: Support Google Authenticator, Microsoft Authenticator, and other TOTP-compatible apps (available for all accounts)

## Key Requirements

1. **Account-level 2FA**: 2FA toggle and configuration stored in Account model
2. **SMS Method**: Only available for accounts with `country_id` = Israel, uses Inforu provider
3. **Mobile Requirement**: If SMS 2FA is enabled, `mobile` becomes required field when creating users for that account
4. **Login Check**: Check account-level 2FA during login flow
5. **No Backup Codes**: Remove backup codes functionality - use "reset authenticator access" for recovery
6. **Login Logging**: Every login (successful and failed) must be logged to MongoDB
7. **Naming Convention**: Use snake_case for model fields, table names capitalized
8. **Route Consolidation**: All 2FA routes consolidated into existing `pages/api/auth/[...path].ts`
9. **No Env Toggles**: Remove environment-level 2FA feature flags

## Database Schema Changes

### Account Model Extensions (`prisma/schema.prisma`)

Add fields to the `Account` model (snake_case):

- `two_factor_enabled` (Boolean, default: false) - Whether 2FA is enabled for the account
- `two_factor_method` (Enum: SMS | TOTP | null) - Preferred 2FA method for the account
- `two_factor_secret` (String, optional) - TOTP secret for authenticator apps (encrypted, account-level)

### New Model: TwoFactorVerification

Create a new model to track pending 2FA verifications during login (snake_case fields):

- `id` (String, UUID)
- `user_id` (String, foreign key to User)
- `code` (String, hashed) - SMS code or TOTP verification token
- `method` (Enum: SMS | TOTP)
- `expires_at` (DateTime)
- `verified` (Boolean, default: false)
- `created_at` (DateTime)

**Table name**: `TwoFactorVerification` (capitalized first letter)

### User Model Changes

- **No 2FA fields added to User model** - all 2FA configuration is at Account level
- `mobile` field already exists - will be validated as required when account has SMS 2FA enabled

## Implementation Components

### 1. Backend Services

**`server/services/TwoFactorService.ts`**

- `isAccountInIsrael(accountId)` - Check if account's country_id is Israel
- `isSMSAvailable(accountId)` - Check if SMS 2FA is available (account in Israel)
- `generateTOTPSecret()` - Generate TOTP secret for authenticator setup
- `generateQRCode(secret, accountName, userEmail)` - Generate QR code for authenticator app
- `verifyTOTPCode(secret, code)` - Verify TOTP code from authenticator app
- `generateSMSCode()` - Generate 6-digit SMS code
- `sendSMSCodeViaInforu(userId, accountId, code)` - Send SMS code using Inforu via SMSVendorService
- `verifyCode(userId, code, method)` - Verify SMS or TOTP code
- `enableTwoFactor(accountId, method, secret?)` - Enable 2FA for account
- `disableTwoFactor(accountId)` - Disable 2FA for account
- `getAccountTwoFactorStatus(accountId)` - Get 2FA status for account

**`server/services/TwoFactorAuthService.ts`**

- `requireTwoFactor(accountId)` - Check if account has 2FA enabled
- `initiateTwoFactorVerification(userId, accountId, method)` - Start 2FA verification flow
- `completeTwoFactorVerification(sessionId, code)` - Complete verification and allow login
- `resetAuthenticatorAccess(accountId, userId)` - Reset TOTP secret (admin function)

### 2. API Endpoints (Consolidated in `pages/api/auth/[...path].ts`)

Add new handlers to existing auth route:

- `GET /api/auth/2fa/status` - Get current account 2FA status
- `POST /api/auth/2fa/setup` - Initialize 2FA setup (generate TOTP secret/QR code or send SMS test)
- `POST /api/auth/2fa/enable` - Enable 2FA after verification (requires verification code)
- `POST /api/auth/2fa/disable` - Disable 2FA (requires password confirmation)
- `POST /api/auth/2fa/verify` - Verify 2FA code during login flow
- `POST /api/auth/2fa/reset-authenticator` - Reset authenticator access (admin only)

### 3. NextAuth Integration

**Modify `pages/api/auth/[...nextauth].ts`**

- Update `authorize` function to check account-level 2FA requirement
- Fetch account's `two_factor_enabled` and `two_factor_method` after password verification
- If 2FA enabled, don't complete login immediately
- Store pending authentication in session/token with account 2FA method
- Add callback to handle 2FA verification step
- After successful 2FA verification, complete login
- **Log every login attempt to MongoDB** (successful and failed) using MongoLogService

### 4. User Creation/Update Validation

**Modify user creation/update logic:**

- When creating/updating users, check if account has SMS 2FA enabled
- If SMS 2FA enabled and method is SMS, validate that `mobile` field is required
- Show appropriate error message if mobile is missing

### 5. Frontend Components

**`app/[locale]/(auth)/login/page.tsx`**

- Add 2FA code input step after password verification
- Check account 2FA status from session/API
- Show appropriate UI based on account's 2FA method (SMS vs TOTP)
- Handle resend SMS code functionality
- Log login attempts to MongoDB

**`app/[locale]/app/settings/account/page.tsx`** (modify existing or create new)

- Add 2FA configuration section at account level
- Toggle to enable/disable 2FA for the account
- Method selection (SMS or Authenticator App)
- SMS option only shown if account's country_id is Israel
- Show message if account is not in Israel: "SMS 2FA is only available for accounts in Israel"
- QR code display for authenticator setup
- SMS test code sending (if SMS method selected)
- Reset authenticator access button

**`app/components/auth/TwoFactorSetup.tsx`** (new)

- Component for 2FA setup wizard at account level
- Step 1: Choose method (SMS or Authenticator) - SMS only if account in Israel
- Step 2: Verify setup (enter code)
- Step 3: Confirmation

**`app/components/auth/TwoFactorVerification.tsx`** (new)

- Component for 2FA code input during login
- Method-specific UI (SMS code input vs TOTP input)
- Resend SMS code button
- Error handling

### 6. Dependencies

Add to `package.json`:

- `otplib` - TOTP generation and verification
- `qrcode` - QR code generation for authenticator setup

## Implementation Flow

### Account-Level Setup Flow

1. Admin navigates to Account Settings
2. Admin clicks "Enable 2FA" for the account
3. System checks available methods:

- If account's `country_id` = Israel: Show both SMS and Authenticator App options
- If account's `country_id` ≠ Israel: Show only Authenticator App option

4. Admin selects method (SMS or Authenticator App)
5. If SMS selected:

- System validates that all users in account have `mobile` numbers
- System sends test code to admin's mobile number
- Admin enters code to verify

6. If TOTP selected:

- System generates secret and displays QR code
- Admin scans QR code with authenticator app
- Admin enters code from app to verify

7. System enables 2FA for the account with selected method

### Login Flow

1. User enters email and password
2. System verifies credentials
3. **System logs login attempt to MongoDB** (with account_id, user_id, timestamp, status)
4. System fetches user's account and checks `two_factor_enabled`
5. If account 2FA enabled:

- System checks account's `two_factor_method` field
- **If SMS method**:
- Verify account is in Israel (country_id check)
- Send 6-digit code to user's mobile number via Inforu
- Display SMS code input field with "Resend Code" button
- **If TOTP method**:
- Display TOTP code input field (6-digit)
- Show hint: "Enter code from your authenticator app"
- User enters code
- System verifies code

6. If verification successful:

- **Log successful login to MongoDB**
- Complete login

7. If verification fails:

- **Log failed login attempt to MongoDB**
- Show error and allow retry (with rate limiting)

### SMS Sending Logic

- When SMS 2FA code needs to be sent:

1. Verify account's `country_id` is Israel
2. Get account's country_id
3. Use SMSVendorService to send via Inforu provider
4. Find Inforu vendor configured for Israel
5. Send SMS using `SMSVendorService.sendSMS()` with Inforu vendor

### Method Switching

- Admins can change account's 2FA method in Account Settings
- Changing method requires:

1. Disable current 2FA (with password confirmation)
2. Re-enable with new method (full setup flow)
3. If switching to SMS, validate all users have mobile numbers

### Recovery (Reset Authenticator Access)

- If user loses access to authenticator app:

1. Admin can reset authenticator access via Account Settings
2. System generates new TOTP secret
3. Admin displays new QR code
4. User scans new QR code with authenticator app
5. User verifies with new code

## Security Considerations

- Encrypt TOTP secrets in database
- Hash SMS verification codes before storage
- Set expiration times for verification codes (5-10 minutes)
- Rate limit 2FA verification attempts
- Log all 2FA events and login attempts to MongoDB for security auditing
- Require password confirmation to disable 2FA
- Validate account country before allowing SMS 2FA
- Require mobile numbers for all users when SMS 2FA is enabled

## Testing Requirements

- Unit tests for TwoFactorService methods
- Integration tests for 2FA login flow
- E2E tests for account-level setup and verification
- Test SMS code delivery via Inforu for Israel accounts
- Test TOTP code generation and verification
- Test login logging to MongoDB
- Test mobile number validation when SMS 2FA enabled
- Test error scenarios (expired codes, invalid codes, non-Israel account trying SMS, etc.)

## Migration Strategy

1. Add new fields to Account model (nullable, default values)
2. Create TwoFactorVerification model
3. Run Prisma migration
4. Deploy backend services
5. Add API endpoints to existing auth route
6. Update NextAuth configuration with login logging
7. Deploy frontend components
8. Test with Israel and non-Israel accounts

### To-dos

- [ ] Add 2FA fields to User model and create TwoFactorVerification model in Prisma schema
- [ ] Create TwoFactorService with TOTP secret generation, QR code generation, code verification, and SMS code sending
- [ ] Create TwoFactorAuthService for managing 2FA verification flow during login
- [ ] Create API endpoints for 2FA setup, enable, disable, and verification
- [ ] Integrate 2FA verification into NextAuth authorize flow and session management
- [ ] Create security settings page and TwoFactorSetup component for enabling/configuring 2FA
- [ ] Add TwoFactorVerification component to login page for code input during authentication
- [ ] Install required npm packages (otplib, qrcode) for TOTP and QR code generation
