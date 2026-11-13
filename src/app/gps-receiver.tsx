// GPS receiver settings: where positions come from (phone location or an RTK receiver over Wi-Fi),
// receiver address, live status, antenna height, RTK requirement, and per-brand setup help.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PageScroll } from '@/components/Page';
import { Button, Card, Chip, Field, SectionTitle, Segmented, T, ToggleRow } from '@/components/ui';
import type { GeoFix } from '@/domain/types';
import { FixQualityChip } from '@/gps/FixQualityChip';
import {
  acquireReceiver,
  configFromSettings,
  isExternalTcpSupported,
  isInferredQuality,
  watchPosition,
  type PositionSourceKind,
  type SourceStatus,
} from '@/gps/positionSource';
import {
  displayHeightToMeters,
  fixQualityLabel,
  formatHeight,
  formatPreciseAccuracy,
  metersToDisplayHeight,
} from '@/gps/quality';
import { ENABLE_DEVELOPER_OPTIONS, HOST_PRESETS, RECEIVER_GUIDES, type ReceiverGuide } from '@/gps/receiverGuides';
import { UNSUPPORTED_MESSAGE, type ReceiverStatus } from '@/gps/tcpReceiver';
import { useStore } from '@/state/store';
import { colors, font, radius, space } from '@/theme';

const HOST_RE = /^[A-Za-z0-9.\-:]+$/;

export default function GpsReceiverScreen() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const units = settings.units;
  const source: PositionSourceKind = settings.gpsSource === 'external_tcp' ? 'external_tcp' : 'device';
  const tcpSupported = useMemo(() => isExternalTcpSupported(), []);

  const [host, setHost] = useState(settings.receiverHost ?? '');
  const [port, setPort] = useState(settings.receiverPort != null ? String(settings.receiverPort) : '');
  const [antenna, setAntenna] = useState(metersToDisplayHeight(settings.antennaHeightM, units));
  const [formError, setFormError] = useState<string | null>(null);
  const [presetHint, setPresetHint] = useState<string | null>(null);
  const [connectNonce, setConnectNonce] = useState(0);

  useEffect(() => {
    setAntenna(metersToDisplayHeight(settings.antennaHeightM, units));
  }, [settings.antennaHeightM, units]);

  const saveAddress = async (): Promise<boolean> => {
    const h = host.trim();
    const p = Number(port.trim());
    if (!h || !HOST_RE.test(h)) {
      setFormError('Enter the receiver IP address, for example 192.168.42.1.');
      return false;
    }
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      setFormError('Enter the port number (1 to 65535) set in the receiver app.');
      return false;
    }
    setFormError(null);
    await saveSettings({ receiverHost: h, receiverPort: p, gpsSource: 'external_tcp' });
    setConnectNonce((n) => n + 1);
    return true;
  };

  const saveAntenna = async () => {
    const m = displayHeightToMeters(antenna, units);
    if (m === undefined) {
      setFormError(`Antenna height must be a number between 0 and ${units === 'metric' ? '100 m' : '328 ft'}.`);
      return;
    }
    setFormError(null);
    await saveSettings({ antennaHeightM: m == null ? null : Math.round(m * 10000) / 10000 });
  };

  return (
    <PageScroll>
      <SectionTitle>Position source</SectionTitle>
      <Segmented<PositionSourceKind>
        value={source}
        onChange={(v) => void saveSettings({ gpsSource: v })}
        options={[
          { value: 'device', label: 'Phone location', icon: 'phone-portrait-outline' },
          { value: 'external_tcp', label: 'Receiver over Wi-Fi', icon: 'wifi' },
        ]}
      />
      <T v="caption" color={colors.textMuted} style={{ marginTop: space.sm }}>
        {source === 'device'
          ? 'Phone location includes receivers that feed your phone (Trimble Mobile Manager, Eos Tools Pro, Lefebure, Bad Elf, or an iOS-certified accessory).'
          : 'LineMap Pro reads NMEA straight from the receiver over the local Wi-Fi or its hotspot. Fix quality, satellites and accuracy come from the receiver.'}
      </T>

      {source === 'external_tcp' ? (
        <View style={{ gap: space.md, marginTop: space.md }}>
          {!tcpSupported ? (
            <Card style={{ borderColor: colors.warning }}>
              <T color={colors.warning}>{UNSUPPORTED_MESSAGE}</T>
            </Card>
          ) : null}
          <View style={styles.row}>
            {HOST_PRESETS.map((p) => (
              <Chip
                key={p.id}
                label={`${p.label} (${p.host})`}
                icon="radio-outline"
                selected={host.trim() === p.host}
                onPress={() => {
                  setHost(p.host);
                  if (p.port != null) setPort(String(p.port));
                  setPresetHint(p.hint);
                }}
              />
            ))}
          </View>
          <Field
            label="Receiver address"
            value={host}
            onChangeText={setHost}
            placeholder="192.168.42.1"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            hint="The receiver IP address on the Wi-Fi or hotspot your phone is joined to."
          />
          <Field
            label="Port"
            value={port}
            onChangeText={(t) => setPort(t.replace(/[^0-9]/g, ''))}
            placeholder="Port set in the receiver app"
            keyboardType="number-pad"
            hint={presetHint ?? 'The TCP server port you chose in the receiver app (Position streaming / NMEA output).'}
          />
          <Button title="Save and connect" icon="link" onPress={() => void saveAddress()} disabled={!tcpSupported} />
        </View>
      ) : null}

      {formError ? (
        <T v="caption" color={colors.danger} style={{ marginTop: space.sm }}>
          {formError}
        </T>
      ) : null}

      <SectionTitle>Live status</SectionTitle>
      {source === 'external_tcp' ? (
        <ExternalStatusPanel
          key={`${settings.receiverHost}:${settings.receiverPort}:${connectNonce}`}
          enabled={tcpSupported && !!settings.receiverHost && !!settings.receiverPort}
          reconnect={connectNonce > 0}
        />
      ) : (
        <DeviceStatusPanel />
      )}

      <SectionTitle>Antenna height</SectionTitle>
      <Field
        label={`Antenna height above the ground mark (${units === 'metric' ? 'm' : 'ft'})`}
        value={antenna}
        onChangeText={setAntenna}
        onBlur={() => void saveAntenna()}
        onSubmitEditing={() => void saveAntenna()}
        keyboardType="decimal-pad"
        placeholder={units === 'metric' ? '1.80' : '6.00'}
        hint="Used for Receiver over Wi-Fi: subtracted from the receiver altitude to give ground elevation. Leave blank if the receiver app already applies it (or uses tilt compensation). Receivers that feed the phone: set it in their own app."
      />

      <SectionTitle>Capture</SectionTitle>
      <ToggleRow
        label="Require RTK fixed"
        hint='Warn before a shot when the position is not RTK FIX. You can still tap "Shoot anyway".'
        value={!!settings.requireRtkFixed}
        onChange={(v) => void saveSettings({ requireRtkFixed: v })}
      />

      <SectionTitle>How to connect your receiver</SectionTitle>
      <T v="caption" color={colors.textMuted} style={{ marginBottom: space.sm }}>
        {ENABLE_DEVELOPER_OPTIONS}
      </T>
      <View style={{ gap: space.sm }}>
        {RECEIVER_GUIDES.map((g) => (
          <GuideCard key={g.id} guide={g} />
        ))}
      </View>
    </PageScroll>
  );
}

// ---------------------------------------------------------------------------------------------

function useTicker(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function ageText(at: number | null | undefined, now: number): string {
  if (at == null) return '--';
  const s = Math.max(0, (now - at) / 1000);
  return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
}

const STATE_TEXT: Record<ReceiverStatus['state'], { text: string; color: string }> = {
  idle: { text: 'Not connected', color: colors.textMuted },
  unsupported: { text: 'Not available in this build', color: colors.warning },
  connecting: { text: 'Connecting...', color: colors.info },
  connected: { text: 'Connected, waiting for NMEA...', color: colors.info },
  streaming: { text: 'Receiving', color: colors.success },
  stale: { text: 'No data (stale)', color: colors.danger },
  retrying: { text: 'Reconnecting', color: colors.warning },
};

function ExternalStatusPanel({ enabled, reconnect }: { enabled: boolean; reconnect: boolean }) {
  const units = useStore((s) => s.settings.units);
  const receiverHost = useStore((s) => s.settings.receiverHost);
  const receiverPort = useStore((s) => s.settings.receiverPort);
  const antennaHeightM = useStore((s) => s.settings.antennaHeightM);
  const cfg = useMemo(
    () => configFromSettings({ gpsSource: 'external_tcp', receiverHost, receiverPort, antennaHeightM }),
    [receiverHost, receiverPort, antennaHeightM],
  );
  const [st, setSt] = useState<ReceiverStatus | null>(null);
  const didReconnect = useRef(false);
  const now = useTicker(500);

  useEffect(() => {
    if (!enabled) return;
    const lease = acquireReceiver(cfg);
    if (!lease) return;
    const rx = lease.receiver;
    if (reconnect && !didReconnect.current) {
      didReconnect.current = true;
      rx.reconnectNow();
    }
    let last = 0;
    setSt(rx.getStatus());
    const off = rx.onStatus((s) => {
      const t = Date.now();
      if (t - last < 250 && s.state === 'streaming') return;
      last = t;
      setSt(s);
    });
    return () => {
      off();
      lease.release();
    };
  }, [enabled, reconnect, cfg]);

  if (!enabled || !st) {
    return (
      <Card>
        <T color={colors.textMuted}>{isExternalTcpSupported() ? 'Enter the receiver address and port, then tap Save and connect.' : UNSUPPORTED_MESSAGE}</T>
      </Card>
    );
  }
  const snap = st.snapshot;
  const stateInfo = STATE_TEXT[st.state];
  const retryIn = st.state === 'retrying' && st.nextRetryAt ? Math.max(0, Math.ceil((st.nextRetryAt - now) / 1000)) : null;
  const fix = st.lastFix;
  const sourceStatus: SourceStatus = st.state === 'stale' ? 'stale' : st.state === 'streaming' ? 'live' : 'unavailable';
  return (
    <Card style={{ gap: space.md }}>
      <View style={styles.row}>
        <Ionicons name={st.state === 'streaming' ? 'checkmark-circle' : 'alert-circle'} size={20} color={stateInfo.color} />
        <T v="heading" color={stateInfo.color}>
          {stateInfo.text}
          {retryIn != null ? ` in ${retryIn} s` : ''}
        </T>
        <T v="caption" color={colors.textMuted}>
          {st.host}:{st.port}
        </T>
      </View>
      <FixQualityChip fix={snap.fixQuality === 'none' ? null : fix} units={units} sourceStatus={sourceStatus} />
      <View style={styles.grid}>
        <Cell label="Fix quality" value={`${fixQualityLabel(snap.fixQuality)}${snap.qualityCode != null ? ` (${snap.qualityCode})` : ''}`} />
        <Cell
          label={`Accuracy${snap.accuracySource === 'gst' ? ' (receiver)' : snap.accuracySource === 'hdop' ? ' (estimated)' : ''}`}
          value={formatPreciseAccuracy(snap.accuracyM, units)}
        />
        <Cell label="Satellites" value={snap.satellites != null ? String(snap.satellites) : '--'} />
        <Cell label="HDOP" value={snap.hdop != null ? snap.hdop.toFixed(1) : '--'} />
        <Cell label="Fix age" value={ageText(st.lastFixAt, now)} />
        <Cell label="Corrections age" value={snap.diffAgeS != null ? `${snap.diffAgeS.toFixed(1)} s` : '--'} />
        <Cell label="Ground elevation" value={formatHeight(snap.groundAltitudeM, units)} />
        <Cell label="Ellipsoid height (antenna)" value={formatHeight(snap.ellipsoidHeightM, units)} />
      </View>
      {st.lastError && st.state !== 'streaming' ? (
        <T v="caption" color={colors.warning}>
          {st.lastError}
        </T>
      ) : null}
      <View style={{ gap: 2 }}>
        <T v="caption" color={colors.textMuted}>
          Last sentence ({st.sentences} received, {st.checksumErrors} bad checksums)
        </T>
        <T v="caption" style={[font.mono, styles.raw]} numberOfLines={2}>
          {st.lastSentence ?? '--'}
        </T>
      </View>
    </Card>
  );
}

function DeviceStatusPanel() {
  const units = useStore((s) => s.settings.units);
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [status, setStatus] = useState<SourceStatus>('starting');
  const [at, setAt] = useState<number | null>(null);
  const now = useTicker(500);

  useEffect(() => {
    let w: { remove(): void } | null = null;
    let cancelled = false;
    void watchPosition(
      {
        onFix: (f) => {
          setFix(f);
          setAt(Date.now());
        },
        onStatus: (s) => setStatus(s),
      },
      { precision: 'highest', cfg: { gpsSource: 'device', receiverHost: null, receiverPort: null, antennaHeightM: null } },
    ).then((h) => {
      if (cancelled) h.remove();
      else w = h;
    });
    return () => {
      cancelled = true;
      w?.remove();
    };
  }, []);

  return (
    <Card style={{ gap: space.md }}>
      {status === 'denied' ? (
        <T color={colors.danger}>Location permission is off. Allow location for LineMap Pro in system settings.</T>
      ) : null}
      <FixQualityChip fix={fix} units={units} />
      <View style={styles.grid}>
        <Cell label="Accuracy (reported)" value={formatPreciseAccuracy(fix?.accuracyM, units)} />
        <Cell label="Fix age" value={ageText(at, now)} />
        <Cell label="Source" value={fix?.receiver ?? (fix ? 'Phone GPS' : '--')} />
      </View>
      <T v="caption" color={colors.textMuted}>
        {isInferredQuality(fix)
          ? '* RTK status is estimated from the accuracy your phone reports. Check the receiver app for the true fix state.'
          : 'With a receiver feeding the phone, RTK shows here when the phone reports 50 cm or better. Phone GPS alone is usually 3 to 10 m.'}
      </T>
    </Card>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <T v="caption" color={colors.textMuted}>
        {label}
      </T>
      <T v="heading" style={font.mono}>
        {value}
      </T>
    </View>
  );
}

function GuideCard({ guide }: { guide: ReceiverGuide }) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ padding: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.guideHead, { opacity: pressed ? 0.8 : 1 }]}
      >
        <View style={{ flex: 1 }}>
          <T v="heading">{guide.title}</T>
          <T v="caption" color={colors.textMuted}>
            {guide.models}
          </T>
        </View>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={20} color={colors.textMuted} />
      </Pressable>
      {open ? (
        <View style={styles.guideBody}>
          {guide.steps.map((s) => (
            <View key={s.heading} style={{ gap: space.xs }}>
              <T v="label" color={colors.accent}>
                {s.heading}
              </T>
              {s.items.map((it, i) => (
                <View key={i} style={styles.step}>
                  <T v="caption" color={colors.textMuted} style={{ width: 18 }}>
                    {i + 1}.
                  </T>
                  <T style={{ flex: 1 }}>{it}</T>
                </View>
              ))}
            </View>
          ))}
          {guide.note ? (
            <T v="caption" color={colors.warning}>
              {guide.note}
            </T>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  cell: { width: '50%', gap: 2, paddingRight: space.sm },
  raw: { color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: space.sm },
  guideHead: { flexDirection: 'row', alignItems: 'center', padding: space.lg, gap: space.md, minHeight: 56 },
  guideBody: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
  step: { flexDirection: 'row', gap: space.xs },
});
