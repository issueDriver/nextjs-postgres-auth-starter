type AuthInputResult =
  | { ok: true; data: { email: string; password: string } }
  | { ok: false; field: 'email' | 'password'; message: string };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateAuthInput(
  email: unknown,
  password: unknown,
  mode: 'login' | 'register'
): AuthInputResult {
  if (typeof email !== 'string' || !email.trim()) {
    return { ok: false, field: 'email', message: '请输入邮箱' };
  }
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail.length > 64) {
    return { ok: false, field: 'email', message: '邮箱不能超过 64 个字符' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, field: 'email', message: '请输入有效的邮箱地址' };
  }
  if (typeof password !== 'string' || !password) {
    return { ok: false, field: 'password', message: '请输入密码' };
  }
  if (mode === 'register' && password.length < 8) {
    return { ok: false, field: 'password', message: '密码至少需要 8 个字符' };
  }
  if (mode === 'register' && new TextEncoder().encode(password).length > 72) {
    return { ok: false, field: 'password', message: '密码过长，请控制在 72 字节以内' };
  }
  return { ok: true, data: { email: normalizedEmail, password } };
}

export function isValidUserId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2_147_483_647;
}
