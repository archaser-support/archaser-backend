# Google SSO Implementation Plan

## Overview

Add Google SSO authentication to the login page, allowing existing users to authenticate using their Google accounts. Users with existing accounts can sign in using their Google credentials by matching email addresses.

## Architecture

### Components

1. **NextAuth Configuration** - Add Google provider to `pages/api/auth/[...nextauth].ts`
2. **Login Page UI** - Add Google SSO button to `app/[locale]/(auth)/login/page.tsx`
3. **User Matching Logic** - Match Google-authenticated users to existing database users by email
4. **Environment Variables** - Add Google OAuth credentials configuration

## Implementation Steps

### 1. Install Dependencies

- No additional packages needed - NextAuth v4 includes Google provider support
- GoogleProvider is already imported but commented out in the current NextAuth configuration

### 2. Google Cloud Console Setup

- Register application in Google Cloud Console
- Enable Google+ API (if needed) or use the default Google OAuth 2.0 API
- Configure OAuth consent screen:
    - Set application type (Internal/External)
    - Configure scopes: `email`, `profile`
    - Add authorized domains
- Create OAuth 2.0 Client ID credentials:
    - Application type: Web application
    - Configure authorized redirect URIs: `{NEXTAUTH_URL}/api/auth/callback/google`
    - Obtain Client ID and Client Secret

### 3. Environment Variables

Add to environment configuration:

- `GOOGLE_CLIENT_ID` - Google OAuth Client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth Client Secret

### 4. NextAuth Configuration Updates

**File**: `pages/api/auth/[...nextauth].ts`

- Uncomment and import `GoogleProvider` from `next-auth/providers/google`
- Add Google provider to providers array
- Configure provider with:
    - `clientId`: `process.env.GOOGLE_CLIENT_ID`
    - `clientSecret`: `process.env.GOOGLE_CLIENT_SECRET`
- Update `jwt` callback to handle Google-authenticated users:
    - Match user by email from Google profile
    - Fetch existing user from database
    - Apply same validation (frozen, inactive, deactivated)
    - Return user object with same structure as credentials provider
- Update `signIn` callback to validate Google users:
    - Check if user exists in database
    - Verify account status (not frozen, active, not deactivated)
    - Return true if valid, false otherwise

### 5. Login Page UI Updates

**File**: `app/[locale]/(auth)/login/page.tsx`

- Add Google SSO button above or below the credentials form
- Use Material-UI components consistent with existing design
- Add Google logo/icon (use `@mui/icons-material` or custom SVG)
- Implement `handleGoogleLogin` function:
    - Call `signIn("google", { redirect: false })`
    - Handle errors appropriately
    - Show loading state during authentication
- Add translation keys for SSO button text
- Maintain RTL support for Hebrew locale

### 6. User Matching Logic

**File**: `pages/api/auth/[...nextauth].ts` (in signIn callback)

- Extract email from Google profile (`profile.email`)
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

- Google-authenticated users follow same session flow as credentials
- JWT token contains same user fields (id, email, account_id, role, etc.)
- Session version checking applies to SSO users
- Same redirect logic after successful authentication

### 8. Error Handling

- Handle Google authentication errors:
    - User not found in database
    - Account frozen/inactive
    - Google authentication failure
- Display user-friendly error messages
- Log errors for debugging

### 9. Translation Updates

**Files**: `locales/en/auth.json`, `locales/he/auth.json`

Add translation keys:

- `actions.sign_in_with_google` - Button text
- `messages.google_signin_error` - Error message
- `messages.google_user_not_found` - User not found error

### 10. Security Considerations

- Rate limiting applies to Google OAuth flow (via existing auth rate limiter)
- Validate Google tokens server-side
- Ensure HTTPS in production (required for OAuth)
- Store Google credentials securely in environment variables
- Log all SSO authentication attempts
- Verify email address from Google profile matches database email exactly

## Testing Strategy

### Unit Tests

- Test user matching logic with various email formats
- Test validation of frozen/inactive accounts
- Test error handling for missing users
- Test Google provider configuration

### Integration Tests

- Test Google provider configuration
- Test OAuth callback handling
- Test session creation for SSO users

### Manual Testing

- Test Google sign-in flow with existing user accounts
- Test error scenarios (user not found, frozen account)
- Test with different Google account types (personal, workspace)
- Test RTL layout with SSO button
- Verify redirect after successful SSO login
- Test email matching with various formats (case sensitivity, etc.)

## Database Changes

**No database changes required.** The implementation uses:

- JWT strategy (sessions stored in cookies, not database)
- Email-based user matching in the `signIn` callback
- Existing User table with unique email field (already sufficient)

Note: If future enhancements require account linking (linking Google account to existing user), we would need to add an OAuth account linking table, but that's out of scope for this implementation.

## Files to Modify

1. `pages/api/auth/[...nextauth].ts` - Add Google provider and callbacks
2. `app/[locale]/(auth)/login/page.tsx` - Add SSO button and handler
3. `locales/en/auth.json` - Add translation keys
4. `locales/he/auth.json` - Add Hebrew translations
5. `docs/SECURITY_ENVIRONMENT_VARIABLES.md` - Document new environment variables

## Dependencies

- `next-auth` (already installed, v4.24.11)
- `next-auth/providers/google` (included in next-auth package)

## Configuration Notes

### Google OAuth Setup

- Use standard Google OAuth 2.0 flow
- Supports both personal Google accounts and Google Workspace accounts
- Default scopes include `email` and `profile`
- No tenant restriction needed (unlike Azure AD)

### Redirect URI Format

- Production: `https://yourdomain.com/api/auth/callback/google`
- Development: `http://localhost:3000/api/auth/callback/google`

### Required Google OAuth Scopes

- `email` - Read user email address
- `profile` - Read basic profile information (name, picture, etc.)

### OAuth Consent Screen

- Configure in Google Cloud Console
- Set application name and support email
- Configure scopes that users will see during authorization
- Add authorized domains for production

## Rollout Plan

1. **Phase 1**: Add Google provider to NextAuth configuration
2. **Phase 2**: Update login page UI with SSO button
3. **Phase 3**: Test with existing users
4. **Phase 4**: Deploy to staging environment
5. **Phase 5**: Production deployment

## Future Enhancements (Out of Scope)

- Auto-create users for Google SSO (currently only existing users)
- Account linking (link Google account to existing credentials account)
- SSO-only mode (disable password login)
- Domain restriction (only allow specific Google Workspace domains)
- Multi-provider SSO (already have Microsoft, could add more)
