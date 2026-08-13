import { useId, useState, type DragEvent, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { FileUp, LockKeyhole, ShieldQuestion, X } from 'lucide-react';
import { inferEvidenceKind, type EvidenceKind } from '@thread/domain';
import { useDialogDismiss } from '../useDialogDismiss.js';

interface UploadDrawerProps {
  busy: boolean;
  onSubmit: (form: FormData) => Promise<void>;
  onClose: () => void;
}

export function UploadDrawer({ busy, onSubmit, onClose }: UploadDrawerProps) {
  useDialogDismiss(onClose);
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [kind, setKind] = useState<EvidenceKind>('document');
  const [formError, setFormError] = useState<string | null>(null);

  function acceptFile(next: File | null) {
    if (!next) {
      setFile(null);
      return;
    }
    if (next.size > 100 * 1024 * 1024) {
      setFile(null);
      setFormError('This source is larger than the 100 MB preservation limit.');
      return;
    }
    setFile(next);
    setFormError(null);
    if (!title) setTitle(next.name.replace(/\.[^.]+$/u, '').slice(0, 120));
    if (!sourceLabel) setSourceLabel(`Direct upload · ${next.name}`.slice(0, 120));
    setKind(inferEvidenceKind(next.name, next.type));
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    acceptFile(event.dataTransfer.files[0] ?? null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setFormError('Choose one source file to preserve.');
      return;
    }
    const form = new FormData(event.currentTarget);
    form.set('file', file);
    setFormError(null);
    try {
      await onSubmit(form);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Evidence ingestion failed.');
    }
  }

  return (
    <>
      <motion.button
        className="drawer-scrim"
        aria-label="Close evidence intake"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="upload-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Add evidence"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      >
        <header className="drawer-header">
          <div>
            <span className="kicker">IMMUTABLE INTAKE</span>
            <h2>Add evidence</h2>
            <p>The local engine hashes the original before it reads the file.</p>
          </div>
          <button aria-label="Close evidence intake" onClick={onClose} autoFocus>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <form className="upload-form" onSubmit={(event) => void submit(event)}>
          <label
            htmlFor={fileId}
            className={`file-drop ${file ? 'has-file' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={drop}
          >
            <input
              id={fileId}
              name="file"
              type="file"
              required
              onChange={(event) => acceptFile(event.target.files?.[0] ?? null)}
            />
            <FileUp size={28} aria-hidden="true" />
            {file ? (
              <>
                <strong>{file.name}</strong>
                <span>{(file.size / 1024).toFixed(1)} KB · ready to hash</span>
              </>
            ) : (
              <>
                <strong>Drop any evidence here</strong>
                <span>
                  Any file is preserved first · recognized formats are extracted · max 100
                  MB
                </span>
              </>
            )}
          </label>
          <div className="form-grid">
            <label>
              <span>Evidence title</span>
              <input
                name="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                required
                placeholder="East door access export"
              />
            </label>
            <label>
              <span>Source label</span>
              <input
                name="sourceLabel"
                value={sourceLabel}
                onChange={(event) => setSourceLabel(event.target.value)}
                maxLength={120}
                required
                placeholder="Warehouse controller 04"
              />
            </label>
            <label>
              <span>Artifact type</span>
              <select
                name="kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as EvidenceKind)}
              >
                <option value="message">Message</option>
                <option value="email">Email</option>
                <option value="image">Image</option>
                <option value="video">Video</option>
                <option value="audio">Audio</option>
                <option value="document">Document</option>
                <option value="access-log">Access log</option>
                <option value="calendar">Calendar</option>
                <option value="location">Location export</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              <span>Source reliability</span>
              <select name="sourceReliability" defaultValue="F">
                <option value="A">A · Completely reliable</option>
                <option value="B">B · Usually reliable</option>
                <option value="C">C · Fairly reliable</option>
                <option value="D">D · Not usually reliable</option>
                <option value="E">E · Unreliable</option>
                <option value="F">F · Cannot be judged</option>
              </select>
            </label>
            <label>
              <span>Information credibility</span>
              <select name="informationCredibility" defaultValue="6">
                <option value="1">1 · Confirmed</option>
                <option value="2">2 · Probably true</option>
                <option value="3">3 · Possibly true</option>
                <option value="4">4 · Doubtful</option>
                <option value="5">5 · Improbable</option>
                <option value="6">6 · Cannot be judged</option>
              </select>
            </label>
          </div>
          <section className="truth-boundary">
            <ShieldQuestion size={18} aria-hidden="true" />
            <div>
              <strong>What the local engine will—and will not—do</strong>
              <p>
                Text and document formats use local parsers. Audio/video uses live Scribe
                when verified; images use structured VLM extraction only when its provider
                is live, otherwise EXIF/OCR or an honest unprocessed marker.
              </p>
            </div>
          </section>
          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <button
            className="button button-primary submit-evidence"
            type="submit"
            disabled={busy}
          >
            <LockKeyhole size={15} aria-hidden="true" />
            {busy ? 'Hashing + preserving…' : 'Preserve evidence'}
          </button>
        </form>
        <footer className="drawer-footer">
          NO ENTITY MERGES OR WORLD FACTS ARE CREATED ON INTAKE
        </footer>
      </motion.aside>
    </>
  );
}
