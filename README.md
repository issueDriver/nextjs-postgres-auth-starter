# Next.js + PostgreSQL Auth Starter

词间 H5 页面已接入 PostgreSQL 真实词库、NextAuth 邮箱密码认证和账号学习进度，不使用演示数据。运行、配置和测试说明见 [前端说明](docs/frontend.md)。

This is a [Next.js](https://nextjs.org/) starter kit that uses [NextAuth.js](https://next-auth.js.org/) for simple email + password login, [Drizzle](https://orm.drizzle.team) as the ORM, and a [Neon Postgres](https://vercel.com/postgres) database to persist the data.

## Deploy Your Own

You can clone & deploy it to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?demo-title=Next.js%20Prisma%20PostgreSQL%20Auth%20Starter&demo-description=Simple%20Next.js%2013%20starter%20kit%20that%20uses%20Next-Auth%20for%20auth%20and%20Prisma%20PostgreSQL%20as%20a%20database.&demo-url=https%3A%2F%2Fnextjs-postgres-auth.vercel.app%2F&demo-image=%2F%2Fimages.ctfassets.net%2Fe5382hct74si%2F7rsVQ1ZBSiWe9JGO6FUeZZ%2F210cba91036ca912b2770e0bd5d6cc5d%2Fthumbnail.png&project-name=Next.js%%20Prisma%20PostgreSQL%20Auth%20Starter&repository-name=nextjs-postgres-auth-starter&repository-url=https%3A%2F%2Fgithub.com%2Fvercel%2Fnextjs-postgres-auth-starter&from=templates&skippable-integrations=1&env=AUTH_SECRET&envDescription=Generate%20a%20random%20secret%3A&envLink=https://generate-secret.vercel.app/&stores=%5B%7B"type"%3A"postgres"%7D%5D)

## Developing Locally

Clone the repository, enter the project directory, and install the dependencies:

```bash
git clone https://github.com/issueDriver/nextjs-postgres-auth-starter.git
cd nextjs-postgres-auth-starter
pnpm install
```

## Getting Started

Configure `POSTGRES_URL` and `AUTH_SECRET` in your local `.env` file. Keep real
credentials out of Git. If database migrations need a separate direct connection
or elevated database role, also set `MIGRATION_DATABASE_URL`; otherwise migrations
use `POSTGRES_URL`.

Inspect the database, apply the versioned migrations, and start the development server:

```bash
pnpm db:check
pnpm db:backup
pnpm db:migrate
pnpm db:status
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Migrations preserve existing users and vocabulary data, add the study schema, and
initialize stable word order. Run them once during a maintenance window before
deploying this application version; subsequent runs skip applied migrations.
See [Database Migrations](docs/database.md) for preflight checks, testing, and recovery.

```bash
pnpm test:db
pnpm typecheck
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!
