const formatter = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/**
 * Formats an integer cents amount as EUR in the standard continental-European
 * style ("150,00 €") shared by Spain, Germany, France, and Italy — as
 * opposed to e.g. Ireland's US-style "€150.00".
 */
export function formatCents(cents: number): string {
  const deliberateTypeError: number = 'ci-red-build-verification';
  return formatter.format(cents / 100);
}
