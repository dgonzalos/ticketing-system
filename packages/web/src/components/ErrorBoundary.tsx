import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, ButtonLink, PageHeader } from './ui';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches a render-time crash in a screen and shows a recovery page instead
 * of a blank app. A class component because React 18 has no hook for error
 * boundaries. It sits inside `App`'s `RouteFade`, which remounts per
 * pathname — so navigating anywhere (the header, Back) resets it, with no
 * reset logic here. Only render errors land here: failed requests are
 * already handled per screen through TanStack Query's `error`.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Screen crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className={styles.screen} role="alert">
        <PageHeader title="Something went wrong" description="This page hit an unexpected error. Try again, or head back to the events." />
        <div className={styles.actions}>
          <Button onClick={() => window.location.reload()}>Try again</Button>
          <ButtonLink to="/" variant="secondary">
            Browse events
          </ButtonLink>
        </div>
      </div>
    );
  }
}
