import { Component, type ReactNode } from 'react';
import { writeRecoveryDrafts } from '@/app/editor-store';

interface State {
  error: Error | null;
}

/** Last line of defense: never a blank screen, and unsaved text is preserved first. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error('My Doc crashed', error);
    try {
      writeRecoveryDrafts();
    } catch {
      /* best effort */
    }
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="card max-w-md p-8 text-center">
          <h1 className="text-[18px] font-semibold text-ink">Something went wrong</h1>
          <p className="mt-2 text-[14px] text-slate">
            My Doc hit an unexpected problem. Your last saved files are stored on this device. Try
            to continue to save or export any pending changes before reloading.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => this.setState({ error: null })}
            >
              Try to continue
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => location.reload()}>
              Reload My Doc
            </button>
          </div>
          <details className="mt-6 text-left text-caption text-steel">
            <summary className="cursor-pointer">Technical details</summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-surface p-2 text-xs whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
