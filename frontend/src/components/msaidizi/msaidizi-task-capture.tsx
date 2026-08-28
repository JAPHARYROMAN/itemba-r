'use client';

import { useEffect, useRef, useState } from 'react';
import { uploadMsaidiziArtifact } from '@/lib/msaidizi-tasks-client';
import type { MsaidiziArtifact } from '@/lib/msaidizi-task-types';

const REASONING_ATTACHMENT_MIME_TYPES = new Set([
  'application/json',
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/markdown',
  'text/plain',
]);

const REASONING_ATTACHMENT_EXTENSIONS = new Set([
  '.csv',
  '.gif',
  '.jpeg',
  '.jpg',
  '.json',
  '.md',
  '.pdf',
  '.png',
  '.txt',
  '.webp',
]);

const REASONING_ATTACHMENT_ACCEPT = [
  ...REASONING_ATTACHMENT_MIME_TYPES,
  ...REASONING_ATTACHMENT_EXTENSIONS,
].join(',');

export function isSupportedMsaidiziReasoningAttachment(file: Pick<File, 'name' | 'type'>) {
  const mimeType = file.type.trim().toLowerCase();
  if (mimeType && REASONING_ATTACHMENT_MIME_TYPES.has(mimeType)) return true;
  const extensionIndex = file.name.lastIndexOf('.');
  const extension = extensionIndex >= 0 ? file.name.slice(extensionIndex).toLowerCase() : '';
  return REASONING_ATTACHMENT_EXTENSIONS.has(extension);
}

interface LocalSpeechRecognitionResultEvent extends Event {
  results: ArrayLike<{ 0: { transcript: string } }>;
}

interface LocalSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  onresult: ((event: LocalSpeechRecognitionResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type LocalSpeechRecognitionConstructor = new () => LocalSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: LocalSpeechRecognitionConstructor;
    webkitSpeechRecognition?: LocalSpeechRecognitionConstructor;
  }
}

export function MsaidiziLocalDictationButton({
  disabled,
  onTranscript,
}: {
  disabled?: boolean;
  onTranscript: (transcript: string) => void;
}) {
  const recognitionRef = useRef<LocalSpeechRecognition | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
    },
    [],
  );

  const start = () => {
    setError(null);
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setError('On-device speech recognition is not available in this browser.');
      return;
    }
    const recognition = new Recognition();
    if (!('processLocally' in recognition)) {
      setError('This browser cannot guarantee local-only speech recognition.');
      return;
    }
    recognition.processLocally = true;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) onTranscript(transcript);
    };
    recognition.onerror = () => setError('Local dictation could not be completed.');
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={disabled || listening}
        onClick={start}
        className="cursor-pointer rounded-lg px-3 py-1.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
        style={{ color: 'var(--aurora-accent-text)', background: 'var(--aurora-accent-subtle)' }}
      >
        {listening ? 'Listening locally…' : 'Dictate objective on this device'}
      </button>
      {error ? (
        <p role="alert" className="mt-1 text-[11px]" style={{ color: 'var(--aurora-danger-text)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function MsaidiziTaskCapture({
  taskId,
  spokenSummary,
  onUploaded,
}: {
  taskId: string;
  spokenSummary: string;
  onUploaded: (artifact: MsaidiziArtifact) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const upload = async (
    file: File,
    kind: 'FILE' | 'SCREENSHOT' | 'DOCUMENT',
    sourceType: 'USER' | 'SCREENSHOT',
  ) => {
    setError(null);
    setNotice(null);
    setBusy(kind.toLowerCase());
    try {
      const artifact = await uploadMsaidiziArtifact({
        taskId,
        file,
        kind,
        dataClass: 'internal',
        provenance: {
          sourceType,
          trustLevel: 'UNTRUSTED',
          capturedAt: new Date().toISOString(),
          transformations: sourceType === 'SCREENSHOT' ? ['browser-canvas-png'] : [],
        },
      });
      onUploaded(artifact);
      setNotice(`${file.name} was encrypted and attached as untrusted task data.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Attachment upload failed.');
    } finally {
      setBusy(null);
    }
  };

  const captureScreen = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen or window capture is not available in this browser.');
      return;
    }
    setBusy('screenshot');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context || canvas.width === 0 || canvas.height === 0) {
        throw new Error('The selected screen did not provide a video frame.');
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('Screenshot encoding failed.'))),
          'image/png',
        ),
      );
      await upload(
        new File([blob], `msaidizi-screen-${Date.now()}.png`, { type: 'image/png' }),
        'SCREENSHOT',
        'SCREENSHOT',
      );
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Screen capture failed.');
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setBusy(null);
    }
  };

  const speak = () => {
    setError(null);
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      setError('Speech playback is not available in this browser.');
      return;
    }
    const localVoice = window.speechSynthesis.getVoices().find((voice) => voice.localService);
    if (!localVoice) {
      setError('No local text-to-speech voice is available; cloud playback was not used.');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(spokenSummary);
    utterance.voice = localVoice;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  return (
    <section
      aria-label="Voice and visual task attachments"
      className="rounded-xl p-4"
      style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
    >
      <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
        Voice, screen and document context
      </h3>
      <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
        Attachments are encrypted, provenance-tagged and treated as untrusted data. Use the plan
        form&apos;s on-device dictation for voice input; this browser never uploads raw microphone
        audio. Capturing or attaching context never adds a plan step or authorizes an action.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label
          className="cursor-pointer rounded-lg px-3 py-2 text-[11px] font-medium"
          style={{ color: 'var(--aurora-accent-text)', background: 'var(--aurora-accent-subtle)' }}
        >
          Attach file or document
          <input
            type="file"
            accept={REASONING_ATTACHMENT_ACCEPT}
            className="sr-only"
            disabled={busy !== null}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (!isSupportedMsaidiziReasoningAttachment(file)) {
                setNotice(null);
                setError(
                  'This file type cannot be used as reasoning context. Attach PDF, JSON, CSV, Markdown, plain text, or a supported image.',
                );
                return;
              }
              void upload(file, file.type.startsWith('image/') ? 'FILE' : 'DOCUMENT', 'USER');
            }}
          />
        </label>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void captureScreen()}
          className="cursor-pointer rounded-lg px-3 py-2 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
          style={{ color: 'var(--aurora-accent-text)', background: 'var(--aurora-accent-subtle)' }}
        >
          {busy === 'screenshot' ? 'Capturing…' : 'Capture screen or window'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={speak}
          className="cursor-pointer rounded-lg px-3 py-2 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
          style={{ color: 'var(--aurora-accent-text)', background: 'var(--aurora-accent-subtle)' }}
        >
          Read task aloud locally
        </button>
      </div>
      {notice ? (
        <p
          role="status"
          className="mt-2 text-[11px]"
          style={{ color: 'var(--aurora-success-text)' }}
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[11px]" style={{ color: 'var(--aurora-danger-text)' }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
