// Online / offline state for the offline banner (idea from OpenSpot Music's useConnectivity hook).

import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/** True while the device has a usable connection (assumes online until told otherwise). */
export function useConnectivity(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      // isInternetReachable is null while unknown — only treat an explicit false as offline
      setOnline(!(s.isConnected === false || s.isInternetReachable === false));
    });
    // web: NetInfo only follows navigator.connection — the browser's own online/offline events
    // are the reliable signal there
    let off = () => {};
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const on = () => setOnline(true);
      const down = () => setOnline(false);
      window.addEventListener('online', on);
      window.addEventListener('offline', down);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) setOnline(false);
      off = () => {
        window.removeEventListener('online', on);
        window.removeEventListener('offline', down);
      };
    }
    return () => {
      unsub();
      off();
    };
  }, []);
  return online;
}
