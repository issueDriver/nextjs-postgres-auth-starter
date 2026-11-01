import { redirect } from 'next/navigation';
import { loginHref } from 'lib/auth/safe-return-to';

export default function Login({ searchParams }: { searchParams: { returnTo?: string; callbackUrl?: string } }) {
  redirect(loginHref(searchParams.returnTo ?? searchParams.callbackUrl ?? ''));
}
