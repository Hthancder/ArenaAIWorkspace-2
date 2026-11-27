// The song menu as a native iOS menu (touch and hold a row, or its "…" button) — the everyday
// actions with SF Symbols, sections and an "Add to Playlist" submenu, like Music. The rarer ones
// (block, save to Files …) stay in the full in-app sheet behind "More Options…".

import { useCallback } from 'react';
import { useHolySic } from '../../context/HolySicContext';
import { isLocalTrack, LocalLibrary, localDirOf } from '../../services/local/localLibrary';
import { Track } from '../../types/music';
import { openSongEditor } from '../local/SongInfoEditor';
import { sheetIntent } from '../TrackActionSheet';
import type { MenuItem } from '../ui/NativeMenu';

/** wait for the menu to finish dismissing before presenting something else (iOS ignores a
 *  presentation while another one is animating) */
const AFTER_MENU = 380;

export function useTrackMenu() {
  const {
    prefs,
    isLiked,
    playlists,
    downloads,
    addToQueue,
    toggleLike,
    addTrackToPlaylist,
    downloadTrack,
    removeDownload,
    openCollection,
    setIsPlayerOpen,
    setActionTrack,
    shareTrack,
    startInstantMix,
    showToast,
  } = useHolySic();
  const vi = prefs.language === 'vi';

  const itemsFor = useCallback(
    (track: Track): MenuItem[] => {
      const liked = isLiked(track.id);
      const offline = Boolean(downloads[track.id]);
      const local = isLocalTrack(track);
      const userLists = playlists.filter((p) => !p.isSystem).slice(0, 15);
      const items: MenuItem[] = [
        // the everyday three as one row of icon buttons on top (like Music) — short labels
        {
          id: 'next',
          title: vi ? 'Kế tiếp' : 'Play Next',
          icon: 'text.insert',
          section: 0,
          row: true,
        },
        {
          id: 'queue',
          title: vi ? 'Cuối hàng' : 'Play Last',
          icon: 'text.append',
          section: 0,
          row: true,
        },
        {
          id: 'like',
          title: liked ? (vi ? 'Bỏ thích' : 'Unlike') : vi ? 'Thích' : 'Love',
          icon: liked ? 'heart.fill' : 'heart',
          section: 0,
          row: true,
        },
        {
          id: 'playlist',
          title: vi ? 'Thêm vào playlist' : 'Add to Playlist',
          icon: 'text.badge.plus',
          section: 1,
          children: [
            { id: 'pl-new', title: vi ? 'Playlist mới…' : 'New Playlist…', icon: 'plus' },
            ...userLists.map((p) => ({
              id: `pl:${p.id}`,
              title: p.name,
              icon: 'music.note.list',
              checked: p.trackIds.includes(track.id),
            })),
          ],
        },
      ];
      if (local) {
        items.push(
          {
            id: 'edit',
            title: vi ? 'Sửa thông tin & ảnh bìa' : 'Edit Info & Cover',
            icon: 'pencil',
            section: 1,
          },
          {
            id: 'folder',
            title: vi ? 'Hiện trong thư mục' : 'Show in Folder',
            subtitle: localDirOf(track) || 'HolySic',
            icon: 'folder',
            section: 1,
          }
        );
      } else {
        items.push(
          offline
            ? {
                id: 'undownload',
                title: vi ? 'Xoá bản tải' : 'Remove Download',
                icon: 'trash',
                destructive: true,
                section: 1,
              }
            : {
                id: 'download',
                title: vi ? 'Tải về' : 'Download',
                icon: 'arrow.down.circle',
                section: 1,
              }
        );
      }
      items.push({
        id: 'artist',
        title: vi ? 'Xem nghệ sĩ' : 'Go to Artist',
        subtitle: track.artist,
        icon: 'music.mic',
        section: 2,
      });
      if (track.albumId) {
        items.push({
          id: 'album',
          title: vi ? 'Xem album' : 'Go to Album',
          subtitle: track.album || undefined,
          icon: 'square.stack',
          section: 2,
        });
      }
      items.push(
        {
          id: 'radio',
          title: vi ? 'Radio từ bài này' : 'Start Station',
          icon: 'dot.radiowaves.left.and.right',
          section: 2,
        },
        {
          id: 'share',
          title: vi ? 'Chia sẻ bài hát…' : 'Share Song…',
          icon: 'square.and.arrow.up',
          section: 2,
        },
        {
          id: 'more',
          title: vi ? 'Tuỳ chọn khác…' : 'More Options…',
          icon: 'ellipsis.circle',
          section: 3,
        }
      );
      return items;
    },
    [isLiked, downloads, playlists, vi]
  );

  const select = useCallback(
    (track: Track, id: string) => {
      const later = (fn: () => void) => setTimeout(fn, AFTER_MENU);
      if (id.startsWith('pl:')) {
        const plId = id.slice(3);
        const pl = playlists.find((p) => p.id === plId);
        if (pl?.trackIds.includes(track.id)) {
          showToast(vi ? `Đã có trong “${pl.name}”` : `Already in “${pl.name}”`);
          return;
        }
        addTrackToPlaylist(plId, track);
        return;
      }
      switch (id) {
        case 'next':
          addToQueue(track, true);
          break;
        case 'queue':
          addToQueue(track, false);
          break;
        case 'like':
          toggleLike(track);
          break;
        case 'pl-new':
          later(() => {
            sheetIntent.pickPlaylist = true;
            setActionTrack(track);
          });
          break;
        case 'download':
          downloadTrack(track);
          break;
        case 'undownload':
          removeDownload(track.id);
          break;
        case 'edit':
          later(() => openSongEditor(track));
          break;
        case 'folder': {
          const dir = localDirOf(track);
          setIsPlayerOpen(false);
          later(() => LocalLibrary.open(dir));
          break;
        }
        case 'artist':
          openCollection({
            kind: 'artist',
            id: track.artistId || track.artist,
            name: track.artist,
          });
          break;
        case 'album':
          if (track.albumId) openCollection({ kind: 'album', id: track.albumId });
          break;
        case 'radio':
          startInstantMix(`${track.artist} ${track.genre || ''}`.trim());
          break;
        case 'share':
          later(() => shareTrack(track));
          break;
        case 'more':
          later(() => setActionTrack(track));
          break;
      }
    },
    [
      playlists,
      vi,
      showToast,
      addTrackToPlaylist,
      addToQueue,
      toggleLike,
      setActionTrack,
      downloadTrack,
      removeDownload,
      setIsPlayerOpen,
      openCollection,
      startInstantMix,
      shareTrack,
    ]
  );

  return { itemsFor, select };
}
