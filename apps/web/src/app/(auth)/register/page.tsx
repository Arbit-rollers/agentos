import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuthForm } from '@/components/auth-form';
import { getSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('createAccount') };
}

export default async function RegisterPage() {
  if (await getSession()) redirect('/dashboard');
  return <AuthForm mode="register" />;
}
