import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { AudioLines, Mic, MicOff, PhoneOff, ShieldCheck, X } from 'lucide-react';
import { requestInterviewSession } from '../api.js';
import { useDialogDismiss } from '../useDialogDismiss.js';

interface InterviewDrawerProps {
  caseId: string;
  active: boolean;
  onClose: () => void;
}

export function InterviewDrawer({ caseId, active, onClose }: InterviewDrawerProps) {
  if (!active) return null;
  return (
    <ConversationProvider>
      <InterviewPanel caseId={caseId} onClose={onClose} />
    </ConversationProvider>
  );
}

function InterviewPanel({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const conversation = useConversation();
  const endSession = conversation.endSession;
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [keyterms, setKeyterms] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => () => endSession(), [endSession]);
  // `close` is a hoisted declaration, so it is safe to bind here: dismissing
  // the room by keyboard must still end the live session, not just unmount.
  useDialogDismiss(close);

  async function begin() {
    setSessionError(null);
    setConnecting(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const session = await requestInterviewSession(caseId);
      setKeyterms(session.keyterms);
      conversation.startSession({
        signedUrl: session.signedUrl,
        connectionType: 'websocket',
        onError: (message) => setSessionError(String(message)),
      });
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : 'The interview session could not start.',
      );
    } finally {
      setConnecting(false);
    }
  }

  function close() {
    conversation.endSession();
    onClose();
  }

  const connected = conversation.status === 'connected';
  return (
    <>
      <motion.button
        className="drawer-scrim"
        aria-label="Close witness interview"
        onClick={close}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="interview-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Witness interview"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      >
        <header className="drawer-header">
          <div>
            <span className="kicker">ELEVENLABS / LIVE TRANSPORT</span>
            <h2>Witness room</h2>
            <p>One clear question at a time. Every answer returns to the case file.</p>
          </div>
          <button aria-label="Close witness interview" onClick={close} autoFocus>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="interview-body">
          <section
            className={`voice-orbit ${connected ? `mode-${conversation.mode}` : ''}`}
          >
            <div className="voice-rings" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="voice-core">
              <AudioLines size={28} aria-hidden="true" />
              <strong>
                {connected ? conversation.mode : connecting ? 'connecting' : 'ready'}
              </strong>
              <small>{conversation.status}</small>
            </div>
          </section>

          <section className="interview-live-copy" aria-live="polite">
            <span>CURRENT UTTERANCE</span>
            <blockquote>
              {conversation.message ??
                (connected
                  ? 'Listening for the next source-bound statement…'
                  : 'The live agent has not joined the room.')}
            </blockquote>
          </section>

          <div className="interview-controls">
            {!connected ? (
              <button
                className="button button-primary"
                onClick={() => void begin()}
                disabled={connecting}
              >
                <Mic size={15} aria-hidden="true" />
                {connecting ? 'Opening signed room…' : 'Begin live interview'}
              </button>
            ) : (
              <>
                <button
                  className="button"
                  onClick={() => conversation.setMuted(!conversation.isMuted)}
                >
                  {conversation.isMuted ? <MicOff size={15} /> : <Mic size={15} />}
                  {conversation.isMuted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  className="button end-interview"
                  onClick={() => conversation.endSession()}
                >
                  <PhoneOff size={15} aria-hidden="true" /> End interview
                </button>
              </>
            )}
          </div>

          {sessionError ? (
            <p className="form-error" role="alert">
              {sessionError}
            </p>
          ) : null}

          <section className="interview-boundary">
            <ShieldCheck size={17} aria-hidden="true" />
            <div>
              <strong>Interview boundary</strong>
              <p>
                This conversation is investigative input—not a finding. Upload or export a
                recording/transcript to make it an immutable case artifact with provenance.
              </p>
            </div>
          </section>

          <section className="keyterm-register">
            <span>CASE KEYTERMS SYNCED TO ASR</span>
            <div>
              {keyterms.length > 0 ? (
                keyterms.map((term) => <i key={term}>{term}</i>)
              ) : (
                <small>Keyterms load when the signed room opens.</small>
              )}
            </div>
          </section>
        </div>
        <footer className="drawer-footer">
          SIGNED URL STAYS EPHEMERAL · API KEY STAYS SERVER-SIDE
        </footer>
      </motion.aside>
    </>
  );
}
