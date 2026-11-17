import { useTranslation } from 'react-i18next';

import { Button } from '../components/Button';

/** Sign-in placeholder (F1). Phase 1 wires it to JellyfinAdapter.signIn; nothing is sent here. */
export function SignIn() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4">
      <h1 className="text-heading font-semibold">{t('signIn.title')}</h1>
      <form
        className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field
          id="server"
          label={t('signIn.serverUrl')}
          hint={t('signIn.serverUrlHint')}
          type="url"
        />
        <Field id="user" label={t('signIn.userName')} type="text" />
        <Field id="password" label={t('signIn.password')} type="password" />
        <Button type="submit" tone="primary" disabled>
          {t('signIn.submit')}
        </Button>
        <Button tone="ghost" disabled className="text-caption">
          {t('signIn.quickConnect')}
        </Button>
      </form>
      <p className="text-caption text-muted-foreground">{t('signIn.notYet')}</p>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  type,
}: {
  id: string;
  label: string;
  hint?: string;
  type: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-label font-medium" htmlFor={id}>
      {label}
      <input
        id={id}
        type={type}
        autoComplete={type === 'password' ? 'current-password' : 'off'}
        className="rounded-sm border border-input-border bg-background px-2.5 py-1.5 text-body font-normal text-foreground outline-none focus:ring-3 focus:ring-ring/25"
      />
      {hint ? <span className="text-caption font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
