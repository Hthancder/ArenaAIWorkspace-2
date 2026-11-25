/**
 * Mochy Music — iOS Port (Expo / React Native + TypeScript)
 * Started life as an iOS port of Mochy Music by realidkroo (https://github.com/realidkroo/Mochy-Music)
 * Licensed under GNU General Public License v3.0 (GPL-3.0) — Free & Open Source Forever.
 */

import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from './src/components/GlassSurface';
import { MiniPlayer } from './src/components/MiniPlayer';
import { MochyMarkIcon } from './src/components/MochyIcons';
import { FullPlayerModal } from './src/components/player/FullPlayerModal';
import { AudioLabModal } from './src/components/screens/AudioLabModal';
import { CollectionModal } from './src/components/screens/CollectionScreen';
import { HomeScreen } from './src/components/screens/HomeScreen';
import { LibraryScreen } from './src/components/screens/LibraryScreen';
import { RecapModal } from './src/components/screens/RecapModal';
import { SearchScreen } from './src/components/screens/SearchScreen';
import { SettingsScreen } from './src/components/screens/SettingsScreen';
import { TrackActionSheet } from './src/components/TrackActionSheet';
import { t } from './src/constants/i18n';
import { MainTab } from './src/constants/preferences';
import { MOCHY_COLORS, resolveFontFamily } from './src/constants/theme';
import { MochyProvider, useMochy } from './src/context/MochyContext';

const MochyShell: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { activeTab, setActiveTab, prefs, palette, toastMessage, haptic } = useMochy();
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  const bg = prefs.pureBlack ? MOCHY_COLORS.pureBlack : MOCHY_COLORS.obsidian;

  const tabs: {
    id: MainTab;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    iconActive: keyof typeof Ionicons.glyphMap;
    isMochyMark?: boolean;
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
      isMochyMark: true,
    },
  ];

  return (
    <View style={[styles.outerFrame, { backgroundColor: bg }]}>
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
        <View style={{ flex: 1 }}>
          {activeTab === 'home' && <HomeScreen />}
          {activeTab === 'search' && <SearchScreen />}
          {activeTab === 'library' && <LibraryScreen />}
          {activeTab === 'settings' && <SettingsScreen />}
        </View>

        {/* Floating Dock: MiniPlayer + iOS Translucent Bottom Tab Bar */}
        <View
          style={[
            styles.bottomDock,
            { paddingBottom: Math.max(insets.bottom, 10) },
          ]}
        >
          <MiniPlayer />

          <GlassSurface
            intensity={65}
            tintColor="rgba(14, 14, 20, 0.84)"
            style={styles.tabBar}
          >
            {tabs.map((tab) => {
              const selected = activeTab === tab.id;
              const tint = selected ? palette.accent : MOCHY_COLORS.textMuted;
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => {
                    haptic('selection');
                    setActiveTab(tab.id);
                  }}
                  style={styles.tabItem}
                >
                  {tab.isMochyMark ? (
                    <MochyMarkIcon size={23} color={tint} filled={selected} />
                  ) : (
                    <Ionicons
                      name={selected ? tab.iconActive : tab.icon}
                      size={22}
                      color={tint}
                    />
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
        {toastMessage && (
          <View style={[styles.toastWrap, { top: Math.max(insets.top + 12, 22) }]}>
            <GlassSurface
              intensity={75}
              tintColor="rgba(22, 22, 32, 0.92)"
              style={[styles.toastPill, { borderColor: palette.accent + '44' }]}
            >
              <Text style={styles.toastText}>{toastMessage}</Text>
            </GlassSurface>
          </View>
        )}

        {/* Modals & Sheets */}
        <FullPlayerModal />
        <CollectionModal />
        <AudioLabModal />
        <RecapModal />
        <TrackActionSheet />
      </View>
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <MochyProvider>
        <MochyShell />
      </MochyProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
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
  toastWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
    pointerEvents: 'none',
    zIndex: 999,
  },
  toastPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 99,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
