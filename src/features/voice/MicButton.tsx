// Mic button with live interim transcript. Renders nothing when voice is unavailable.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { tapHaptic } from '@/features/common/haptics';
import { colors, font, radius, space } from '@/theme';

import { parseVoice, type ParsedVoice } from './parseVoice';
import { useVoiceInput } from './useVoiceInput';

export function MicButton({
  onResult,
  size = 44,
  label = 'Speak',
  showInterim = true,
}: {
  onResult: (text: string, parsed: ParsedVoice) => void;
  size?: number;
  label?: string;
  showInterim?: boolean;
}) {
  const voice = useVoiceInput((text) => onResult(text, parseVoice(text)));
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!voice.listening) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [voice.listening, pulse]);

  if (!voice.available) return null;

  const bubble = voice.listening ? voice.interim || 'Listening...' : voice.error;

  return (
    <View style={{ alignItems: 'center' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={voice.listening ? 'Stop listening' : label}
        onPress={() => {
          tapHaptic();
          if (voice.listening) voice.stop();
          else void voice.start();
        }}
        style={({ pressed }) => [
          styles.btn,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: voice.listening ? colors.danger : colors.surfaceRaised,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        {voice.listening ? (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: size / 2,
              borderWidth: 3,
              borderColor: colors.danger,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.9] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) }],
            },
          ]}
        />
        ) : null}
        <Ionicons name={voice.listening ? 'stop' : 'mic'} size={size * 0.46} color={colors.text} />
      </Pressable>
      {showInterim && bubble ? (
        <View style={[styles.bubble, voice.error && !voice.listening ? { borderColor: colors.warning } : null]}>
          <Text style={[font.caption, { color: colors.text }]} numberOfLines={2}>
            {bubble}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  bubble: {
    position: 'absolute',
    bottom: '100%',
    marginBottom: space.sm,
    right: 0,
    minWidth: 140,
    maxWidth: 260,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    zIndex: 50,
  },
});
