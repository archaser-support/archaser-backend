---
name: Microsoft SSO Implementation
overview: Implement Microsoft SSO (Azure AD Enterprise only) on the login page, allowing existing users to authenticate using their Azure AD accounts. The implementation will add Microsoft provider to NextAuth, update the login UI with SSO button, and handle user matching by email.
todos:
    - id: setup-azure-ad
      content: Register Azure AD application and obtain Client ID, Client Secret, and configure redirect URIs
      status: pending
    - id: add-env-vars
      content: Add MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_TENANT_ID to environment configuration
      status: pending
    - id: update-nextauth
      content: Add AzureADProvider to NextAuth configuration with user matching logic in signIn callback
      status: pending
    - id: update-login-ui
      content: Add Microsoft SSO button to login page with proper styling and RTL support
      status: pending
    - id: add-translations
      content: Add translation keys for Microsoft SSO in English and Hebrew locale files
      status: pending
    - id: update-docs
      content: Document Microsoft SSO environment variables in SECURITY_ENVIRONMENT_VARIABLES.md
      status: pending
    - id: test-sso-flow
      content: Test Microsoft SSO authentication flow with existing users and error scenarios
      status: pending
---

# Microsoft SSO Implementation Plan

## Overview

Add Microsoft SSO authentication to the login page, supporting Azure AD (Enterprise) accounts only. Users with existing accounts can sign in using their Azure AD credentials by matching email addresses.

## Architecture

### Components

1. **NextAuth Configuration** - Add Microsoft provider to `pages/api/auth/[...nextauth].ts`
2. **Login Page UI** - Add Microsoft SSO button to `app/[locale]/(auth)/login/page.tsx`
3. **User Matching Logic** - Match Microsoft-authenticated users to existing database users by email
4. **Environment Variables** - Add Microsoft OAuth credentials configuration

## Implementation Steps

### 1. Install Dependencies

- No additional packages needed - NextAuth v4 includes Microsoft provider support

### 2. Azure AD App Registration Setup

- Register application in Azure Portal (Azure Active Directory)
- Configure redirect URI: `{NEXTAUTH_URL}/api/auth/callback/microsoft`
- Obtain Client ID and Client Secret
- Set required API permissions (User.Read, email, profile)

### 3. Environment Variables

Add to environment configuration:

- `MICROSOFT_CLIENT_ID` - Azure AD Application (client) ID
- `MICROSOFT_CLIENT_SECRET` - Azure AD Client Secret
- `MICROSOFT_TENANT_ID` - Azure AD Tenant ID (required, not using "common" to exclude personal accounts)

### 4. NextAuth Configuration Updates

**File**: `pages/api/auth/[...nextauth].ts`

- Import `AzureADProvider` from `next-auth/providers/azure-ad`
- Add Microsoft provider to providers array
- Configure provider with:
    - `clientId`: `process.env.MICROSOFT_CLIENT_ID`
    - `clientSecret`: `process.env.MICROSOFT_CLIENT_SECRET`
    - `tenantId`: `process.env.MICROSOFT_TENANT_ID` (required, Azure AD Enterprise only - excludes personal accounts)
- Update `jwt` callback to handle Microsoft-authenticated users:
    - Match user by email from Microsoft profile
    - Fetch existing user from database
    - Apply same validation (frozen, inactive, deactivated)
    - Return user object with same structure as credentials provider
- Update `signIn` callback to validate Microsoft users:
    - Check if user exists in database
    - Verify account status (not frozen, active, not deactivated)
    - Return true if valid, false otherwise

### 5. Login Page UI Updates

**File**: `app/[locale]/(auth)/login/page.tsx`

- Add Microsoft SSO button above or below the credentials form
- Use Material-UI components consistent with existing design
- Add Microsoft logo/icon (use `@mui/icons-material` or custom SVG)
- Implement `handleMicrosoftLogin` function:
    - Call `signIn("azure-ad", { redirect: false })`
    - Handle errors appropriately
    - Show loading state during authentication
- Add translation keys for SSO button text
- Maintain RTL support for Hebrew locale

### 6. User Matching Logic

**File**: `pages/api/auth/[...nextauth].ts` (in signIn callback)

- Extract email from Microsoft profile
- Query database for user with matching email:

    ```typescript
    const user = await prisma.user.findFirst({
        where: {
            email: profile.email,
            deactivated_at: null,
        },
        // ... select fields
    });
    ```

- Validate user status (same checks as credentials provider):
    - Not frozen
    - Status is Active
    - Not deactivated
- If user not found or invalid, return false to prevent sign-in
- Log authentication attempts (success/failure)

### 7. Session Handling

- Microsoft-authenticated users follow same session flow as credentials
- JWT token contains same user fields (id, email, account_id, role, etc.)
- Session version checking applies to SSO users
- Same redirect logic after successful authentication

### 8. Error Handling

- Handle Microsoft authentication errors:
    - User not found in database
    - Account frozen/inactive
    - Microsoft authentication failure
- Display user-friendly error messages
- Log errors for debugging

### 9. Translation Updates

**Files**: `locales/en/auth.json`, `locales/he/auth.json`

Add translation keys:

- `actions.sign_in_with_microsoft` - Button text
- `messages.microsoft_signin_error` - Error message
- `messages.microsoft_user_not_found` - User not found error

### 10. Security Considerations

- Rate limiting applies to Microsoft OAuth flow (via existing auth rate limiter)
- Validate Microsoft tokens server-side
- Ensure HTTPS in production (required for OAuth)
- Store Microsoft credentials securely in environment variables
- Log all SSO authentication attempts

## Testing Strategy

### Unit Tests

- Test user matching logic with various email formats
- Test validation of frozen/inactive accounts
- Test error handling for missing users

### Integration Tests

- Test Microsoft provider configuration
- Test OAuth callback handling
- Test session creation for SSO users

### Manual Testing

- Test Azure AD Enterprise sign-in flow
- Test error scenarios (user not found, frozen account)
- Verify personal Microsoft accounts are rejected
- Test RTL layout with SSO button
- Verify redirect after successful SSO login

## Database Changes

**No database changes required.** The implementation uses:

- JWT strategy (sessions stored in cookies, not database)
- Email-based user matching in the `signIn` callback
- Existing User table with unique email field (already sufficient)

Note: If future enhancements require account linking (linking Microsoft account to existing user), we would need to add an OAuth account linking table, but that's out of scope for this implementation.

## Files to Modify

1. `pages/api/auth/[...nextauth].ts` - Add Microsoft provider and callbacks
2. `app/[locale]/(auth)/login/page.tsx` - Add SSO button and handler
3. `locales/en/auth.json` - Add translation keys
4. `locales/he/auth.json` - Add Hebrew translations
5. `docs/SECURITY_ENVIRONMENT_VARIABLES.md` - Document new environment variables

## Dependencies

- `next-auth` (already installed, v4.24.11)
- `next-auth/providers/azure-ad` (included in next-auth package)

## Configuration Notes

### Azure AD Enterprise Setup

- Use a specific `tenantId` to restrict authentication to Azure AD Enterprise accounts only
- Personal Microsoft accounts will be excluded by using a non-"common" tenant ID
- Configure the tenant ID in the Azure AD app registration

### Redirect URI Format

- Production: `https://yourdomain.com/api/auth/callback/microsoft`
- Development: `http://localhost:3000/api/auth/callback/microsoft`

### Required Azure AD Permissions

- `User.Read` - Read user profile
- `email` - Read user email
- `profile` - Read basic profile

## Rollout Plan

1. **Phase 1**: Add Microsoft provider to NextAuth configuration
2. **Phase 2**: Update login page UI with SSO button
3. **Phase 3**: Test with existing users
4. **Phase 4**: Deploy to staging environment
5. **Phase 5**: Production deployment

## Future Enhancements (Out of Scope)

- Auto-create users for Microsoft SSO (currently only existing users)
- Account linking (link Microsoft account to existing credentials account)
- SSO-only mode (disable password login)
- Multi-provider SSO (Google, GitHub, etc.)
