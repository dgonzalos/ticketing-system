import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

interface RenderWithProvidersOptions {
  /** The URL to render at, e.g. `/order/order-1/payment`. Defaults to `/`. */
  route?: string;
  /**
   * The route pattern to match `route` against, e.g. `/order/:orderId/payment`.
   * Required for a component that reads `useParams` — without it, `ui` is
   * rendered directly with no matched route and `useParams` returns `{}`.
   */
  path?: string;
}

/**
 * Renders a component wrapped in the same providers every screen expects at
 * runtime (`QueryClientProvider`, a router). Every screen test needs both,
 * so this is built once rather than repeated per test file. Each call gets a
 * fresh `QueryClient` with retries disabled so failed-request tests don't
 * hang waiting on TanStack Query's default retry/backoff.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', path }: RenderWithProvidersOptions = {}
): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const content = path ? (
    <Routes>
      <Route path={path} element={ui} />
    </Routes>
  ) : (
    ui
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{content}</MemoryRouter>
    </QueryClientProvider>
  );
}
