'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button, Field, Input } from '@agentos/ui';
import { loginAction, registerAction, type AuthFormState } from '@/app/(auth)/actions';
import { useErrorText } from '@/components/error-text';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const t = useTranslations('auth');
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    mode === 'login' ? loginAction : registerAction,
    {},
  );
  const isRegister = mode === 'register';
  const errors = {
    displayName: errorText(state.fieldErrors?.displayName?.[0]),
    email: errorText(state.fieldErrors?.email?.[0]),
    password: errorText(state.fieldErrors?.password?.[0]),
  };
  const invalid = (field: keyof typeof errors) =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': `${field}-error` } : {};

  return (
    <form action={action} className="space-y-4" noValidate>
      <h1 className="text-xl font-semibold">{isRegister ? t('registerTitle') : t('loginTitle')}</h1>

      {state.error && (
        <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {errorText(state.error)}
        </p>
      )}

      {isRegister && (
        <Field label={t('name')} htmlFor="displayName" error={errors.displayName}>
          <Input
            id="displayName"
            name="displayName"
            autoComplete="name"
            required
            defaultValue={state.values?.displayName}
            {...invalid('displayName')}
          />
        </Field>
      )}

      <Field label={t('email')} htmlFor="email" error={errors.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          {...invalid('email')}
        />
      </Field>

      <Field
        label={t('password')}
        htmlFor="password"
        error={errors.password}
        hint={isRegister ? t('passwordHint') : undefined}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          required
          {...invalid('password')}
        />
      </Field>

      <Button type="submit" disabled={pending} className="w-full">
        {isRegister
          ? pending
            ? t('creatingAccount')
            : t('createAccount')
          : pending
            ? t('signingIn')
            : t('signIn')}
      </Button>

      <p className="text-center text-sm text-text-muted">
        {isRegister ? t('haveAccount') : t('newHere')}{' '}
        <Link href={isRegister ? '/login' : '/register'} className="text-primary hover:underline">
          {isRegister ? t('signInLink') : t('createAccountLink')}
        </Link>
      </p>
    </form>
  );
}
