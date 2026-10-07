import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuthForm } from '@/components/auth-form';
import { safeNext } from '@/lib/safe-next';
import { getSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('signIn') };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string }>;
}) {
  const query = await searchParams;
  const next = query.next ? safeNext(query.next) : undefined;
  if (await getSession()) redirect(next ?? '/dashboard');
  return <AuthForm mode="login" next={next} email={query.email?.slice(0, 254)} />;
}
