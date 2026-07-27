# Translation Files Protection

## Overview
Translation files (`locales/**/*.json`) are protected and can only be modified by **Ofir Amitai**.

## How It Works
Translation files are protected via the **Pre-Commit Hook**:

1. **Pre-Commit Hook** (`.husky/pre-commit`)
   - Automatically checks if any translation files are being modified at commit time
   - Only restricts commits on `staging` and `main` branches
   - Allows commits to other branches (where PRs can be created for review)
   - Verifies the Git user identity before allowing the commit on protected branches

## Protected Branches
- `staging` - Only Ofir Amitai can commit/push translation changes
- `main` - Only Ofir Amitai can commit/push translation changes

**Note:** Translation changes can be committed and pushed to other branches (e.g., feature branches) and then reviewed via Pull Requests.

## Authorized Users
- **Name:** Ofir Amitai
- **Email:** support@cloudial.io

## If You Need to Modify Translation Files

### For Other Branches
You can commit and push translation changes to feature branches and create a Pull Request for review. The protection hooks only apply to `staging` and `main` branches.

### For Staging/Main Branches
If you need to modify translation files on `staging` or `main` branches, contact Ofir Amitai first.

Alternatively, if you have explicit permission, you can temporarily configure Git:
```bash
git config user.name "Ofir Amitai"
git config user.email "support@cloudial.io"
```

**Note:** This is client-side protection. For stronger enforcement, server-side hooks or branch protection rules should be configured in your Git hosting platform (GitHub/GitLab).

