---
name: Development Workflow Implementation
overview: Implement a comprehensive development workflow covering static analysis, unit/integration/E2E testing, pre-commit hooks, CI/CD pipeline with AWS Amplify, staging validation, deployment gates, and post-deployment verification.
todos:
    - id: static-analysis-enhance
      content: Review and enhance ESLint, Prettier, and TypeScript configurations. Add missing linting scripts to package.json
      status: pending
    - id: coverage-config
      content: Configure Vitest coverage thresholds (80% for lines, functions, branches, statements) and add coverage validation scripts
      status: pending
    - id: playwright-config
      content: Complete Playwright configuration in playwright.config.ts with multi-browser support, mobile viewports, and CI optimizations
      status: pending
    - id: integration-testing
      content: "Set up integration testing structure: clarify boundaries, set up MSW/Playwright route mocking, implement visual regression testing"
      status: pending
    - id: pre-commit-enhance
      content: Enhance pre-commit hooks with better error messages and optional quick smoke tests
      status: pending
    - id: github-actions-ci
      content: Create comprehensive .github/workflows/ci.yml workflow that runs static analysis, unit tests, integration tests, E2E tests, and coverage checks
      status: pending
    - id: amplify-buildspec
      content: Create amplify.yml with complete build pipeline including preBuild (lint, type-check, unit tests, coverage), build, and postBuild (E2E tests) phases
      status: pending
    - id: coverage-reporting
      content: "Set up coverage reporting in CI/CD: generate reports, upload to codecov, enforce 80% threshold, display badges"
      status: pending
    - id: staging-validation
      content: "Document staging validation process: Amplify preview URLs, manual QA checklist, browser/device testing matrix"
      status: pending
    - id: deployment-gates
      content: Configure Amplify approval workflows, create release notes template, document rollback procedures
      status: pending
    - id: pre-deploy-checklist
      content: Create comprehensive pre-deployment checklist documentation and automated pre-deployment validation script
      status: pending
    - id: post-deploy-verification
      content: Create post-deployment verification script and manual verification checklist documentation
      status: pending
    - id: amplify-enhancements
      content: Add custom error handlers, backup procedures, and build optimizations to Amplify configuration
      status: pending
    - id: workflow-documentation
      content: "Create comprehensive documentation: development workflow guide, testing strategy, CI/CD pipeline guide, and all checklists"
      status: pending
---

# Development Workflow Implementation Plan

## Overview

Implement a complete development workflow that ensures code quality, prevents regressions, and automates validation at every stage from development to production deployment.

## Current State Assessment

### Already Configured

- ESLint (`.eslintrc.json`) - Configured with TypeScript, React, Next.js rules
- Prettier (`.prettierrc`) - Basic configuration exists
- TypeScript - Type checking via `npm run type-check`
- Vitest - Unit and integration testing framework installed
- Playwright - E2E testing framework installed (`@playwright/test@^1.42.1`)
- Husky - Pre-commit hooks installed and configured
- GitHub Actions - Some workflows exist (portal-tests, business-logic-tests, account-creation-tests)
- Coverage tooling - `@vitest/coverage-v8` installed

### Needs Implementation/Enhancement

- Coverage thresholds (80% target)
- Integration testing setup with Playwright
- Complete Playwright configuration
- AWS Amplify buildspec.yml/amplify.yml
- Coverage reporting in CI/CD
- Pre-commit hook enhancements
- Deployment checklist documentation
- Post-deployment verification scripts
- Staging validation process

## Implementation Plan

### 1. Static Analysis Enhancement

#### 1.1 ESLint Configuration Review

**File: `.eslintrc.json`** (already exists, verify completeness)

Ensure rules cover:

- TypeScript best practices
- React/Next.js patterns
- Accessibility (jsx-a11y) - already configured
- Import organization - already configured
- Security best practices

**Action:** Review and add any missing critical rules for production code quality.

#### 1.2 Prettier Configuration Enhancement

**File: `.prettierrc`** (already exists)

Current config is basic. Consider adding:

- File-specific overrides (JSON, Markdown, etc.)
- Integration with ESLint (already via `eslint-config-prettier`)

**Action:** Enhance if needed, ensure consistency across file types.

#### 1.3 TypeScript Configuration

**File: `tsconfig.json`**

Ensure strict mode is enabled for production builds. Verify:

- `strict: true` or appropriate strict flags
- No implicit any
- Proper path aliases

**Action:** Review TypeScript config for strictness appropriate to project needs.

#### 1.4 Linting Scripts

**File: `package.json`**

Current: `"lint": "next lint"`

Enhance with:

- `lint:fix` - Auto-fix linting issues
- `lint:strict` - Fail on warnings
- `format:check` - Already exists
- `format` - Already exists

**Action:** Add missing linting convenience scripts.

### 2. Unit Testing Setup (80% Coverage Target)

#### 2.1 Coverage Configuration

**File: `vitest.config.mjs`** or new `vitest.coverage.config.mjs`

Add coverage thresholds:

```javascript
coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html', 'lcov'],
    thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
    },
    exclude: [
        'node_modules/',
        'tests/',
        '**/*.config.*',
        '**/*.d.ts'
    ]
}
```

**Action:** Configure coverage thresholds and reporters.

#### 2.2 Coverage Scripts

**File: `package.json`**

Current scripts exist but need consolidation:

- `test:unit:coverage` - Already exists
- Add: `test:coverage:check` - Fail if below 80%
- Add: `test:coverage:report` - Generate HTML report
- Add: `test:coverage:ci` - CI-optimized coverage run

**Action:** Add coverage validation and reporting scripts.

#### 2.3 Test Organization

**Directory: `tests/unit/`** (already well-organized)

Ensure:

- Tests mirror source structure
- Clear separation: unit vs integration vs E2E
- Test utilities in `tests/helpers/` (already exists)

**Action:** Document test organization patterns.

### 3. Integration Testing Setup

#### 3.1 Playwright Configuration

**File: `playwright.config.ts`** (exists but mostly commented)

Complete configuration:

- Multi-browser support (Chromium, Firefox, WebKit)
- Mobile viewports
- Network mocking capabilities
- Test isolation
- Retry strategy
- CI/CD optimizations

**Action:** Complete Playwright configuration for integration/E2E testing.

#### 3.2 Integration Test Structure

**Directory: `tests/integration/`** (already exists)

Organize integration tests:

- Component integration tests (Vitest)
- API integration tests (Vitest with supertest)
- E2E user journey tests (Playwright)

**Action:** Clarify boundaries between integration test types.

#### 3.3 Mock Services Setup

**Directory: `tests/mocks/`** (already exists)

Enhance for integration testing:

- MSW (Mock Service Worker) setup for API mocking
- Playwright route interception
- Reusable mock fixtures

**Action:** Set up MSW or Playwright route mocking for API calls.

#### 3.4 Visual/Snapshot Testing

**File: `tests/integration/visual/`**

Set up:

- Playwright screenshot comparison
- Visual regression testing
- Snapshot management

**Action:** Implement visual regression testing with Playwright.

### 4. Pre-Commit Hooks Enhancement

#### 4.1 Husky Pre-Commit Hook

**File: `.husky/pre-commit`** (already exists)

Current behavior:

- Runs lint-staged (auto-fix)
- Runs type-check
- Skips unit tests (too slow)
- Skips build (too slow)

Enhance with:

- Quick smoke tests (if needed)
- E2E tests remain skipped (too slow)
- Better error messages
- Performance metrics

**Action:** Optimize pre-commit hook for speed while maintaining quality gates.

#### 4.2 Lint-Staged Configuration

**File: `package.json`** (lint-staged already configured)

Current config handles:

- Prettier formatting
- Stylelint for CSS

Verify:

- All file types covered
- Performance is acceptable
- No conflicts with ESLint

**Action:** Review and optimize lint-staged configuration.

### 5. CI/CD Pipeline Configuration

#### 5.1 GitHub Actions Workflow (Primary Test Execution)

**File: `.github/workflows/ci.yml`** (new)

Create comprehensive CI workflow that runs ALL tests:

- Trigger on PR to main/staging/develop
- Run static analysis (lint, type-check, format-check)
- Run unit tests with coverage (enforce 80% threshold)
- Run integration tests
- Run E2E tests (Playwright) - all browsers
- Upload coverage reports to codecov
- Upload test artifacts (videos, screenshots, traces on failure)
- Fail PR on any failure (block merge)
- Post test results as PR comments

**Matrix strategy:**

- Node versions: 20.x (matching project requirement)
- Operating systems: ubuntu-latest
- Browsers: chromium, firefox, webkit (for E2E tests)

**Workflow structure:**

1. **Static Analysis Job** - Fast, runs first
2. **Unit Tests Job** - With coverage, parallel execution
3. **Integration Tests Job** - Component/service integration
4. **E2E Tests Job** - Playwright, matrix across browsers
5. **Coverage Report Job** - Aggregate and upload coverage

**Action:** Create unified CI workflow that runs all checks and tests.

#### 5.2 AWS Amplify Configuration (Build & Deploy Only)

**File: `amplify.yml`** (create if doesn't exist)

Configure Amplify for build and deployment only (no tests):

```yaml
version: 1
frontend:
    phases:
        preBuild:
            commands:
                - npm ci
                - npx prisma generate
        build:
            commands:
                - npm run build
    artifacts:
        baseDirectory: .next
        files:
            - "**/*"
    cache:
        paths:
            - node_modules/**/*
            - .next/cache/**/*
```

**Rationale:** Tests already run in GitHub Actions on PRs. If PR is merged, tests have passed. Amplify just builds and deploys.

**Action:** Create simplified amplify.yml for build and deployment only.

#### 5.3 Coverage Reporting in CI

**File: `.github/workflows/ci.yml`**

Integrate coverage reporting in GitHub Actions:

- Generate coverage reports (HTML, LCOV, JSON)
- Upload to codecov or similar service
- Enforce 80% threshold (fail if below)
- Display coverage badges in README
- Post coverage diff as PR comment

**Action:** Set up comprehensive coverage reporting in GitHub Actions workflow.

### 6. Staging Environment Validation

#### 6.1 Amplify Preview URLs

**Configuration: AWS Amplify Console**

Set up:

- Automatic preview deployments per PR
- Unique URLs for each PR
- Manual QA process documentation
- Slack/notification integration (optional)

**Action:** Document preview URL usage and QA process.

#### 6.2 Manual QA Checklist

**File: `docs/development-guides/staging-validation-checklist.md`**

Create checklist:

- Critical user flows to test
- Browser/device testing matrix
- Performance checks
- Accessibility checks
- Visual regression checks

**Action:** Create comprehensive staging validation checklist.

### 7. Deployment Gateways

#### 7.1 Amplify Approval Workflows

**Configuration: AWS Amplify Console**

Set up:

- Approval gates for production deployments
- Required reviewers
- Deployment notifications
- Rollback procedures

**Action:** Configure Amplify approval workflows in AWS Console.

#### 7.2 Release Notes

**File: `docs/releases/`** or GitHub Releases

Establish process:

- Document all changes per release
- Link to PRs/issues
- Breaking changes highlighted
- Migration guides if needed

**Action:** Create release notes template and process.

#### 7.3 Rollback Policy

**File: `docs/development-guides/rollback-procedures.md`**

Document:

- When to rollback
- How to rollback in Amplify
- Data migration considerations
- Communication process

**Action:** Document rollback procedures.

### 8. Pre-Deployment Checklist

#### 8.1 Deployment Checklist Documentation

**File: `docs/development-guides/pre-deployment-checklist.md`**

Create checklist:

- [ ] All static analyses pass (`npm run lint`)
- [ ] Unit tests achieve >80% coverage (`npm run test:unit:coverage`)
- [ ] No failing integration tests (`npm run test:integration`)
- [ ] No failing E2E tests (`npm run test:e2e`)
- [ ] Pre-commit hook results are clean
- [ ] Manual inspection confirms expected UX flow
- [ ] Reviewers approve final build artifact
- [ ] Environment variables configured
- [ ] Database migrations tested
- [ ] Performance benchmarks met

**Action:** Create comprehensive pre-deployment checklist.

#### 8.2 Automated Checklist Script

**File: `scripts/pre-deployment-check.sh`**

Create script that:

- Runs all static analysis
- Runs all tests
- Checks coverage thresholds
- Validates environment variables
- Generates deployment readiness report

**Action:** Create automated pre-deployment validation script.

### 9. Post-Deployment Verification

#### 9.1 Post-Deploy Verification Script

**File: `scripts/post-deployment-verification.sh`**

Create script for:

- Health check endpoints
- Critical API endpoints
- Database connectivity
- External service connectivity
- Basic smoke tests

**Action:** Create post-deployment verification script.

#### 9.2 Manual Verification Checklist

**File: `docs/development-guides/post-deployment-verification.md`**

Document:

- Browser/device testing matrix
- Critical user flows to verify
- Network traffic inspection
- Performance monitoring
- Error log monitoring
- Comparison with baseline snapshots

**Action:** Create post-deployment manual verification guide.

#### 9.3 Monitoring Setup

**Configuration: AWS CloudWatch / External Monitoring**

Set up:

- Application performance monitoring
- Error tracking
- Uptime monitoring
- Custom metrics/alerts

**Action:** Document monitoring setup and alerting procedures.

### 10. Amplify-Specific Enhancements

#### 10.1 Custom Error Handlers

**File: `amplify.yml`**

Add:

- CloudFormation template validation (if applicable)
- Custom error handling in build phases
- Verbose logging for debugging

**Action:** Enhance amplify.yml with error handling and logging.

#### 10.2 Backup Procedures

**File: `scripts/backup-before-deploy.sh`**

Create backup script:

- Database backup (if applicable)
- S3 backup (if applicable)
- Configuration backup
- Run before destructive actions

**Action:** Create backup procedures and scripts.

#### 10.3 Build Optimization

**File: `amplify.yml`**

Optimize:

- Caching strategies
- Parallel execution where possible
- Build time optimization
- Artifact management

**Action:** Optimize Amplify build configuration.

### 11. Documentation

#### 11.1 Development Workflow Guide

**File: `docs/development-guides/development-workflow.md`**

Comprehensive guide covering:

- Local development setup
- Running tests
- Pre-commit hooks
- CI/CD process
- Deployment process
- Troubleshooting

**Action:** Create comprehensive development workflow documentation.

#### 11.2 Testing Strategy Document

**File: `docs/development-guides/testing-strategy.md`**

Document:

- Unit testing approach
- Integration testing approach
- E2E testing approach
- Coverage requirements
- Test organization
- Best practices

**Action:** Create testing strategy documentation.

#### 11.3 CI/CD Pipeline Documentation

**File: `docs/development-guides/cicd-pipeline.md`**

Document:

- GitHub Actions workflows
- AWS Amplify configuration
- Build process
- Deployment process
- Troubleshooting common issues

**Action:** Create CI/CD pipeline documentation.

## Files to Create/Modify

### New Files:

1. `amplify.yml` - AWS Amplify buildspec configuration
2. `.github/workflows/ci.yml` - Comprehensive CI workflow
3. `vitest.coverage.config.mjs` - Coverage configuration (or enhance existing)
4. `scripts/pre-deployment-check.sh` - Pre-deployment validation
5. `scripts/post-deployment-verification.sh` - Post-deployment checks
6. `scripts/backup-before-deploy.sh` - Backup procedures
7. `docs/development-guides/development-workflow.md` - Main workflow guide
8. `docs/development-guides/staging-validation-checklist.md` - Staging QA checklist
9. `docs/development-guides/pre-deployment-checklist.md` - Pre-deploy checklist
10. `docs/development-guides/post-deployment-verification.md` - Post-deploy guide
11. `docs/development-guides/rollback-procedures.md` - Rollback procedures
12. `docs/development-guides/testing-strategy.md` - Testing strategy
13. `docs/development-guides/cicd-pipeline.md` - CI/CD documentation

### Files to Modify:

1. `playwright.config.ts` - Complete configuration
2. `vitest.config.mjs` - Add coverage thresholds
3. `package.json` - Add new scripts for coverage, validation, etc.
4. `.husky/pre-commit` - Enhance with better messaging (optional)
5. `.eslintrc.json` - Review and enhance if needed
6. `.prettierrc` - Enhance if needed

## Success Criteria

1. All static analysis tools configured and running in CI
2. Unit tests achieve 80% coverage threshold (enforced in CI)
3. Integration tests cover critical component interactions
4. E2E tests cover critical user journeys
5. Pre-commit hooks prevent bad commits without blocking workflow
6. CI/CD pipeline runs all checks automatically on PR
7. AWS Amplify buildspec includes all validation steps
8. Staging validation process is documented and followed
9. Deployment checklist is comprehensive and used
10. Post-deployment verification process is established
11. All documentation is complete and accessible
12. Team can confidently deploy without breaking production

## Implementation Priority

### Phase 1: Foundation (Critical)

1. Complete Playwright configuration
2. Set up coverage thresholds
3. Create amplify.yml
4. Create unified CI workflow
5. Enhance pre-commit hooks

### Phase 2: Validation (High Priority)

6. Create pre-deployment checklist
7. Set up coverage reporting
8. Create post-deployment verification
9. Document staging validation process

### Phase 3: Optimization (Medium Priority)

10. Optimize build times
11. Set up monitoring/alerts
12. Create backup procedures
13. Complete all documentation

## Dependencies

- Existing tools: ESLint, Prettier, TypeScript, Vitest, Playwright, Husky
- CI/CD: GitHub Actions, AWS Amplify
- Coverage: @vitest/coverage-v8 (already installed)
- Mocking: Consider MSW for API mocking (optional)
- Monitoring: AWS CloudWatch or external service (to be configured)
