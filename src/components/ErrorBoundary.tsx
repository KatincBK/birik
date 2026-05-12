import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Top-level React error boundary. PLAN §12 Faz 7.
 * Render hatası olduğunda app çökmek yerine fallback gösterir;
 * "Yeniden dene" düğmesi state'i sıfırlar (component tree remount).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[birik] uncaught render error", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-screen w-screen place-items-center bg-(--color-bg-base) text-(--color-text-primary)">
        <div className="max-w-md px-6 text-center">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-(--color-danger)/15 text-(--color-danger)">
            <AlertTriangle className="h-6 w-6" strokeWidth={2.25} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Bir şeyler ters gitti
          </h1>
          <p className="mt-2 text-sm text-(--color-text-secondary)">
            Uygulamada beklenmedik bir hata oluştu. Verilerin güvende — bu
            sadece arayüz sorunu. Yeniden denemek istersen aşağıdaki butona
            bas.
          </p>
          <pre className="mt-4 overflow-auto rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) p-3 text-left text-xs text-(--color-text-tertiary)">
            {this.state.error.message}
          </pre>
          <button
            onClick={this.reset}
            className="mt-5 rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-medium text-(--color-bg-base) transition-all hover:bg-(--color-accent-hover) active:scale-95"
          >
            Yeniden dene
          </button>
        </div>
      </div>
    );
  }
}
