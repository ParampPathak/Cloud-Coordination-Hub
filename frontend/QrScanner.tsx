import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { parseInvite } from './invite';

type Detector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};
type DetectorClass = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

async function nativeDetector(): Promise<Detector | null> {
  const Native = (window as unknown as { BarcodeDetector?: DetectorClass })
    .BarcodeDetector;
  if (!Native) return null;
  try {
    const formats = (await Native.getSupportedFormats?.()) ?? ['qr_code'];
    return formats.includes('qr_code')
      ? new Native({ formats: ['qr_code'] })
      : null;
  } catch {
    return null;
  }
}

function cameraMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera access was not allowed. You can still type the invitation code.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No camera was found. You can still type the invitation code.';
  if (name === 'NotReadableError')
    return 'The camera is in use by another app. Close it and try again, or type the code.';
  return 'The camera could not be started. You can still type the invitation code.';
}

/** Camera scanner for workspace invitation QR codes. */
export function QrScanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Starting camera…');
  const [problem, setProblem] = useState('');
  const done = useRef(onCode);
  done.current = onCode;
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    const stop = () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem(
          window.isSecureContext
            ? 'This browser cannot use the camera here. You can still type the invitation code.'
            : 'The camera needs a secure (HTTPS) connection. You can still type the invitation code.',
        );
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch (error) {
        if (!stopped) setProblem(cameraMessage(error));
        return;
      }
      if (stopped) return stop();
      const element = video.current!;
      element.srcObject = stream;
      await element.play().catch(() => {});
      const native = await nativeDetector();
      const fallback = native ? null : (await import('jsqr')).default;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      setStatus('Point the camera at a workspace QR code.');
      let rejected = false;
      const scan = async () => {
        if (stopped) return;
        let values: string[] = [];
        if (element.readyState >= 2 && element.videoWidth) {
          try {
            if (native) {
              values = (await native.detect(element)).map((c) => c.rawValue);
            } else if (fallback && context) {
              const scale = Math.min(1, 720 / element.videoWidth);
              canvas.width = Math.round(element.videoWidth * scale);
              canvas.height = Math.round(element.videoHeight * scale);
              context.drawImage(element, 0, 0, canvas.width, canvas.height);
              const frame = context.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              );
              const found = fallback(frame.data, frame.width, frame.height, {
                inversionAttempts: 'dontInvert',
              });
              if (found) values = [found.data];
            }
          } catch {
            values = [];
          }
        }
        for (const value of values) {
          const code = parseInvite(value);
          if (code) {
            stop();
            done.current(code);
            return;
          }
          if (!rejected) {
            rejected = true;
            setStatus(
              'That QR code is not a Cloud Coordination Hub invitation. Try another code.',
            );
          }
        }
        timer = window.setTimeout(() => void scan(), 200);
      };
      void scan();
    }
    void start();
    return stop;
  }, []);
  return (
    <Modal title="Scan QR Code" className="qr-modal" onClose={onClose}>
      {problem ? (
        <p className="form-error" role="alert">
          {problem}
        </p>
      ) : (
        <>
          <div className="qr-camera">
            <video ref={video} muted playsInline aria-label="Camera preview" />
          </div>
          <p className="muted qr-help" role="status">
            {status}
          </p>
        </>
      )}
      <div className="form-actions qr-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
