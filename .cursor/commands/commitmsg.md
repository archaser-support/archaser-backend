# Generate Commit Message

Generate a conventional commit message for staged changes using AI analysis.

## Usage

This command analyzes your staged git changes and generates an appropriate conventional commit message.

## Features

- Analyzes staged file changes
- Generates conventional commit format (feat:, fix:, refactor:, etc.)
- Provides descriptive commit messages
- Handles multiple file types and changes

## How it works

1. Analyzes staged files using `git diff --cached`
2. Identifies the type of changes (features, fixes, refactoring, etc.)
3. Generates appropriate conventional commit message
4. Provides the message ready for use with `git commit`

## Example Output

```
feat: add user authentication system

- Add login/logout functionality
- Implement JWT token handling
- Add password validation
- Update user model with auth fields

Files changed: auth.js, user.js, middleware.js
```

## Usage Instructions

1. Stage your changes: `git add .`
2. Run this command to generate commit message
3. Copy the generated message
4. Use with: `git commit -m "generated message"`

## Conventional Commit Types

- **feat**: New features
- **fix**: Bug fixes
- **refactor**: Code refactoring
- **docs**: Documentation changes
- **style**: Code style changes
- **test**: Test additions/changes
- **chore**: Build/tooling changes
- **perf**: Performance improvements
- **ci**: CI/CD changes
- **build**: Build system changes
