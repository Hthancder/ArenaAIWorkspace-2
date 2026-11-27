// Library › Thẻ: every tag with what it holds (songs · playlists). Tap → the tag's page;
// "Quản lý" opens the one place to create / rename / recolour / reorder / delete tags.

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { TagStore, useTags } from '../../services/library/tags';
import { T as UI, themedSheet } from '../../theme/ui';
import { ArtworkImage } from '../ArtworkImage';
import { EmptyState } from '../ui/EmptyState';
import { Tap } from '../ui/Tap';
import { openTagSheet } from '../tags/TagSheet';

export const TagShelf: React.FC = () => {
  const { prefs, palette, openCollection } = useHolySic();
  const vi = prefs.language === 'vi';
  useTags();
  const tags = TagStore.list();
  const counts = TagStore.counts();

  if (!tags.length)
    return (
      <EmptyState
        icon="pricetags-outline"
        accent={palette.accent}
        title={vi ? 'Chưa có thẻ nào' : 'No tags yet'}
        message={
          vi
            ? 'Gắn thẻ để nhóm bài hát và playlist theo cách của bạn (Chill, Gym, Học bài…). Mở menu ⋯ của một bài › Gắn thẻ…, rồi tìm nhanh bằng “#tên-thẻ”.'
            : 'Tags group songs and playlists your way (Chill, Gym, Study…). Open a song’s ⋯ menu › Tags…, then search “#tag”.'
        }
        actionLabel={vi ? 'Tạo thẻ' : 'New tag'}
        actionIcon="add"
        onAction={() => openTagSheet({ kind: 'manage' })}
      />
    );

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.headText}>{vi ? `${tags.length} thẻ` : `${tags.length} tags`}</Text>
        <Tap
          feedback="opacity"
          hitSlop={8}
          onPress={() => openTagSheet({ kind: 'manage' })}
          style={styles.manage}
          accessibilityRole="button"
          accessibilityLabel={vi ? 'Quản lý thẻ' : 'Manage tags'}
        >
          <Ionicons name="options-outline" size={15} color={palette.accent} />
          <Text style={[styles.manageText, { color: palette.accent }]}>
            {vi ? 'Quản lý' : 'Manage'}
          </Text>
        </Tap>
      </View>
      {tags.map((tag) => {
        const n = counts[tag.id] || { songs: 0, playlists: 0 };
        const art = n.songs ? TagStore.tracksWith(tag.id)[0]?.artworkUrl : undefined;
        const sub = [
          vi ? `${n.songs} bài hát` : `${n.songs} ${n.songs === 1 ? 'song' : 'songs'}`,
          n.playlists ? (vi ? `${n.playlists} playlist` : `${n.playlists} playlists`) : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Tap
            key={tag.id}
            onPress={() => openCollection({ kind: 'tag', tagId: tag.id })}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={`${vi ? 'Thẻ' : 'Tag'} ${tag.name}, ${sub}`}
          >
            <View style={[styles.badge, { backgroundColor: tag.color + '2E' }]}>
              {art ? (
                <ArtworkImage source={{ uri: art }} style={styles.art} />
              ) : (
                <Ionicons name="pricetag" size={22} color={tag.color} />
              )}
              <View style={[styles.dot, { backgroundColor: tag.color }]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {tag.name}
              </Text>
              <Text style={styles.sub}>{sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={UI.text3} />
          </Tap>
        );
      })}
      <Text style={styles.foot}>
        {vi
          ? 'Mẹo: gõ “#tên-thẻ” trong Tìm kiếm, hoặc tên thẻ trong ô lọc của playlist.'
          : 'Tip: type “#tag” in Search, or a tag name in a playlist’s filter.'}
      </Text>
    </View>
  );
};

const styles = themedSheet(() => ({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  headText: { color: UI.text2, fontSize: 13, fontWeight: '600' },
  manage: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6 },
  manageText: { fontSize: 14, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: { width: 52, height: 52, borderRadius: 12 },
  dot: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: UI.bg,
  },
  name: { color: UI.text, fontSize: 15.5, fontWeight: '700' },
  sub: { color: UI.text2, fontSize: 13, marginTop: 2 },
  foot: { color: UI.text3, fontSize: 12, textAlign: 'center', marginTop: 14, lineHeight: 17 },
}));
