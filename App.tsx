/**
 * HolySic — iOS music player (Expo / React Native + TypeScript)
 * Started life as an iOS port of Mochy Music by realidkroo (https://github.com/realidkroo/Mochy-Music)
 * Licensed under GNU General Public License v3.0 (GPL-3.0) — Free & Open Source Forever.
 */

import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useSyncExternalStore } from 'react';
import { Appearance, Platform, Pressable, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from './src/components/GlassSurface';
import { MiniPlayer } from './src/components/MiniPlayer';
import { HolySicMarkIcon } from './src/components/HolySicIcons';
import { FullPlayerModal } from './src/components/player/FullPlayerModal';
import { HomeScreen } from './src/components/screens/HomeScreen';
import { LibraryScreen } from './src/components/screens/LibraryScreen';
import { RecapModal } from './src/components/screens/RecapModal';
import { SearchScreen } from './src/components/screens/SearchScreen';
import { SettingsScreen } from './src/components/screens/SettingsScreen';
import { ChartsModal } from './src/components/merge/ChartsModal';
import { RadioModal } from './src/components/merge/RadioModal';
import { HaloMark } from './src/components/brand/HaloGlow';
import { ImportModal } from './src/components/merge/ImportModal';
import { WelcomeModal } from './src/components/merge/WelcomeModal';
import { SheetSlot } from './src/components/overlay/ModalLayers';
import { LocalLibraryScreen, LocalOverlayHost } from './src/components/local/LocalLibraryScreen';
import { LocalLibrary } from './src/services/local/localLibrary';
import { t } from './src/constants/i18n';
import { MainTab } from './src/constants/preferences';
import { HOLYSIC_COLORS, resolveFontFamily } from './src/constants/theme';
import { HolySicProvider, useHolySic } from './src/context/HolySicContext';
import { useWidgetBridge } from './src/services/widget/useWidgetBridge';
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
    palette,
    toastMessage,
    haptic,
    isOnline,
    importSheet,
    closeImport,
    chartsSheet,
    closeCharts,
  } = useHolySic();
  const fontFamily = resolveFontFamily(prefs.fontStyle);
  // iOS home-screen / Lock Screen widget: publish now playing, handle its buttons
  useWidgetBridge();

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

  const tabs: {
    id: MainTab;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    iconActive: keyof typeof Ionicons.glyphMap;
    isBrandMark?: boolean;
  }[] = [
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
    <View key={scheme} style={[styles.outerFrame, { backgroundColor: bg }]}>
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
      {/* Centered responsive container on wide iPad/desktop web while full-bleed on iPhone */}
      <View
        style={[
          styles.appViewport,
          {
            backgroundColor: bg,
            paddingTop: Math.max(insets.top, Platform.OS === 'web' ? 10 : 0),
          },
        ]}
      >
        {/* Offline banner (OpenSpot Music) — downloads & Files imports still play */}
        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={15} color={UI.inv} />
            <Text style={styles.offlineText}>
              {prefs.language === 'vi'
                ? 'Đang ngoại tuyến · chỉ phát được bài đã tải & tệp trên máy'
                : 'Offline · only downloads & local files can play'}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          {activeTab === 'home' && <HomeScreen />}
          {activeTab === 'search' && <SearchScreen />}
          {activeTab === 'library' && <LibraryScreen />}
          {activeTab === 'settings' && <SettingsScreen />}
          {localOpen && <LocalLibraryScreen />}
        </View>

        {/* Floating Dock: MiniPlayer + iOS Translucent Bottom Tab Bar */}
        <View style={[styles.bottomDock, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <MiniPlayer />

          <GlassSurface intensity={65} tintColor={UI.shade(14, 14, 20, 0.84)} style={styles.tabBar}>
            {tabs.map((tab) => {
              const selected = activeTab === tab.id;
              const tint = selected ? palette.accent : UI.text3;
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => {
                    haptic('selection');
                    if (localOpen) LocalLibrary.close();
                    setActiveTab(tab.id);
                  }}
                  style={styles.tabItem}
                >
                  {selected && (
                    <View pointerEvents="none" style={styles.tabHalo}>
                      <HaloMark size={20} color={HOLYSIC_COLORS.halo} />
                    </View>
                  )}
                  {tab.isBrandMark ? (
                    <HolySicMarkIcon size={23} color={tint} filled={selected} />
                  ) : (
                    <Ionicons name={selected ? tab.iconActive : tab.icon} size={22} color={tint} />
                  )}
                  <Text
                    style={[
                      styles.tabLabel,
                      { color: tint, fontFamily },
                      selected && { fontWeight: '800' },
                    ]}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </GlassSurface>
        </View>

        {/* Non-intrusive Toast Pill */}
        {/* Local Files sheets / prompts (above the dock) */}
        <LocalOverlayHost />

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
      </View>
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <HolySicProvider>
        <HolySicShell />
      </HolySicProvider>
    </SafeAreaProvider>
  );
}

const styles = themedSheet(() => ({
  tabHalo: { position: 'absolute', top: 1, alignSelf: 'center' },
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
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: '#FBBF24',
  },
  offlineText: {
    color: UI.inv,
    fontWeight: '700',
    fontSize: 12.5,
  },
  bottomDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  tabBar: {
    marginHorizontal: 10,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 9,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabLabel: {
    fontSize: 10.5,
    fontWeight: '600',
  },
}));
