// Mount once (in the root layout). Starts the sync engine while a user is signed in and a company
// is active (setSyncActiveOrg), stops it otherwise, and feeds it app-state, connectivity and
// local-edit triggers. Renders nothing.
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { getSupabase } from '@/backend/supabase';
import { getRepository } from '@/data';
import { setRemotePhotoResolver, useStore } from '@/state/store';

import { SyncEngine, type NetworkState } from './engine';
import { resolvePhotoUri } from './photoCache';
import { readPhotoBytes } from './photoFiles';
import { INITIAL_SYNC_STATUS, setCurrentSyncEngine, setSyncActiveOrg, useSyncStatus } from './status';
import { createSupabaseTransport } from './supabaseTransport';

setRemotePhotoResolver((p) => resolvePhotoUri(p));

export function toNetworkState(s: Pick<NetInfoState, 'isConnected' | 'isInternetReachable' | 'type'>): NetworkState {
  const online = s.isConnected !== false && s.isInternetReachable !== false;
  const type = String(s.type);
  const unmetered =
    type === 'wifi' ||
    type === 'ethernet' ||
    // Browsers rarely report the link type; a desktop browser is not on a phone plan.
    (Platform.OS === 'web' && type !== 'cellular');
  return { online, wifi: online && unmetered };
}

export function SyncManager(): null {
  const orgId = useSyncStatus((s) => s.activeOrgId);
  const role = useSyncStatus((s) => s.role);
  const ready = useStore((s) => s.ready);
  const [userId, setUserId] = useState<string | null>(null);

  // Session: read the stored one, then follow sign-in / sign-out.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    void sb.auth.getSession().then(({ data }) => {
      if (alive) setUserId(data.session?.user.id ?? null);
    });
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      setUserId(session?.user.id ?? null);
      if (event === 'SIGNED_OUT') void setSyncActiveOrg(null);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    useSyncStatus.setState({ signedIn: !!userId });
    const sb = getSupabase();
    if (!sb || !userId || !orgId || !ready) {
      useSyncStatus.setState({ ...INITIAL_SYNC_STATUS, activeOrgId: orgId, role, signedIn: !!userId });
      return;
    }
    const repo = getRepository();
    const engine = new SyncEngine({
      orgId,
      repo,
      transport: createSupabaseTransport(sb, readPhotoBytes),
      getNetwork: async () => toNetworkState(await NetInfo.fetch()),
      getSettings: () => useStore.getState().settings,
      canPush: role !== 'viewer',
      onStatus: (s) => useSyncStatus.setState(s),
      onRemoteChange: (c) => void useStore.getState().applyRemoteChanges(c),
    });
    setCurrentSyncEngine(engine);
    useSyncStatus.setState({ ...engine.getStatus() });
    const offRepo = repo.onLocalChange(() => engine.notifyLocalChange());
    const offNet = NetInfo.addEventListener((s) => engine.setNetwork(toNetworkState(s)));
    const appSub = AppState.addEventListener('change', (s) => engine.setForeground(s === 'active'));
    void engine.start();
    return () => {
      engine.stop();
      offRepo();
      offNet();
      appSub.remove();
      setCurrentSyncEngine(null);
    };
  }, [userId, orgId, role, ready]);

  return null;
}
