import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { Seat } from '../components/Seats/types';
import { selectSeat, unlockSeat } from '../services/seatApi';
import { useSeats } from './useSeats';

interface UseSeatSelectionOptions {
  performanceId: string;
  /** JWT for the current user, or null while it's still being obtained. */
  token: string | null;
}

/**
 * Seat selection state for a single performance: fetches the seat list,
 * tracks which seats the current user has selected, and drives the
 * select/unlock mutations against the backend's SeatLockManager. Confirming
 * the purchase itself happens later, atomically for the whole cart, via
 * `useCheckout` — not per-seat here.
 *
 * There is no `lockId` on the wire — the backend keys every lock purely by
 * `(seatId, userId from the JWT)` — so "which seats are mine" is tracked
 * client-side as a `Set<string>` of seat ids, separate from each seat's
 * server-reported `status` (which is true for anyone's active hold, not
 * just the current user's).
 */
export function useSeatSelection({ performanceId, token }: UseSeatSelectionOptions) {
  const queryClient = useQueryClient();
  const queryKey = ['seats', performanceId];

  const [selectedSeatIds, setSelectedSeatIds] = useState<Set<string>>(new Set());
  const [loadingSeatIds, setLoadingSeatIds] = useState<Set<string>>(new Set());

  const markLoading = (seatId: string) => setLoadingSeatIds((prev) => new Set(prev).add(seatId));
  const clearLoading = (seatId: string) =>
    setLoadingSeatIds((prev) => {
      const next = new Set(prev);
      next.delete(seatId);
      return next;
    });

  const { data: seats = [], isLoading: isSeatsLoading, error: seatsError } = useSeats(performanceId);

  /**
   * Optimistically writes `status` onto one seat, returning that seat's
   * prior status so the caller's onError can restore just this seat.
   * Deliberately per-seat rather than a whole-array snapshot: two mutations
   * on different seats can be in flight at once (e.g. clearSelection fires
   * one unlock per selected seat), and a whole-array snapshot taken by one
   * would clobber the other's still-pending optimistic write on rollback.
   */
  const optimisticallySetStatus = async (seatId: string, status: Seat['status']): Promise<{ previousStatus?: Seat['status'] }> => {
    await queryClient.cancelQueries({ queryKey });
    const previousStatus = queryClient.getQueryData<Seat[]>(queryKey)?.find((seat) => seat.id === seatId)?.status;
    queryClient.setQueryData<Seat[]>(queryKey, (old) => old?.map((seat) => (seat.id === seatId ? { ...seat, status } : seat)));
    return { previousStatus };
  };

  const rollbackStatus = (seatId: string, context?: { previousStatus?: Seat['status'] }): void => {
    if (!context?.previousStatus) {
      return;
    }
    const restoredStatus = context.previousStatus;
    queryClient.setQueryData<Seat[]>(queryKey, (old) => old?.map((seat) => (seat.id === seatId ? { ...seat, status: restoredStatus } : seat)));
  };

  const selectMutation = useMutation({
    mutationFn: (seatId: string) => {
      if (!token) throw new Error('Not authenticated yet');
      return selectSeat(seatId, token);
    },
    // Rolls back only this seat's status on failure (see helper below) rather than
    // restoring a whole-array snapshot, so a concurrent mutation on a *different*
    // seat (e.g. clearSelection unlocking seat B while this selects seat A) can't
    // have its still-pending optimistic update stomped by this mutation's rollback.
    //
    // loadingSeatIds is tracked via markLoading/clearLoading here rather than this
    // mutation's own isPending/variables: when clearSelection calls mutate() several
    // times concurrently on the *same* useMutation instance, isPending/variables only
    // reflect the most recently dispatched call — but onMutate/onSettled still fire
    // once per individual mutate() call even when they overlap, so per-seat state
    // built from them stays accurate for every concurrent call, not just the last one.
    onMutate: (seatId: string) => {
      markLoading(seatId);
      return optimisticallySetStatus(seatId, 'reserved');
    },
    onSuccess: (result, seatId) => {
      if (!result.success) {
        // Someone else grabbed it first; the invalidate in onSettled below corrects the optimistic status.
        return;
      }
      setSelectedSeatIds((prev) => new Set(prev).add(seatId));
    },
    onError: (_err, seatId, context) => rollbackStatus(seatId, context),
    onSettled: (_data, _error, seatId) => {
      clearLoading(seatId);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const unlockMutation = useMutation({
    mutationFn: (seatId: string) => {
      if (!token) throw new Error('Not authenticated yet');
      return unlockSeat(seatId, token);
    },
    onMutate: (seatId: string) => {
      markLoading(seatId);
      return optimisticallySetStatus(seatId, 'available');
    },
    onSuccess: (_data, seatId) => {
      setSelectedSeatIds((prev) => {
        const next = new Set(prev);
        next.delete(seatId);
        return next;
      });
    },
    onError: (_err, seatId, context) => rollbackStatus(seatId, context),
    onSettled: (_data, _error, seatId) => {
      clearLoading(seatId);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const onSeatSelect = useCallback(
    (seat: Seat) => {
      if (selectedSeatIds.has(seat.id)) {
        unlockMutation.mutate(seat.id);
      } else {
        selectMutation.mutate(seat.id);
      }
    },
    [selectedSeatIds, selectMutation, unlockMutation]
  );

  const totalPrice = seats.filter((seat) => selectedSeatIds.has(seat.id)).reduce((sum, seat) => sum + seat.price, 0);

  const clearSelection = useCallback(() => {
    selectedSeatIds.forEach((seatId) => unlockMutation.mutate(seatId));
  }, [selectedSeatIds, unlockMutation]);

  return {
    seats,
    selectedSeatIds: Array.from(selectedSeatIds),
    loadingSeatIds,
    totalPrice,
    isSeatsLoading,
    seatsError,
    selectError: selectMutation.error,
    onSeatSelect,
    clearSelection,
  };
}
