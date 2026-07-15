import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  deleteAttachment, fetchAttachmentBlob, uploadAttachments, type Attachment,
} from '../api';
import { toast } from './Toasts';

const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.csv,.xlsx,.docx,.zip,.eml,.msg';

// Browsers name every pasted image "image.png" — number them so multiple
// pastes in one session stay distinguishable.
let pasteCounter = 0;
const PASTE_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
};

/** Images from a paste event (screenshot in the clipboard), renamed pasted-screenshot-N. */
export function filesFromPaste(e: React.ClipboardEvent): File[] {
  const files: File[] = [];
  for (const item of Array.from(e.clipboardData?.items ?? [])) {
    const ext = PASTE_EXT[item.type];
    if (!ext) continue;
    const f = item.getAsFile();
    if (f) files.push(new File([f], `pasted-screenshot-${++pasteCounter}.${ext}`, { type: item.type }));
  }
  return files;
}

/**
 * Paste-to-attach for reply boxes: returns an onPaste handler that uploads
 * clipboard screenshots straight onto the ticket. Text pastes pass through.
 */
export function usePasteAttach(ticketId: number) {
  const qc = useQueryClient();
  const upload = useMutation({
    mutationFn: (files: File[]) => uploadAttachments(ticketId, files),
    onSuccess: (r) => {
      toast(`📎 ${r.attachments.map((a) => a.filename).join(', ')} attached`, 'success');
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
    onError: (e: any) => toast(e?.message ?? 'Upload failed', 'info'),
  });
  return (e: React.ClipboardEvent) => {
    const files = filesFromPaste(e);
    if (!files.length) return;
    e.preventDefault();
    upload.mutate(files);
  };
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function fileIcon(contentType: string): string {
  if (contentType === 'application/pdf') return '📄';
  if (contentType.includes('zip')) return '🗜';
  if (contentType.startsWith('text/')) return '📝';
  if (contentType.includes('sheet') || contentType.includes('csv')) return '📊';
  return '📎';
}

/** Image thumbnail fetched with auth headers (plain <img> can't send them). */
function Thumb({ a }: { a: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    fetchAttachmentBlob(a.id).then((blob) => {
      revoke = URL.createObjectURL(blob);
      setUrl(revoke);
    }).catch(() => {});
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [a.id]);
  if (!url) return <span className="att-thumb att-thumb-loading">…</span>;
  return <img className="att-thumb" src={url} alt={a.filename} />;
}

async function openAttachment(a: Attachment) {
  try {
    const blob = await fetchAttachmentBlob(a.id);
    const url = URL.createObjectURL(blob);
    const isInline = a.contentType.startsWith('image/') || a.contentType === 'application/pdf';
    if (isInline) {
      window.open(url, '_blank');
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = a.filename;
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    toast('Could not open attachment', 'info');
  }
}

/**
 * Attachment strip: thumbnails for images, icon chips for files, an upload
 * button, delete for the uploader/admin. Shared by the agent detail, the
 * requester portal, and the new-ticket dialog.
 */
export function AttachmentStrip({ ticketId, attachments, canDelete }: {
  ticketId: number;
  attachments: Attachment[];
  canDelete?: boolean;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
  const upload = useMutation({
    mutationFn: (files: File[]) => uploadAttachments(ticketId, files),
    onSuccess: (r) => {
      toast(`${r.attachments.length} file${r.attachments.length === 1 ? '' : 's'} attached`, 'success');
      invalidate();
    },
    onError: (e: any) => toast(e?.message ?? 'Upload failed', 'info'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteAttachment(id),
    onSuccess: invalidate,
    onError: (e: any) => toast(e?.message ?? 'Could not delete', 'info'),
  });

  const images = attachments.filter((a) => a.contentType.startsWith('image/'));
  const files = attachments.filter((a) => !a.contentType.startsWith('image/'));

  return (
    <div className="attachments">
      {images.length > 0 && (
        <div className="att-images">
          {images.map((a) => (
            <div key={a.id} className="att-image-wrap" title={`${a.filename} · ${fmtSize(a.size)} · ${a.uploadedBy ?? ''}`}>
              <button className="att-image-btn" onClick={() => openAttachment(a)}>
                <Thumb a={a} />
              </button>
              {canDelete && (
                <button className="att-delete" title="Delete" onClick={() => remove.mutate(a.id)}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="att-files">
        {files.map((a) => (
          <span key={a.id} className="att-chip" title={`${fmtSize(a.size)} · uploaded by ${a.uploadedBy ?? 'unknown'}`}>
            <button className="att-chip-open" onClick={() => openAttachment(a)}>
              {fileIcon(a.contentType)} {a.filename} <em>{fmtSize(a.size)}</em>
            </button>
            {canDelete && (
              <button className="att-delete-inline" title="Delete" onClick={() => remove.mutate(a.id)}>✕</button>
            )}
          </span>
        ))}
        <button
          className="btn att-upload"
          disabled={upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {upload.isPending ? 'Uploading…' : '📎 Attach files'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) upload.mutate(files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
