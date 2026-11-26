import { useState } from 'react';

import { sessionStore } from '../lib/session';
import { useStoreValue } from '../lib/useStore';
import { ART_SIZES, PlaceholderArt } from './PlaceholderArt';
import type { ArtSize } from './PlaceholderArt';

/**
 * Cover art from the server at the width it is shown, with the six-colour placeholder when an item
 * has no image or the image fails (DESIGN.md rule 3: the placeholder stands in for art that exists).
 */
export function Artwork({
  imageId,
  label,
  index,
  size = 'md',
  className = '',
  rounded = 'rounded-sm',
}: {
  imageId: string | undefined;
  /** Shown in the placeholder's corner; alt text is empty because the title sits beside the art. */
  label: string;
  /** Picks the placeholder colour; a stable number per item (its position or a hash). */
  index: number;
  size?: ArtSize;
  className?: string;
  rounded?: string;
}) {
  const { adapter, session } = useStoreValue(sessionStore);
  const [failed, setFailed] = useState(false);
  const widths = { xs: 72, sm: 96, md: 300, lg: 600 };
  const cls = `${ART_SIZES[size]} ${rounded} shrink-0 overflow-hidden ${className}`;
  const src =
    imageId && adapter && session && !failed
      ? adapter.imageUrl(session, imageId, widths[size])
      : null;
  if (!src) {
    // The same size class as the image: one box, whether the cover exists or not.
    return (
      <PlaceholderArt
        index={index}
        label={size === 'xs' ? undefined : label}
        size={size}
        className={`${rounded} ${className}`}
      />
    );
  }
  return (
    <img
      src={src}
      alt={decorativeAlt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`${cls} bg-muted object-cover`}
    />
  );
}

/** The title sits beside the art, so the image itself is decorative. */
const decorativeAlt = '';

/** A stable small integer from an id, for placeholder colours that do not change on re-sort. */
export function colorIndex(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 30;
}
