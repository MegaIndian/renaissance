import { useState } from 'react';
import { Image, View } from 'react-native';

import { artworkUrl } from '@/lib/player';
import { useTheme } from '@/lib/theme';

import { PlaceholderArt } from './PlaceholderArt';

/** A stable colour for an id, so the same album keeps its placeholder colour everywhere. */
export function colorIndex(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/**
 * The server's art for an item, or the placeholder square in a chart colour when it has none or the
 * image fails (DESIGN.md rule 3). Mirrors web's Artwork.
 */
export function Artwork({
  item,
  size = 'md',
  round = false,
}: {
  item: { id: string; imageId?: string | undefined };
  size?: 'sm' | 'md';
  round?: boolean;
}) {
  const { radius, space } = useTheme();
  const [failed, setFailed] = useState(false);
  const url = artworkUrl(item, size === 'sm' ? 120 : 480);
  const box =
    size === 'sm'
      ? { width: space[12], height: space[12] }
      : { width: '100%' as const, aspectRatio: 1 };
  if (!url || failed) {
    return (
      <View style={[box, round ? { borderRadius: radius.pill, overflow: 'hidden' } : null]}>
        <PlaceholderArt index={colorIndex(item.id)} size={size} />
      </View>
    );
  }
  return (
    <Image
      accessibilityElementsHidden
      importantForAccessibility="no"
      source={{ uri: url }}
      onError={() => setFailed(true)}
      style={[box, { borderRadius: round ? radius.pill : radius.sm }]}
    />
  );
}
