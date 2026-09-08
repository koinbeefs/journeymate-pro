import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { reviewsApi } from '@/lib/api';

export function useReviews(params?: string | { tripId?: string; placeName?: string; placeId?: string }) {
  const queryClient = useQueryClient();

  const options = typeof params === 'string' ? { tripId: params } : (params || {});
  const { tripId, placeName, placeId } = options;

  const reviewsQuery = useQuery({
    queryKey: ['reviews', tripId, placeName, placeId],
    queryFn: async () => {
      const validTripId = tripId && !tripId.startsWith('t') ? tripId : undefined;
      const response = await reviewsApi.getAll({
        ...(validTripId ? { trip_id: validTripId } : {}),
        ...(placeName ? { place_name: placeName } : {}),
        ...(placeId ? { place_id: placeId } : {}),
      });
      return response.data.data || response.data || [];
    },
    enabled: true,
    placeholderData: keepPreviousData,
    staleTime: 0,
    refetchOnMount: true,
  });

  const createReview = useMutation({
    mutationFn: async (data: { trip_id?: string; place_id?: string; place_name: string; rating: number; review_text?: string; photos?: string[] }) => {
      const payload = { ...data };
      if (payload.trip_id && payload.trip_id.startsWith('t')) {
        delete payload.trip_id;
      }
      const response = await reviewsApi.create(payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
  });

  const deleteReview = useMutation({
    mutationFn: async (id: string) => {
      await reviewsApi.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
  });

  return {
    reviews: reviewsQuery.data || [],
    isLoading: reviewsQuery.isLoading,
    error: reviewsQuery.error,
    createReview,
    deleteReview,
  };
}
