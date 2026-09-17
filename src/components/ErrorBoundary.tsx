import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.props.onError?.(error, errorInfo);
    // Log to console in development
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught:", error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-[200px] flex items-center justify-center p-6 rounded-xl border border-red-200 bg-red-50">
          <div className="text-center max-w-md">
            <div className="text-2xl mb-2">⚠️</div>
            <div className="text-sm font-semibold text-red-800 mb-1">Something went wrong</div>
            <div className="text-xs text-red-600 mb-3">
              {this.state.error?.message || "An unexpected error occurred"}
            </div>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
