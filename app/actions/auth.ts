'use server';

import { AuthError } from 'next-auth';
import { signIn, signOut } from 'app/auth';
import { createUser } from 'app/db';
import type { AuthResult } from 'lib/contracts/auth';
import { validateAuthInput } from 'lib/validation/auth';

function isEmailConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== 'object') return false;
    const fields = current as Record<string, unknown>;
    if (fields.code === '23505' &&
      (fields.constraint_name === 'user_email_normalized_unique' || fields.constraint === 'user_email_normalized_unique')) {
      return true;
    }
    current = fields.cause;
  }
  return false;
}

export async function loginAction(email: string, password: string): Promise<AuthResult> {
  const input = validateAuthInput(email, password, 'login');
  if (!input.ok) return input;
  try {
    // beta.4 returns the callback URL when redirect is false.
    const result: unknown = await signIn('credentials', {
      email: input.data.email,
      password: input.data.password,
      redirect: false,
      redirectTo: '/me',
    });
    if (typeof result !== 'string' || new URL(result, 'https://auth.local').searchParams.has('error')) {
      return { ok: false, message: '登录失败，请重试' };
    }
    return { ok: true, email: input.data.email };
  } catch (error) {
    if (error instanceof AuthError && error.type === 'CredentialsSignin') {
      return { ok: false, message: '邮箱或密码不正确' };
    }
    return { ok: false, message: '登录失败，请重试' };
  }
}

export async function registerAction(email: string, password: string): Promise<AuthResult> {
  const input = validateAuthInput(email, password, 'register');
  if (!input.ok) return input;
  try {
    await createUser(input.data.email, input.data.password);
    return { ok: true, email: input.data.email };
  } catch (error) {
    if (isEmailConflict(error)) return { ok: false, field: 'email', message: '该邮箱已注册，请登录' };
    return { ok: false, message: '注册失败，请重试' };
  }
}

export async function logoutAction(): Promise<{ ok: boolean }> {
  try {
    const result: unknown = await signOut({ redirect: false, redirectTo: '/me' });
    if (result instanceof Response) return { ok: result.ok };
    return { ok: !!result && typeof result === 'object' && 'redirect' in result && typeof result.redirect === 'string' };
  } catch {
    return { ok: false };
  }
}
