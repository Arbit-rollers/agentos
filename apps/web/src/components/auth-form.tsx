'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { loginAction, registerAction, type AuthFormState } from '@/app/(auth)/actions';

const COPY = {
  login: {
    title: 'Sign in to AgentOS',
    submit: 'Sign in',
    pending: 'Signing in…',
    switchText: 'New to AgentOS?',
    switchLink: 'Create an account',
    switchHref: '/register',
  },
  register: {
    title: 'Create your AgentOS account',
    submit: 'Create account',
    pending: 'Creating account…',
    switchText: 'Already have an account?',
    switchLink: 'Sign in',
    switchHref: '/login',
  },
} as const;

function FieldError({ messages }: { messages?: string[] | undefined }) {
  if (!messages?.length) return null;
  return <p className="mt-1 text-sm text-danger">{messages[0]}</p>;
}

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    mode === 'login' ? loginAction : registerAction,
    {},
  );
  const copy = COPY[mode];
  const input =
    'mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 outline-none focus:border-primary';

  return (
    <form action={action} className="space-y-4" noValidate>
      <h1 className="text-xl font-semibold">{copy.title}</h1>

      {state.error && (
        <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <label className="block text-sm">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          className={input}
        />
        <FieldError messages={state.fieldErrors?.email} />
      </label>

      <label className="block text-sm">
        Password
        <input
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'register' ? 10 : undefined}
          className={input}
        />
        {mode === 'register' && !state.fieldErrors?.password && (
          <p className="mt-1 text-xs text-text-muted">At least 10 characters.</p>
        )}
        <FieldError messages={state.fieldErrors?.password} />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-primary px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        {pending ? copy.pending : copy.submit}
      </button>

      <p className="text-center text-sm text-text-muted">
        {copy.switchText}{' '}
        <Link href={copy.switchHref} className="text-primary hover:underline">
          {copy.switchLink}
        </Link>
      </p>
    </form>
  );
}
