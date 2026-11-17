import { supportedLanguages } from '@renaissance/core/i18n';
import type { Language } from '@renaissance/core/i18n';
import { useTranslation } from 'react-i18next';

import { setLanguage } from '@/lib/i18n';

import { SegmentedControl } from './SegmentedControl';

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const options = supportedLanguages.map((lng) => ({ value: lng, label: t(`language.${lng}`) }));
  const value = (supportedLanguages as readonly string[]).includes(i18n.language)
    ? (i18n.language as Language)
    : 'en';
  return (
    <SegmentedControl
      label={t('settings.language')}
      value={value}
      options={options}
      onChange={setLanguage}
    />
  );
}
