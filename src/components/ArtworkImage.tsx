// Robust artwork renderer for HolySic iOS
// - `data:image/svg+xml` covers: iOS UIImage cannot decode SVG, so they are drawn with react-native-svg
// - Protocol-relative / http URLs are normalised
// - Failed or missing images fall back to a deterministic gradient cover instead of an empty box

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, ImageProps, ImageStyle, StyleProp, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

const FALLBACK_GRADIENTS: [string, string][] = [
  ['#4F46E5', '#0F172A'],
  ['#DB2777', '#311042'],
  ['#D97706', '#451A03'],
  ['#0F766E', '#1E3A8A'],
  ['#7C3AED', '#1E1B4B'],
  ['#B91C1C', '#2A0A0A'],
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function normalizeArtworkUrl(raw?: string | null): string {
  if (!raw) return '';
  let url = String(raw).trim();
  if (url.startsWith('//')) url = `https:${url}`;
  // Upgrade known CDNs to https (ATS-friendly and avoids mixed content on the web preview)
  if (
    url.startsWith('http://') &&
    /(mzstatic|ytimg|googleusercontent|saavncdn|jiosaavn)/.test(url)
  ) {
    url = url.replace(/^http:\/\//, 'https://');
  }
  return url;
}

export function decodeSvgDataUri(uri: string): string | null {
  try {
    const comma = uri.indexOf(',');
    if (comma < 0) return null;
    const meta = uri.slice(0, comma);
    const payload = uri.slice(comma + 1);
    if (meta.includes(';base64')) {
      const g: any = globalThis as any;
      return typeof g.atob === 'function' ? g.atob(payload) : null;
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

export interface ArtworkImageProps extends Omit<ImageProps, 'source'> {
  source: { uri?: string | null } | undefined | null;
  /** Seed for the fallback gradient (defaults to the uri) */
  fallbackSeed?: string;
}

export const ArtworkImage: React.FC<ArtworkImageProps> = ({
  source,
  style,
  fallbackSeed,
  ...rest
}) => {
  const uri = normalizeArtworkUrl(source?.uri);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const isSvgData = uri.startsWith('data:image/svg+xml');
  const svgXml = useMemo(() => (isSvgData ? decodeSvgDataUri(uri) : null), [isSvgData, uri]);

  const flat = (StyleSheet.flatten(style) || {}) as ImageStyle;
  const containerStyle: StyleProp<any> = [
    style,
    { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  ];

  if (svgXml && !failed) {
    return (
      <View style={containerStyle}>
        <SvgXml
          xml={svgXml}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid slice"
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  if (!uri || failed || (isSvgData && !svgXml)) {
    const colors =
      FALLBACK_GRADIENTS[hashString(fallbackSeed || uri || 'holysic') % FALLBACK_GRADIENTS.length];
    const w = typeof flat.width === 'number' ? flat.width : 48;
    return (
      <View style={containerStyle}>
        <LinearGradient
          colors={colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Ionicons
          name="musical-notes"
          size={Math.max(14, Math.min(64, w * 0.38))}
          color="rgba(255,255,255,0.72)"
        />
      </View>
    );
  }

  return <Image {...rest} source={{ uri }} style={style} onError={() => setFailed(true)} />;
};
