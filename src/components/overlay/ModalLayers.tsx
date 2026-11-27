// Modal layers — why this exists: on iOS a React Native <Modal> is presented by the view
// controller it lives under. Two sibling modals at the app root can't both be on screen: while
// the full-screen player (a Modal) is up, a second root-level Modal (the ⋯ track menu, Audio Lab,
// an artist page) is silently refused by UIKit — "nothing happens" when you tap. The web preview
// stacks modals in the DOM, so it never shows the bug.
//
// Fix: every full-screen modal registers itself as a *layer* and renders a <SheetSlot/> inside its
// own tree. Shared sheets (track menu, artist/album page, Audio Lab) and the toast are rendered in
// the slot of the layer that was on top when they opened, so iOS presents them from the right
// view controller — on top of the player, the charts, an album page, etc.

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHolySic } from '../../context/HolySicContext';
import { GlassSurface } from '../GlassSurface';
import { AudioLabModal } from '../screens/AudioLabModal';
import { SongInfoEditor, useSongEditorTarget } from '../local/SongInfoEditor';
import { PlaylistEditor, usePlaylistEditorTarget } from '../library/PlaylistEditor';
import { LyricsEditor, useLyricsEditorTarget } from '../player/LyricsEditor';
import { CollectionModal } from '../screens/CollectionScreen';
import { TrackActionSheet } from '../TrackActionSheet';
import { T as UI, themedSheet } from '../../theme/ui';
import { ToastStore, useToastMessage } from '../../services/ui/toastStore';

export type LayerId =
  | 'root'
  | 'player'
  | 'collection'
  | 'audiolab'
  | 'charts'
  | 'radio'
  | 'import'
  | 'recap'
  | 'welcome';

type SheetId = 'collection' | 'audiolab' | 'action' | 'editor' | 'plEditor' | 'lyEditor';

let stack: LayerId[] = ['root'];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};
const snapshot = () => stack.join('>');

/** Register a full-screen modal as a layer while it is visible. */
export function useModalLayer(id: LayerId, visible: boolean): void {
  useEffect(() => {
    if (!visible) return;
    stack = [...stack.filter((x) => x !== id), id];
    emit();
    return () => {
      stack = stack.filter((x) => x !== id);
      emit();
    };
  }, [id, visible]);
}

/**
 * Gate for a root-level modal (the full player): only present once nothing else is presented
 * from the root and any dismiss animation has finished — otherwise UIKit refuses it and the
 * player never appears (e.g. "Song radio" from the ⋯ menu, "Play" in Import). Once shown it
 * stays up while other layers open on top of it.
 */
export function usePresentGate(want: boolean, self: LayerId): boolean {
  const order = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { actionTrack } = useHolySic();
  const blocked =
    order.split('>').some((l) => l !== 'root' && l !== self) ||
    (!!actionTrack && anchors.action.layer === 'root');
  const [clear, setClear] = useState(!blocked);
  useEffect(() => {
    if (blocked) {
      setClear(false);
      return;
    }
    const t = setTimeout(() => setClear(true), Platform.OS === 'ios' ? 600 : 0);
    return () => clearTimeout(t);
  }, [blocked]);
  const shown = useRef(false);
  if (!want) shown.current = false;
  else if (clear) shown.current = true;
  return want && shown.current;
}

function topExcluding(self?: LayerId): LayerId {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i] !== self) return stack[i];
  return 'root';
}

// Where each shared sheet is anchored: decided when it opens, kept until it opens again (so it can
// animate out where it was). If its layer disappears while it is open, it moves to the new top.
const anchors: Record<SheetId, { layer: LayerId; open: boolean }> = {
  collection: { layer: 'root', open: false },
  audiolab: { layer: 'root', open: false },
  action: { layer: 'root', open: false },
  editor: { layer: 'root', open: false },
  plEditor: { layer: 'root', open: false },
  lyEditor: { layer: 'root', open: false },
};
const OWN_LAYER: Record<SheetId, LayerId | undefined> = {
  collection: 'collection',
  audiolab: 'audiolab',
  action: undefined,
  editor: undefined,
  plEditor: undefined,
  lyEditor: undefined,
};

function anchorFor(sheet: SheetId, visible: boolean): LayerId {
  const a = anchors[sheet];
  if (visible && (!a.open || !stack.includes(a.layer))) {
    a.layer = topExcluding(OWN_LAYER[sheet]);
    a.open = true;
  } else if (!visible && a.open) {
    a.open = false;
  }
  return a.layer;
}

/** Shared sheets + toast for one layer. Put it as the LAST child inside each layer's Modal. */
export const SheetSlot: React.FC<{ layer: LayerId }> = ({ layer }) => {
  const order = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { collectionTarget, isAudioLabOpen, actionTrack } = useHolySic();
  const top = order.split('>').pop();
  const col = anchorFor('collection', !!collectionTarget) === layer && layer !== 'collection';
  const lab = anchorFor('audiolab', isAudioLabOpen) === layer && layer !== 'audiolab';
  const act = anchorFor('action', !!actionTrack) === layer;
  const editing = useSongEditorTarget();
  const ed = anchorFor('editor', !!editing) === layer;
  const plEditing = usePlaylistEditorTarget();
  const ple = anchorFor('plEditor', !!plEditing) === layer;
  const lyEditing = useLyricsEditorTarget();
  const lye = anchorFor('lyEditor', !!lyEditing) === layer;
  return (
    <>
      {col && <CollectionModal />}
      {lab && <AudioLabModal />}
      {act && <TrackActionSheet />}
      {ed && <SongInfoEditor />}
      {ple && <PlaylistEditor />}
      {lye && <LyricsEditor />}
      {top === layer && <ToastPill />}
    </>
  );
};

/** The app's toast, drawn in whichever layer is on top (it used to hide behind open modals).
 *  Drops in from the top with a spring and lifts away when it ends, like an iOS banner. */
const ToastPill: React.FC = () => {
  const { palette } = useHolySic();
  const toastMessage = useToastMessage();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState<string | null>(toastMessage);
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (toastMessage) {
      setShown(toastMessage);
      v.setValue(0);
      Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 9 }).start();
    } else {
      Animated.timing(v, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => finished && setShown(null));
    }
  }, [toastMessage, v]);
  if (!shown) return null;
  const bad = /lỗi|không thể|thất bại|error|fail|couldn|can.t/i.test(shown);
  return (
    <Animated.View
      pointerEvents={toastMessage ? 'box-none' : 'none'}
      accessibilityLiveRegion="polite"
      style={[
        styles.toastWrap,
        {
          top: Math.max(insets.top + 12, 22),
          opacity: v,
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-28, 0] }) },
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
          ],
        },
      ]}
    >
      {/* tap to dismiss early */}
      <Pressable onPress={ToastStore.hide} accessibilityRole="button" accessibilityLabel={shown}>
        <GlassSurface
          intensity={75}
          tintColor={UI.shade(22, 22, 32, 0.92)}
          style={[styles.toastPill, { borderColor: palette.accent + '44' }]}
        >
          <Ionicons
            name={bad ? 'alert-circle' : 'checkmark-circle'}
            size={16}
            color={bad ? '#FBBF24' : palette.accent}
          />
          <Text style={styles.toastText}>{shown}</Text>
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
};

const styles = themedSheet(() => ({
  toastWrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center', zIndex: 999 },
  toastPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 99,
    borderWidth: 1,
  },
  toastText: { color: UI.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
}));
