import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { inviteUrl } from './invite';

// High-contrast black on white with the standard four-module quiet zone.
const qrOptions = {
  errorCorrectionLevel: 'M' as const,
  margin: 4,
  color: { dark: '#000000', light: '#ffffff' },
};

async function qrDataUrl(text: string, width: number) {
  const { toDataURL } = await import('qrcode');
  return toDataURL(text, { ...qrOptions, width });
}

function fileName(workspace: string) {
  const slug = workspace
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return (slug || 'workspace') + '-invitation-qr.png';
}

async function downloadQr(link: string, workspace: string) {
  // 1600 px stays sharp when projected or placed on a full slide.
  const anchor = document.createElement('a');
  anchor.href = await qrDataUrl(link, 1600);
  anchor.download = fileName(workspace);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/** Sharing controls shown under the invitation code in Manage Workspaces. */
export function InviteSharing({
  code,
  workspace,
  enabled,
  busy,
  onNotice,
  onError,
}: {
  code: string;
  workspace: string;
  enabled: boolean;
  busy: boolean;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [showing, setShowing] = useState(false);
  const link = inviteUrl(code);
  const run = (task: () => Promise<void>, done: string) =>
    void task().then(
      () => onNotice(done),
      () => onError('Could not complete the request. Try again.'),
    );
  const copy = () =>
    run(() => navigator.clipboard.writeText(link), 'Invite link copied.');
  const download = () =>
    run(() => downloadQr(link, workspace), 'QR code downloaded.');
  return (
    <>
      {!enabled && (
        <p className="muted">
          New joins are paused until invitations are enabled again.
        </p>
      )}
      <div className="management-actions invite-sharing">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => setShowing(true)}
        >
          Show QR Code
        </button>
        <button className="button secondary" disabled={busy} onClick={copy}>
          Copy Invite Link
        </button>
        <button className="button secondary" disabled={busy} onClick={download}>
          Download QR Code
        </button>
      </div>
      {showing && (
        <QrDialog
          link={link}
          workspace={workspace}
          enabled={enabled}
          onCopy={copy}
          onDownload={download}
          onClose={() => setShowing(false)}
        />
      )}
    </>
  );
}

function QrDialog({
  link,
  workspace,
  enabled,
  onCopy,
  onDownload,
  onClose,
}: {
  link: string;
  workspace: string;
  enabled: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const [image, setImage] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    qrDataUrl(link, 1024).then(
      (url) => current && setImage(url),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [link]);
  return (
    <Modal title="Workspace QR code" className="qr-modal" onClose={onClose}>
      <p className="qr-workspace">{workspace}</p>
      <div className="qr-frame">
        {image ? (
          <img
            src={image}
            alt={'QR code invitation to join ' + workspace}
            className="qr-image"
          />
        ) : (
          <p role={failed ? 'alert' : 'status'}>
            {failed ? 'The QR code could not be created.' : 'Creating QR code…'}
          </p>
        )}
      </div>
      <p className="muted qr-help">
        {enabled
          ? 'Scan with a phone camera to open the join page. Joining still needs a confirmation.'
          : 'Invitations are disabled, so this code will not admit new members.'}
      </p>
      <div className="form-actions qr-actions">
        <button className="button secondary" onClick={onCopy}>
          Copy Invite Link
        </button>
        <button className="button secondary" onClick={onDownload}>
          Download PNG
        </button>
        <button className="button primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
