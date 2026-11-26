// Mochy Library Hub — Playlists, Liked Songs, Offline Downloads, History & Playlist Importer

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ArtworkImage } from '../ArtworkImage';
import { t } from '../../constants/i18n';
import { MOCHY_COLORS, resolveFontFamily } from '../../constants/theme';
import { useMochy } from '../../context/MochyContext';
import { TrackRow } from '../TrackRow';

type LibFilter = 'playlists' | 'liked' | 'offline' | 'history';

export const LibraryScreen: React.FC = () => {
  const {
    prefs,
    palette,
    likedTracks,
    playlists,
    downloads,
    history,
    createPlaylist,
    openImport,
    importLocalFiles,
    openCollection,
    setIsRecapOpen,
  } = useMochy();

  const [tab, setTab] = useState<LibFilter>('playlists');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [plName, setPlName] = useState('');
  const [plDesc, setPlDesc] = useState('');

  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);
  const offlineList = Object.values(downloads);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.pageTitle, { fontFamily }]}>{t(prefs.language, 'library')}</Text>
        <View style={styles.headerRight}>
          <Pressable
            onPress={() => importLocalFiles()}
            style={styles.actionPill}
            accessibilityLabel={vi ? 'Nhập tệp từ ứng dụng Tệp' : 'Import from Files'}
          >
            <Ionicons name="folder-open-outline" size={16} color="#FFFFFF" />
          </Pressable>
          <Pressable onPress={() => openImport('link')} style={styles.actionPill}>
            <Ionicons name="cloud-upload-outline" size={16} color="#FFFFFF" />
            <Text style={styles.actionPillText}>{vi ? 'Nhập' : 'Import'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowCreateModal(true)}
            style={[styles.actionPill, { backgroundColor: palette.accent }]}
          >
            <Ionicons name="add" size={18} color={palette.onAccent} />
            <Text style={[styles.actionPillText, { color: palette.onAccent }]}>
              {vi ? 'Tạo mới' : 'New'}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Top Shelf Cards */}
      <View style={styles.shelfRow}>
        <Pressable
          onPress={() => openCollection({ kind: 'liked' })}
          style={[styles.shelfCard, { backgroundColor: 'rgba(255, 77, 121, 0.14)' }]}
        >
          <Ionicons name="heart" size={22} color={MOCHY_COLORS.roseLike} />
          <Text style={styles.shelfCount}>{likedTracks.length}</Text>
          <Text numberOfLines={1} style={styles.shelfLabel}>
            {vi ? 'Đã thích' : 'Liked'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => openCollection({ kind: 'offline' })}
          style={[styles.shelfCard, { backgroundColor: 'rgba(52, 211, 153, 0.14)' }]}
        >
          <Ionicons name="arrow-down-circle" size={22} color={MOCHY_COLORS.flacEmerald} />
          <Text style={styles.shelfCount}>{offlineList.length}</Text>
          <Text numberOfLines={1} style={styles.shelfLabel}>
            Offline
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setIsRecapOpen(true)}
          style={[styles.shelfCard, { backgroundColor: palette.container }]}
        >
          <Ionicons name="sparkles" size={22} color={palette.accent} />
          <Text style={styles.shelfCount}>{history.length}</Text>
          <Text numberOfLines={1} style={styles.shelfLabel}>
            Recap ID
          </Text>
        </Pressable>
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabsRow}>
        {(
          [
            { id: 'playlists', label: t(prefs.language, 'playlists') },
            { id: 'liked', label: t(prefs.language, 'likedSongs') },
            { id: 'offline', label: 'Offline' },
            { id: 'history', label: t(prefs.language, 'history') },
          ] as { id: LibFilter; label: string }[]
        ).map((item) => {
          const active = tab === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => setTab(item.id)}
              style={[
                styles.tabChip,
                active && {
                  backgroundColor: palette.accent,
                  borderColor: palette.accent,
                },
              ]}
            >
              <Text style={[styles.tabChipText, { color: active ? palette.onAccent : '#E4E4EC' }]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {tab === 'playlists' && (
          <View style={styles.playlistList}>
            {playlists.map((pl) => (
              <Pressable
                key={pl.id}
                onPress={() => openCollection({ kind: 'playlist', playlistId: pl.id })}
                style={styles.playlistCard}
              >
                {pl.coverUrl || pl.tracks[0]?.artworkUrl ? (
                  <ArtworkImage
                    source={{ uri: pl.coverUrl || pl.tracks[0]?.artworkUrl }}
                    style={styles.plCover}
                  />
                ) : (
                  <View
                    style={[
                      styles.plCover,
                      styles.plCoverFallback,
                      { backgroundColor: pl.coverTint || palette.container },
                    ]}
                  >
                    <Ionicons name="musical-notes" size={26} color="#FFFFFF" />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={[styles.plName, { fontFamily }]}>
                    {pl.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.plSub}>
                    {pl.tracks.length} {vi ? 'bài hát' : 'songs'}
                    {pl.description ? ` · ${pl.description}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={MOCHY_COLORS.textMuted} />
              </Pressable>
            ))}
          </View>
        )}

        {tab === 'liked' && (
          <>
            {likedTracks.length === 0 ? (
              <Text style={styles.emptyNote}>{t(prefs.language, 'emptyLiked')}</Text>
            ) : (
              likedTracks.map((song) => (
                <TrackRow key={song.id} track={song} queueContext={likedTracks} />
              ))
            )}
          </>
        )}

        {tab === 'offline' && (
          <>
            {offlineList.length === 0 ? (
              <Text style={styles.emptyNote}>{t(prefs.language, 'emptyOffline')}</Text>
            ) : (
              offlineList.map((item) => (
                <TrackRow
                  key={item.track.id}
                  track={item.track}
                  queueContext={offlineList.map((d) => d.track)}
                />
              ))
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            {history.length === 0 ? (
              <Text style={styles.emptyNote}>
                {vi
                  ? 'Lịch sử nghe sẽ tự động xuất hiện tại đây.'
                  : 'Recently played songs appear here.'}
              </Text>
            ) : (
              history.map((ev) => (
                <TrackRow key={ev.id} track={ev.track} queueContext={history.map((h) => h.track)} />
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Create Playlist Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowCreateModal(false)}>
          <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation?.()}>
            <Text style={styles.modalTitle}>{t(prefs.language, 'createPlaylist')}</Text>
            <TextInput
              value={plName}
              onChangeText={setPlName}
              placeholder={vi ? 'Tên danh sách phát…' : 'Playlist title…'}
              placeholderTextColor={MOCHY_COLORS.textMuted}
              style={styles.modalInput}
            />
            <TextInput
              value={plDesc}
              onChangeText={setPlDesc}
              placeholder={vi ? 'Mô tả ngắn (tuỳ chọn)…' : 'Optional description…'}
              placeholderTextColor={MOCHY_COLORS.textMuted}
              style={styles.modalInput}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setShowCreateModal(false)} style={styles.cancelModalBtn}>
                <Text style={{ color: '#FFF', fontWeight: '600' }}>{vi ? 'Huỷ' : 'Cancel'}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!plName.trim()) return;
                  createPlaylist(plName, plDesc);
                  setPlName('');
                  setPlDesc('');
                  setShowCreateModal(false);
                }}
                style={[styles.confirmModalBtn, { backgroundColor: palette.accent }]}
              >
                <Text style={{ color: palette.onAccent, fontWeight: '800' }}>
                  {vi ? 'Tạo ngay' : 'Create'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
  },
  pageTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
  },
  headerRight: {
    flexDirection: 'row',
    gap: 8,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  actionPillText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  shelfRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  shelfCard: {
    flex: 1,
    borderRadius: 18,
    padding: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  shelfCount: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '800',
    marginTop: 6,
  },
  shelfLabel: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  tabChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  tabChipText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  scrollContent: {
    paddingBottom: 175,
  },
  playlistList: {
    paddingHorizontal: 14,
    gap: 10,
  },
  playlistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 11,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    gap: 13,
  },
  plCover: {
    width: 58,
    height: 58,
    borderRadius: 14,
  },
  plCoverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  plName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  plSub: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 12.5,
    marginTop: 3,
  },
  emptyNote: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 36,
    paddingVertical: 44,
    lineHeight: 21,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalBox: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#16161F',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  modalSub: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 12,
  },
  modalInput: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#FFFFFF',
    fontSize: 14,
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 6,
  },
  cancelModalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  confirmModalBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
});
