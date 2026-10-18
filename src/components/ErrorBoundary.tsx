import { Component, type ErrorInfo, type ReactNode } from "react";
import { Flag, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/lifecycle errors anywhere below it so a single broken panel
 * cannot blank the whole game. State is not persisted, so reloading recovers.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-screen place-items-center bg-carbon-950 px-4">
        <div className="panel panel-pad w-full max-w-lg text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg bg-race-red">
            <Flag size={24} />
          </span>
          <h1 className="font-display text-lg font-bold uppercase tracking-wide text-white">Something went wrong</h1>
          <p className="mt-2 text-sm text-gray-400">
            The game hit an unexpected error. Your career is saved — try again, or reload the page.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg border border-carbon-700 bg-carbon-900/60 p-3 text-left text-[11px] text-red-300">
            {error.message}
          </pre>
          <div className="mt-5 flex justify-center gap-2">
            <button className="btn-ghost" onClick={this.reset}>
              <RotateCcw size={16} /> Try again
            </button>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Reload game
            </button>
          </div>
        </div>
      </div>
    );
  }
}
