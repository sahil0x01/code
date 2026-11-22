# Contributing to NullFuse Code

Thanks for your interest. This project is in early development, so the best
first step is to open an issue and talk before writing a large change.

## Setup

Follow [Local development](README.md#local-development) in the README.

## Before you open a pull request

All of these must pass. CI runs the same commands.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org):

- `feat(web): add project list`
- `fix(web): handle missing env variable`
- `docs: update readme`
- `chore: bump dependencies`

## Pull requests

- Keep them small and focused on one change.
- Explain what changed and why.
- Link the issue it relates to.

## Reporting bugs and security issues

Bugs: use the issue templates. Security problems: do not open a public issue.
See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contribution is licensed under the
[AGPL-3.0](LICENSE).
