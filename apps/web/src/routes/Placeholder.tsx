import { useTranslation } from 'react-i18next';

export function Placeholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <h1 className="text-lg font-semibold">{t(titleKey)}</h1>
      <div className="rounded-md border border-border bg-card p-6 text-center text-[13px] text-muted-foreground">
        {t('status.preAlpha')}
      </div>
    </div>
  );
}
