# Git Hooks with Husky

This project uses [Husky](https://typicode.github.io/husky/) to enforce code quality checks before commits.

## Pre-Commit Hook

The pre-commit hook automatically runs before each commit and performs:

1. **TypeScript Type Checking** (`npm run type-check`)
   - Ensures no TypeScript errors exist
   - Uses increased memory allocation for large codebase

2. **Unit Tests** (`npm run test:unit`)
   - Runs all unit tests to ensure functionality
   - Uses Vitest with jsdom environment

### What Happens When Tests Fail?

If any check fails:
- ❌ The commit will be **blocked**
- You'll see clear error messages
- Fix the issues before committing again

### Bypassing Hooks (Emergency Only)

If you absolutely need to commit without running checks (not recommended):

```bash
git commit --no-verify -m "your message"
```

⚠️ **Warning**: Only use `--no-verify` in emergencies. The CI/CD pipeline will still catch issues.

## Running Checks Manually

You can run the same checks manually at any time:

```bash
# Run all pre-commit checks
npm run pre-commit

# Run individual checks
npm run type-check
npm run test:unit
npm run test:business-logic
npm run test:portal

# Run comprehensive validation
npm run validate:all
```

## CI/CD Integration

These checks also run in GitHub Actions on:
- ✅ Pull requests to `main`, `staging`, `develop`
- ✅ Specific file path changes

The CI pipeline provides additional checks:
- Coverage reports
- Multi-node version testing (18.x, 20.x)
- Integration tests

## Troubleshooting

### "Command not found: husky"

Run to reinstall hooks:
```bash
npm run prepare
```

### Tests are too slow

The hook runs only essential tests. For faster commits:
- Focus on writing passing tests
- Use `git commit --amend` to update your last commit
- Run tests in watch mode while developing: `npm run test:unit:watch`

### Hook not running

1. Check if hook is executable:
   ```bash
   ls -la .husky/pre-commit
   ```

2. Reinstall Husky:
   ```bash
   npm run prepare
   ```

## Maintenance

To update the pre-commit hook, edit `.husky/pre-commit` and adjust the commands as needed.

