// HolySic app icon skins. Same artwork and layout as the original icon (gradient field,
// calligraphic eighth note, tilted halo) — only the materials change. The native side compiles
// them as alternate icons named "AppIcon-<id>" (plugins/withAppIconSkins.js).

import type { ImageSourcePropType } from 'react-native';

export interface AppIconSkin {
  id: string;
  vi: string;
  en: string;
  /** 180² preview */
  preview: ImageSourcePropType;
}

export const APP_ICON_SKINS: AppIconSkin[] = [
  {
    id: 'default',
    vi: 'Hoàng kim',
    en: 'Royal gold',
    preview: require('../../assets/app-icons/preview/default.png'),
  },
  {
    id: 'midnight',
    vi: 'Bạch kim',
    en: 'Platinum',
    preview: require('../../assets/app-icons/preview/midnight.png'),
  },
  {
    id: 'rose',
    vi: 'Vàng hồng',
    en: 'Rose gold',
    preview: require('../../assets/app-icons/preview/rose.png'),
  },
  {
    id: 'emerald',
    vi: 'Lục bảo',
    en: 'Emerald',
    preview: require('../../assets/app-icons/preview/emerald.png'),
  },
  {
    id: 'ocean',
    vi: 'Ngọc trai',
    en: 'Pearl ocean',
    preview: require('../../assets/app-icons/preview/ocean.png'),
  },
  {
    id: 'ember',
    vi: 'Hoàng hôn',
    en: 'Sunset',
    preview: require('../../assets/app-icons/preview/ember.png'),
  },
  {
    id: 'ivory',
    vi: 'Ngà sáng',
    en: 'Ivory',
    preview: require('../../assets/app-icons/preview/ivory.png'),
  },
  {
    id: 'oled',
    vi: 'Đen OLED',
    en: 'OLED black',
    preview: require('../../assets/app-icons/preview/oled.png'),
  },
];

/** native alternate icon name for a skin id (null = the primary icon) */
export const nativeIconName = (id: string): string | null =>
  !id || id === 'default' ? null : `AppIcon-${id}`;

export const skinIdFromNative = (name: string | null | undefined): string =>
  name && name.startsWith('AppIcon-') ? name.slice('AppIcon-'.length) : 'default';

/** the in-app logo follows the chosen Home Screen icon */
export const skinPreview = (id?: string): ImageSourcePropType =>
  (APP_ICON_SKINS.find((s) => s.id === id) ?? APP_ICON_SKINS[0]).preview;
