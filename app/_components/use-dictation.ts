"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Speech-to-text in the browser, one final phrase at a time.
 *
 * The Messages API takes no audio block, so voice reaches the agent as text typed by the browser.
 * Chrome and Edge transcribe on their vendors' servers, Safari on Apple's; Firefox and Brave have
 * nothing that works, which is `supported: false` and no mic button — the keyboard still works.
 *
 * ponytail: final results only, so words land after each pause rather than streaming in. Showing
 * interim text means owning a snapshot of the draft while the person may also be typing into it.
 */

// lib.dom types the events but not the constructor, which Chrome and Safari still prefix.
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

const ctor = (): RecognitionCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const REASON: Record<string, string> = {
  "not-allowed": "Microphone access was blocked — allow it in the address bar.",
  "service-not-allowed": "Microphone access was blocked — allow it in the address bar.",
  "audio-capture": "No microphone was found.",
  network: "This browser could not reach its speech service.",
};

export function useDictation(onPhrase: (text: string) => void) {
  // Read after mount: the server has no window, and guessing there would mismatch hydration.
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const recognition = useRef<Recognition | null>(null);
  const phrase = useRef(onPhrase);
  phrase.current = onPhrase;

  useEffect(() => {
    setSupported(ctor() !== undefined);
    return () => recognition.current?.stop();
  }, []);

  const start = () => {
    const Ctor = ctor();
    if (!Ctor || recognition.current) return;
    const rec = new Ctor();
    // Always Spanish; a Spanish browser keeps its own region (es-MX, es-AR…), anything else gets Spain's.
    rec.lang = navigator.language.startsWith("es") ? navigator.language : "es-ES";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.trim();
        if (text) phrase.current(text);
      }
    };
    // "no-speech" and "aborted" are the person going quiet or pressing stop, not failures.
    rec.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(REASON[event.error] ?? `Dictation stopped: ${event.error}.`);
      }
    };
    rec.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    recognition.current = rec;
    setError(undefined);
    setListening(true);
    rec.start();
  };

  const stop = () => recognition.current?.stop();

  return { supported, listening, error, toggle: listening ? stop : start, stop };
}
