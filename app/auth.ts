import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcrypt-ts';
import { getUser } from 'app/db';
import { authConfig } from 'app/auth.config';
import { validateAuthInput } from 'lib/validation/auth';

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: '邮箱', type: 'email' },
        password: { label: '密码', type: 'password' },
      },
      async authorize(credentials) {
        const input = validateAuthInput(credentials.email, credentials.password, 'login');
        if (!input.ok) return null;
        const [user] = await getUser(input.data.email);
        if (!user || !user.password) return null;
        if (!(await compare(input.data.password, user.password))) return null;
        return { id: String(user.id), email: user.email };
      },
    }),
  ],
});
