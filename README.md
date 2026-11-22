# NullFuse Code

An open-source cloud coding agent. Give it a task on one of your GitHub
repositories, and it works in an isolated sandbox and opens a pull request for
you to review.

Hosted at [code.nullfuse.com](https://code.nullfuse.com) (coming soon).

> **Status:** early development. Not ready to use yet.

## Concepts

- **Project**: a connected GitHub repository
- **Task**: what you asked the agent to do
- **Run**: one attempt at a task
- **Credits**: what runs cost

## Local development

Requirements: Node.js 24 or newer, [pnpm](https://pnpm.io), and Docker.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm db:up
pnpm dev
```

Then open http://localhost:3000.

Checks that must pass before a pull request:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please read our
[Code of Conduct](CODE_OF_CONDUCT.md) first.

## Security

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE)
