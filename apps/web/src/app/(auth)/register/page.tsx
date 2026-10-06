import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { getSession } from '@/server/session';

export default async function RegisterPage() {
  if (await getSession()) redirect('/dashboard');
  return <AuthForm mode="register" />;
}
