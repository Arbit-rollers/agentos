import { redirect } from 'next/navigation';
import { getSession } from '@/server/session';

export default async function HomePage() {
  redirect((await getSession()) ? '/dashboard' : '/login');
}
