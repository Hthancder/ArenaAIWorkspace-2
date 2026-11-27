// A tag as a pill: colour dot + name. Used everywhere a tag shows (sheets, pages, search,
// the playlist header) so tags always look the same.

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import { Tag } from '../../services/library/tags';
import { T as UI, themedSheet } from '../../theme/ui';
import { Tap } from '../ui/Tap';

export const TagChip: React.FC<{
  tag: Pick<Tag, 'name' | 'color'>;
  /** on = carries the tag; 'some' = only some of the chosen songs do */
  state?: boolean | 'some';
  size?: 'sm' | 'md';
  count?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}> = ({ tag, state, size = 'md', count, onPress, onLongPress, accessibilityLabel, style }) => {
  const on = state === true;
  const some = state === 'some';
  const sm = size === 'sm';
  const body = (
    <>
      {on ? (
        <Ionicons name="checkmark-circle" size={sm ? 12 : 15} color={tag.color} />
      ) : some ? (
        <Ionicons name="remove-circle" size={sm ? 12 : 15} color={tag.color} />
      ) : (
        <View style={[styles.dot, sm && styles.dotSm, { backgroundColor: tag.color }]} />
      )}
      <Text numberOfLines={1} style={[styles.text, sm && styles.textSm]}>
        {tag.name}
      </Text>
      {count !== undefined ? <Text style={styles.count}>{count}</Text> : null}
    </>
  );
  const look = [
    styles.chip,
    sm && styles.chipSm,
    (on || some) && { backgroundColor: tag.color + '2E', borderColor: tag.color + 'AA' },
    some && { borderStyle: 'dashed' as const },
    style,
  ];
  if (!onPress && !onLongPress) return <View style={look}>{body}</View>;
  return (
    <Tap
      feedback="scale"
      onPress={onPress}
      onLongPress={onLongPress}
      style={look}
      accessibilityRole={state !== undefined ? 'checkbox' : 'button'}
      accessibilityState={state !== undefined ? { checked: some ? 'mixed' : on } : undefined}
      accessibilityLabel={accessibilityLabel || tag.name}
    >
      {body}
    </Tap>
  );
};

/** up to three colour dots (rows: "this song has tags") */
export const TagDots: React.FC<{ colors: string }> = ({ colors }) => {
  if (!colors) return null;
  const list = colors.split(',');
  return (
    <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no">
      {list.slice(0, 3).map((c, i) => (
        <View
          key={i}
          style={[styles.miniDot, { backgroundColor: c }, i > 0 && { marginLeft: -2 }]}
        />
      ))}
    </View>
  );
};

const styles = themedSheet(() => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    height: 32,
    borderRadius: 99,
    backgroundColor: UI.fg(0.07),
    borderWidth: 1,
    borderColor: UI.fg(0.1),
    maxWidth: 220,
  },
  chipSm: { height: 24, paddingHorizontal: 8, gap: 4 },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  dotSm: { width: 7, height: 7, borderRadius: 3.5 },
  text: { color: UI.text, fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  textSm: { fontSize: 11.5 },
  count: { color: UI.text3, fontSize: 12, fontWeight: '700' },
  dots: { flexDirection: 'row', alignItems: 'center', marginLeft: 6 },
  miniDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    borderWidth: 1,
    borderColor: UI.surface('#0A0A0F'),
  },
}));
