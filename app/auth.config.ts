import type { NextAuthConfig } from 'next-auth';
import { loginHref } from 'lib/auth/safe-return-to';
import { isValidUserId } from 'lib/validation/auth';

export const authConfig = {
  pages: {
    signIn: '/login',
  },
  session: { strategy: 'jwt' },
  providers: [
    // added later in auth.ts since it requires bcrypt which is only compatible with Node.js
    // while this file is also used in non-Node.js environments
  ],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const restricted = nextUrl.pathname.startsWith('/books/') || nextUrl.pathname.startsWith('/learn/');
      if (restricted && !isValidUserId(auth?.user?.id)) {
        return Response.redirect(new URL(loginHref(nextUrl.pathname), nextUrl));
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      session.user.id = isValidUserId(token.sub) ? token.sub : '';
      return session;
    },
  },
  logger: {
    error(error) {
      const code = 'type' in error && typeof error.type === 'string' ? error.type : 'AUTH_ERROR';
      if (code !== 'CredentialsSignin') console.error('[auth]', code);
    },
  },
} satisfies NextAuthConfig;
