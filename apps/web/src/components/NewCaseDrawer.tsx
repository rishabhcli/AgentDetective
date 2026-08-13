import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { FolderPlus, X } from 'lucide-react';
import { useDialogDismiss } from '../useDialogDismiss.js';

export interface NewCaseInput {
  title: string;
  subtitle?: string;
  location?: string;
}

interface NewCaseDrawerProps {
  busy: boolean;
  onSubmit: (input: NewCaseInput) => Promise<void>;
  onClose: () => void;
}

/**
 * Opening a case is deliberately thin. A case earns its structure from the
 * evidence put into it, so there is nothing to configure up front.
 */
export function NewCaseDrawer({ busy, onSubmit, onClose }: NewCaseDrawerProps) {
  useDialogDismiss(onClose);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [location, setLocation] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length < 3) {
      setFormError('Give the case a title of at least three characters.');
      return;
    }
    setFormError(null);
    try {
      await onSubmit({
        title: trimmed,
        ...(subtitle.trim() ? { subtitle: subtitle.trim() } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
      });
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'The case was not opened.');
    }
  }

  return (
    <>
      <motion.button
        className="drawer-scrim"
        aria-label="Close new case"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="upload-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Open a new case"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      >
        <header className="drawer-header">
          <div>
            <span className="kicker">NEW INVESTIGATION</span>
            <h2>Open a new case</h2>
            <p>
              It starts empty. Every entity, relationship and open question it ends up with
              will have come from evidence you put in.
            </p>
          </div>
          <button aria-label="Close new case" onClick={onClose} autoFocus>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <form className="upload-form" onSubmit={(event) => void submit(event)}>
          <div className="form-grid">
            <label>
              <span>Case title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                minLength={3}
                maxLength={120}
                required
                placeholder="What are you investigating?"
              />
            </label>
            <label>
              <span>What is unresolved</span>
              <input
                value={subtitle}
                onChange={(event) => setSubtitle(event.target.value)}
                maxLength={240}
                placeholder="Optional · one line"
              />
            </label>
            <label>
              <span>Location</span>
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                maxLength={120}
                placeholder="Optional"
              />
            </label>
          </div>
          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <button
            className="button button-primary"
            type="submit"
            disabled={busy || title.trim().length < 3}
          >
            <FolderPlus size={15} aria-hidden="true" />
            {busy ? 'Opening…' : 'Open case'}
          </button>
        </form>
      </motion.aside>
    </>
  );
}
