import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** UX-5: never a blank white screen (ROADMAP §9.1). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[miniapp] uncaught", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            padding: "1.5rem",
            minHeight: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            justifyContent: "center",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>حدث خطأ غير متوقع</h1>
          <p style={{ margin: 0, color: "var(--tg-hint-color)" }}>
            أعد فتح التطبيق. إن استمرّ الخطأ، تواصل مع الدعم.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              alignSelf: "flex-start",
              padding: "0.75rem 1.25rem",
              border: "none",
              borderRadius: "0.75rem",
              background: "var(--tg-button-color)",
              color: "var(--tg-button-text-color)",
              minHeight: 44,
              minWidth: 44,
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
