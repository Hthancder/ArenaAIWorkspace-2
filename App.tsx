/**
 * HolySic — iOS music player (Expo / React Native + TypeScript)
 * Started life as an iOS port of Mochy Music by realidkroo (https://github.com/realidkroo/Mochy-Music)
 * Licensed under GNU General Public License v3.0 (GPL-3.0) — Free & Open Source Forever.
 */

import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Animated,
  Appearance,
  Easing,
  Platform,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from './src/components/OfflineBanner';
import { AppBackdrop } from './src/components/ambient/AppBackdrop';
import { MiniPlayer } from './src/components/MiniPlayer';
import { TabBar, TabDef } from './src/components/TabBar';
import { FullPlayerModal } from './src/components/player/FullPlayerModal';
import { MusicVideoHost } from './src/components/video/MusicVideoHost';
import { AppVideoAmbient } from './src/components/video/VideoSurfaces';
import { HomeScreen } from './src/components/screens/HomeScreen';
import { LibraryScreen } from './src/components/screens/LibraryScreen';
import { RecapModal } from './src/components/screens/RecapModal';
import { SearchScreen } from './src/components/screens/SearchScreen';
import { SettingsScreen } from './src/components/screens/SettingsScreen';
import { ChartsModal } from './src/components/merge/ChartsModal';
import { RadioModal } from './src/components/merge/RadioModal';
import { ImportModal } from './src/components/merge/ImportModal';
import { WelcomeModal } from './src/components/merge/WelcomeModal';
import { SheetSlot } from './src/components/overlay/ModalLayers';
import { LocalLibraryScreen, LocalOverlayHost } from './src/components/local/LocalLibraryScreen';
import { LocalLibrary } from './src/services/local/localLibrary';
import { t } from './src/constants/i18n';
import { MainTab } from './src/constants/preferences';
import { resolveFontFamily } from './src/constants/theme';
import { HolySicProvider, useHolySic } from './src/context/HolySicContext';
import { useWidgetBridge } from './src/services/widget/useWidgetBridge';

/** iOS home-screen widget: publish now playing, handle its buttons. Its own component so the
 *  position it follows never re-renders the app shell. */
const WidgetBridge: React.FC = () => {
  useWidgetBridge();
  return null;
};
import { useQuickActions } from './src/services/shortcuts/useQuickActions';
import { PlayerStack } from './src/services/ui/playerStack';
import {
  applyUiSchemeSilently,
  notifyUiScheme,
  resolveScheme,
  T as UI,
  themedSheet,
} from './src/theme/ui';

const HolySicShell: React.FC = () => {
  const insets = useSafeAreaInsets();
  const {
    activeTab,
    setActiveTab,
    prefs,
    isOnline,
    importSheet,
    closeImport,
    chartsSheet,
    closeCharts,
    isPlayerOpen,
  } = useHolySic();
  const fontFamily = resolveFontFamily(prefs.fontStyle);
  useQuickActions();

  // Appearance (Dark / Light / Auto). On iOS the choice is also applied to the native window, so
  // system sheets, keyboards and pickers match; Auto follows the system (and switches at sunset).
  const mode = prefs.themeMode || 'dark';
  useEffect(() => {
    if (Platform.OS !== 'web') Appearance.setColorScheme?.(mode === 'auto' ? 'unspecified' : mode);
  }, [mode]);
  const system = useColorScheme();
  const scheme = resolveScheme(mode, system);
  applyUiSchemeSilently(scheme);
  useEffect(() => notifyUiScheme(), [scheme]);

  // Local Files page (Spotify-style): slides over the tabs, mini player + tab bar stay visible
  const localOpen = useSyncExternalStore(
    LocalLibrary.subscribe,
    () => LocalLibrary.getState().openAt !== null,
    () => false
  );
  useEffect(() => LocalLibrary.init(), []);

  const bg = prefs.pureBlack ? UI.surface('#000000') : UI.surface('#0A0A0E');

  // card stack: while the full player is up the app recedes behind it (scaled back, rounded),
  // following the player's drag. The transform only exists while the player is open / closing.
  const { height: winH } = useWindowDimensions();
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    if (isPlayerOpen) {
      setStacked(true);
      return;
    }
    const t = setTimeout(() => setStacked(false), 380);
    return () => clearTimeout(t);
  }, [isPlayerOpen]);
  const stackProgress = useRef(
    Animated.multiply(
      PlayerStack.open,
      PlayerStack.drag.interpolate({
        inputRange: [0, 900],
        outputRange: [1, 0],
        extrapolate: 'clamp',
      })
    )
  ).current;

  // tabs are mounted on first visit and then kept alive
  const [visited, setVisited] = useState<MainTab[]>([activeTab]);
  useEffect(() => {
    setVisited((v) => (v.includes(activeTab) ? v : [...v, activeTab]));
  }, [activeTab]);

  const tabs: TabDef<MainTab>[] = [
    {
      id: 'home',
      label: t(prefs.language, 'home'),
      icon: 'home-outline',
      iconActive: 'home',
    },
    {
      id: 'search',
      label: t(prefs.language, 'search'),
      icon: 'search-outline',
      iconActive: 'search',
    },
    {
      id: 'library',
      label: t(prefs.language, 'library'),
      icon: 'library-outline',
      iconActive: 'library',
    },
    {
      id: 'settings',
      label: t(prefs.language, 'settings'),
      icon: 'sparkles-outline',
      iconActive: 'sparkles',
      isBrandMark: true,
    },
  ];

  return (
    // keyed by scheme: the UI re-mounts with the new colours (playback & app state live above it)
    <View key={scheme} style={[styles.outerFrame, { backgroundColor: stacked ? '#000000' : bg }]}>
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
      {/* Centered responsive container on wide iPad/desktop web while full-bleed on iPhone */}
      <Animated.View
        style={[
          styles.appViewport,
          {
            backgroundColor: bg,
            paddingTop: Math.max(insets.top, Platform.OS === 'web' ? 10 : 0),
          },
          stacked && {
            borderRadius: 14,
            overflow: 'hidden',
            transform: [
              {
                scale: stackProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, winH > 700 ? 0.93 : 0.95],
                }),
              },
            ],
          },
        ]}
      >
        {/* Settings › Background & effects: one layer under every tab */}
        <AppBackdrop />
        {prefs.musicVideo && prefs.videoAmbientApp && (
          <AppVideoAmbient
            hidden={isPlayerOpen}
            level={prefs.videoAmbientLevel * (scheme === 'light' ? 0.45 : 0.6)}
            light={scheme === 'light'}
          />
        )}
        <View style={{ flex: 1 }}>
          {/* tabs stay alive once visited (scroll position, search text, open filters survive a
              tab switch, like a native UITabBarController); the shown one fades in */}
          {TAB_IDS.map((id) =>
            visited.includes(id) ? (
              <TabPane key={id} active={activeTab === id}>
                {id === 'home' ? (
                  <HomeScreen />
                ) : id === 'search' ? (
                  <SearchScreen />
                ) : id === 'library' ? (
                  <LibraryScreen />
                ) : (
                  <SettingsScreen />
                )}
              </TabPane>
            ) : null
          )}
          {localOpen && <LocalLibraryScreen />}
        </View>

        {/* Floating Dock: MiniPlayer + iOS Translucent Bottom Tab Bar */}
        <View style={[styles.bottomDock, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <MiniPlayer />

          <TabBar
            tabs={tabs}
            active={activeTab}
            fontFamily={fontFamily}
            onSelect={(id) => {
              if (localOpen) LocalLibrary.close();
              setActiveTab(id);
            }}
          />
        </View>

        {/* Connection pill (10 s when the network drops, 5 s on launch while offline) */}
        <OfflineBanner
          isOnline={isOnline}
          vi={prefs.language === 'vi'}
          enabled={prefs.offlinePill !== false}
        />
        {/* Non-intrusive Toast Pill */}
        {/* Local Files sheets / prompts (above the dock) */}
        <LocalOverlayHost />

        {/* one muted music-video player for the whole app (follows the audio) */}
        <MusicVideoHost />
        {/* Modals & Sheets */}
        <FullPlayerModal />
        <RecapModal />
        <ImportModal
          visible={!!importSheet}
          onClose={closeImport}
          initialMode={importSheet?.mode}
          initialText={importSheet?.text}
        />
        <RadioModal />
        <ChartsModal
          visible={!!chartsSheet}
          onClose={closeCharts}
          initialGenre={chartsSheet?.genre ?? null}
        />
        <WelcomeModal />
        {/* Shared sheets + toast for the root layer (see overlay/ModalLayers) */}
        <SheetSlot layer="root" />
      </Animated.View>
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <HolySicProvider>
        <HolySicShell />
        <WidgetBridge />
      </HolySicProvider>
    </SafeAreaProvider>
  );
}

const styles = themedSheet(() => ({
  outerFrame: {
    flex: 1,
    alignItems: 'center',
  },
  appViewport: {
    flex: 1,
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 520 : undefined,
    position: 'relative',
  },
  bottomDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
}));

const TAB_IDS: MainTab[] = ['home', 'search', 'library', 'settings'];

/** One tab's screen: kept mounted, hidden when inactive, fades + rises in when shown. The
 *  animated layer is dropped once settled, so the idle screen is a plain view (no lingering
 *  compositing layer over the blurred glass). */
const TabPane: React.FC<{ active: boolean; children: React.ReactNode }> = ({
  active,
  children,
}) => {
  const v = useRef(new Animated.Value(1)).current;
  const [moving, setMoving] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      // the first tab simply appears
      first.current = false;
      return;
    }
    if (!active) return;
    v.setValue(0);
    setMoving(true);
    Animated.timing(v, {
      toValue: 1,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setMoving(false));
  }, [active, v]);
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { display: active ? 'flex' : 'none' },
        moving && {
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
};
