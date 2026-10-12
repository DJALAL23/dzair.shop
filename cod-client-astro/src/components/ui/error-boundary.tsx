import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Contain a render failure to the part of the page that failed. Without one,
 * React unmounts the whole island: a rich-text editor whose chunk fails to
 * load (a deploy replaced it, the network dropped) blanks the entire product
 * page. `fallback` renders instead of `children` once they throw.
 */
export class ErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[dashboard] contained render failure", error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
