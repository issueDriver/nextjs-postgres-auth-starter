export interface SessionUser {
  id: string;
  email: string;
}

export type AuthResult =
  | { ok: true; email: string }
  | { ok: false; field?: 'email' | 'password'; message: string };
