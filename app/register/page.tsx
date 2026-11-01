import { redirect } from 'next/navigation';

export default function Register() {
  redirect('/me?auth=register');
}
