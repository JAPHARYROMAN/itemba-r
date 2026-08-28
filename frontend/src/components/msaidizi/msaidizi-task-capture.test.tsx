import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MsaidiziArtifact } from '@/lib/msaidizi-task-types';
import {
  isSupportedMsaidiziReasoningAttachment,
  MsaidiziLocalDictationButton,
  MsaidiziTaskCapture,
} from './msaidizi-task-capture';

const h = vi.hoisted(() => ({ upload: vi.fn() }));

vi.mock('@/lib/msaidizi-tasks-client', () => ({
  uploadMsaidiziArtifact: h.upload,
}));

const ARTIFACT: MsaidiziArtifact = {
  id: 'artifact-1',
  stepId: null,
  kind: 'DOCUMENT',
  name: 'context.pdf',
  mimeType: 'application/pdf',
  sha256: 'a'.repeat(64),
  byteSize: '4',
  encrypted: true,
  dataClass: 'internal',
  trustLevel: 'UNTRUSTED',
  provenance: { sourceType: 'USER' },
  createdAt: '2026-08-28T00:00:00.000Z',
};

describe('Msaidizi governed multimodal capture', () => {
  beforeEach(() => {
    h.upload.mockReset().mockResolvedValue(ARTIFACT);
  });

  afterEach(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });

  it('keeps raw browser audio off the upload path and advertises only supported context media', () => {
    render(<MsaidiziTaskCapture taskId="task-1" spokenSummary="Task ready" onUploaded={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /record voice attachment/i })).toBeNull();
    expect(screen.getByText(/never uploads raw microphone audio/i)).toBeVisible();
    const input = screen.getByLabelText('Attach file or document');
    expect(input).toHaveAttribute('accept', expect.stringContaining('application/pdf'));
    expect(input).not.toHaveAttribute('accept', expect.stringContaining('audio/'));
  });

  it('refuses an attachment the backend reasoning boundary cannot consume', async () => {
    render(<MsaidiziTaskCapture taskId="task-1" spokenSummary="Task ready" onUploaded={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Attach file or document'), {
      target: {
        files: [
          new File(['PK'], 'payroll.xlsx', {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
        ],
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /file type cannot be used as reasoning context/i,
    );
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('accepts an extension-backed text file when the browser omits its MIME type', () => {
    expect(isSupportedMsaidiziReasoningAttachment({ name: 'runbook.md', type: '' })).toBe(true);
    expect(isSupportedMsaidiziReasoningAttachment({ name: 'macro.docm', type: '' })).toBe(false);
  });

  it('requires and activates the browser local-only recognizer before returning voice text', async () => {
    const onTranscript = vi.fn();
    let recognition: MockLocalRecognition | undefined;
    window.SpeechRecognition = class extends MockLocalRecognition {
      constructor() {
        super();
        recognition = this;
      }
    };
    render(<MsaidiziLocalDictationButton onTranscript={onTranscript} />);

    fireEvent.click(screen.getByRole('button', { name: /dictate objective on this device/i }));

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('Review the ledger'));
    expect(recognition?.processLocally).toBe(true);
    expect(recognition?.continuous).toBe(false);
    expect(recognition?.interimResults).toBe(false);
  });

  it('uploads a selected screen or window to the same durable task as untrusted context', async () => {
    const stop = vi.fn();
    const getDisplayMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    const mediaDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia },
    });
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tagName, options) => {
        if (tagName === 'video') {
          return {
            srcObject: null,
            muted: false,
            videoWidth: 320,
            videoHeight: 180,
            play: vi.fn().mockResolvedValue(undefined),
          } as unknown as HTMLVideoElement;
        }
        if (tagName === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: vi.fn() }),
            toBlob: (callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })),
          } as unknown as HTMLCanvasElement;
        }
        return originalCreateElement(tagName, options);
      });
    h.upload.mockResolvedValue({
      ...ARTIFACT,
      id: 'screen-artifact',
      kind: 'SCREENSHOT',
      name: 'screen.png',
      mimeType: 'image/png',
      provenance: { sourceType: 'SCREENSHOT' },
    });

    render(
      <MsaidiziTaskCapture
        taskId="33333333-3333-4333-8333-333333333333"
        spokenSummary="Draft planning"
        onUploaded={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Capture screen or window' }));

    await waitFor(() =>
      expect(h.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: '33333333-3333-4333-8333-333333333333',
          kind: 'SCREENSHOT',
          dataClass: 'internal',
          provenance: expect.objectContaining({
            sourceType: 'SCREENSHOT',
            trustLevel: 'UNTRUSTED',
          }),
        }),
      ),
    );
    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(stop).toHaveBeenCalled();
    createElement.mockRestore();
    if (mediaDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDescriptor);
    else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });
});

class MockLocalRecognition {
  continuous = true;
  interimResults = true;
  lang = '';
  processLocally = false;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;

  start() {
    queueMicrotask(() => {
      this.onresult?.({ results: [{ 0: { transcript: ' Review the ledger ' } }] });
      this.onend?.();
    });
  }

  stop() {
    this.onend?.();
  }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}
