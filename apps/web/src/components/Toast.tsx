import { useTranslation } from 'react-i18next';

import { dismissToast, toastStore } from '../lib/toast';
import { useStoreValue } from '../lib/useStore';
import { Icon } from './Icon';
import { focusRing } from './focus';

/** The one toast region: a status line with an optional Undo, read out politely. */
export function Toast() {
  const { t } = useTranslation();
  const toast = useStoreValue(toastStore);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none px-4">
      {toast ? (
        <div
          className={`pointer-events-auto mx-auto mb-2 flex max-w-xl items-center gap-3 rounded-md border bg-card px-3 py-2 text-body shadow-low ${
            toast.tone === 'danger' ? 'border-danger text-danger' : 'border-border text-foreground'
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{toast.message}</span>
          {toast.undo ? (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                dismissToast(toast.id);
              }}
              className={`min-h-6 rounded-sm px-2 py-1 text-body font-medium text-foreground underline underline-offset-2 ${focusRing}`}
            >
              {t('actions.undo')}
            </button>
          ) : null}
          <button
            type="button"
            aria-label={t('actions.dismiss')}
            onClick={() => dismissToast(toast.id)}
            className={`grid size-6 place-items-center rounded-pill text-muted-foreground hover:text-foreground ${focusRing}`}
          >
            <Icon name="close" className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
