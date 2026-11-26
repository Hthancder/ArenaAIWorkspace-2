// Online / offline state for the offline banner (idea from OpenSpot Music's useConnectivity hook).

import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export function useConnectivity(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      // isInternetReachable is null while unknown — only treat an explicit false as offline
      setOnline(!(s.isConnected === false || s.isInternetReachable === false));
    });
    return () => unsub();
  }, []);
  return online;
}
