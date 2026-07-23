import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Catches render errors so a single bad component never blanks the whole app
 * (a white screen). Shows the error and a reset button instead.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface it in the console for debugging; the UI stays usable.
    console.error("Render error caught by ErrorBoundary:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ margin: 16 }}>
          <h2 style={{ marginTop: 0 }}>😕 Something went wrong displaying this.</h2>
          <p className="muted">The rest of the app still works — this section hit an error.</p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.8, overflowX: "auto" }}>
            {this.state.error.message}
          </pre>
          <button className="btn" onClick={this.reset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
