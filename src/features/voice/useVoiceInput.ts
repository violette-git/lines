// Voice input via expo-speech-recognition, loaded lazily so a build without the native module
// (Expo Go, unsupported browser) simply reports `available: false` instead of crashing.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ExpoSpeechRecognitionModule as SpeechModuleValue } from 'expo-speech-recognition';

type SpeechModule = typeof SpeechModuleValue;

let cached: SpeechModule | null | undefined;

function loadSpeech(): SpeechModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition') as { ExpoSpeechRecognitionModule?: SpeechModule };
    const m = mod.ExpoSpeechRecognitionModule ?? null;
    cached = m && typeof m.isRecognitionAvailable === 'function' && m.isRecognitionAvailable() ? m : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function isVoiceAvailable(): boolean {
  return loadSpeech() != null;
}

const CONTEXT_WORDS = [
  'pole', 'handhole', 'vault', 'pedestal', 'splice case', 'riser', 'anchor', 'down guy',
  'building entry', 'transformer', 'streetlight', 'aerial', 'underground', 'fiber', 'strand',
];

/** Only one hook instance owns the recognizer at a time (label mic vs notes mic). */
let ownerToken = 0;

const FRIENDLY_ERRORS: Partial<Record<string, string>> = {
  'no-speech': "Didn't catch that. Try again.",
  'speech-timeout': "Didn't catch that. Try again.",
  'not-allowed': 'Microphone or speech permission is off.',
  'service-not-allowed': 'Speech recognition is turned off on this device.',
  network: 'Voice needs a connection on this device. Type instead.',
  'language-not-supported': 'Voice is not available for this language.',
  busy: 'Voice is busy. Try again in a moment.',
};

export interface VoiceInput {
  available: boolean;
  listening: boolean;
  interim: string;
  error: string | null;
  start(): Promise<void>;
  stop(): void;
}

export function useVoiceInput(onFinal: (text: string) => void): VoiceInput {
  const speech = loadSpeech();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const myToken = useRef(0);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const gotFinal = useRef(false);

  useEffect(() => {
    if (!speech) return;
    const mine = () => myToken.current !== 0 && myToken.current === ownerToken;
    const subs = [
      speech.addListener('result', (ev) => {
        if (!mine()) return;
        const text = ev?.results?.[0]?.transcript ?? '';
        if (ev?.isFinal) {
          gotFinal.current = true;
          setInterim('');
          if (text.trim()) onFinalRef.current(text.trim());
        } else {
          setInterim(text);
        }
      }),
      speech.addListener('error', (ev) => {
        if (!mine()) return;
        if (ev?.error !== 'aborted') setError(FRIENDLY_ERRORS[ev?.error ?? ''] ?? ev?.message ?? 'Voice input failed.');
        setListening(false);
      }),
      speech.addListener('end', () => {
        if (!mine()) return;
        setListening(false);
        myToken.current = 0;
        // Some engines end without a final event; commit what we heard.
        setInterim((last) => {
          if (!gotFinal.current && last.trim()) onFinalRef.current(last.trim());
          return '';
        });
      }),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      if (mine()) {
        try {
          speech.abort();
        } catch {
          // ignore
        }
      }
    };
  }, [speech]);

  const start = useCallback(async () => {
    if (!speech) return;
    setError(null);
    try {
      const perm = await speech.requestPermissionsAsync();
      if (!perm.granted) {
        setError('Allow microphone and speech recognition to use voice.');
        return;
      }
      ownerToken += 1;
      myToken.current = ownerToken;
      gotFinal.current = false;
      setInterim('');
      setListening(true);
      speech.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        contextualStrings: CONTEXT_WORDS,
        addsPunctuation: false,
      });
    } catch (e) {
      setListening(false);
      setError(e instanceof Error ? e.message : 'Voice input failed.');
    }
  }, [speech]);

  const stop = useCallback(() => {
    if (!speech) return;
    try {
      speech.stop();
    } catch {
      setListening(false);
    }
  }, [speech]);

  return { available: speech != null, listening, interim, error, start, stop };
}
