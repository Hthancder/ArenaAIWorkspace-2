// "About the artist" card — a short Wikipedia summary (Vietnamese first, then English),
// shown on artist pages. Text is CC BY-SA 4.0, so the card always links back to the article.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { ArtistBio, fetchArtistBio } from '../services/discovery/wikipedia';
import { SectionTitle } from './brand/HaloGlow';
import { T as UI, themedSheet } from '../theme/ui';
import { Tap } from './ui/Tap';

export const ArtistBioCard: React.FC<{
  name: string;
  language: string;
  accent: string;
  fontFamily?: string;
}> = ({ name, language, accent, fontFamily }) => {
  const [bio, setBio] = useState<ArtistBio | null>(null);
  const [expanded, setExpanded] = useState(false);
  const vi = language === 'vi';

  useEffect(() => {
    let cancelled = false;
    setBio(null);
    setExpanded(false);
    if (!name) return;
    fetchArtistBio(name, vi ? 'vi' : 'en')
      .then((b) => !cancelled && setBio(b))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [name, vi]);

  if (!bio || !bio.extract) return null;
  return (
    <View style={styles.wrap}>
      <SectionTitle fontFamily={fontFamily}>{vi ? 'Về nghệ sĩ' : 'About the artist'}</SectionTitle>
      <Tap onPress={() => setExpanded((v) => !v)} style={styles.card}>
        <Text numberOfLines={expanded ? undefined : 4} style={[styles.text, { fontFamily }]}>
          {bio.extract}
        </Text>
        <View style={styles.footer}>
          <Text style={[styles.more, { color: accent }]}>
            {expanded ? (vi ? 'Thu gọn' : 'Show less') : vi ? 'Xem thêm' : 'Read more'}
          </Text>
          <Tap
            feedback="opacity"
            hitSlop={8}
            onPress={() => Linking.openURL(bio.pageUrl).catch(() => undefined)}
            style={styles.source}
          >
            <Ionicons name="book-outline" size={13} color={UI.text3} />
            <Text style={styles.sourceText}>
              Wikipedia ({bio.lang.toUpperCase()}) · CC BY-SA 4.0
            </Text>
          </Tap>
        </View>
      </Tap>
    </View>
  );
};

const styles = themedSheet(() => ({
  wrap: { marginTop: 22, paddingHorizontal: 16, gap: 10 },
  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: UI.fg(0.055),
    borderWidth: 1,
    borderColor: 'rgba(252,211,77,0.16)',
  },
  text: { color: UI.text2, fontSize: 14, lineHeight: 21 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  more: { fontWeight: '800', fontSize: 13 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sourceText: { color: UI.text3, fontSize: 11 },
}));
