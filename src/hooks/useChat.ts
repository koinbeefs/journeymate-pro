import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useEffect } from 'react';
import { chatApi } from '@/lib/api';
import echo from '@/lib/echo';

export function useChat(tripId?: string) {
  const queryClient = useQueryClient();

  const messagesQuery = useQuery({
    queryKey: ['chat', tripId],
    queryFn: async () => {
      if (!tripId || tripId.startsWith('t')) return [];
      const response = await chatApi.getMessages(tripId);
      return response.data.data || response.data || [];
    },
    enabled: !!tripId && !tripId.startsWith('t'),
    placeholderData: keepPreviousData,
    staleTime: 60000, // prevent duplicate fetches on strict mode double mounts
  });

  useEffect(() => {
    if (!tripId || tripId.startsWith('t')) return;

    const channel = echo.private(`trip.${tripId}`);
    channel.listen('MessageSent', (e: any) => {
      queryClient.setQueryData(['chat', tripId], (oldData: any[]) => {
        if (!oldData) return [e.message];
        const exists = oldData.some(msg => msg.id === e.message.id);
        if (exists) return oldData;
        return [...oldData, e.message];
      });
    });

    return () => {
      echo.leave(`trip.${tripId}`);
    };
  }, [tripId, queryClient]);

  const sendMessage = useMutation({
    mutationFn: async (data: { content: string; type?: string; user?: { id: string; username: string; profile_pic?: string } }) => {
      if (!tripId || tripId.startsWith('t')) throw new Error("Cannot send messages in a mock trip");
      const { user, ...payload } = data;
      const response = await chatApi.sendMessage(tripId, payload);
      return response.data;
    },
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: ['chat', tripId] });
      const previousMessages = queryClient.getQueryData<any[]>(['chat', tripId]) || [];

      const optimisticMsg = {
        id: `temp-${Date.now()}`,
        user_id: newData.user?.id || '',
        content: newData.content,
        type: newData.type || 'text',
        created_at: new Date().toISOString(),
        user: {
          id: newData.user?.id || '',
          username: newData.user?.username || 'You',
          profile_pic: newData.user?.profile_pic
        }
      };

      queryClient.setQueryData(['chat', tripId], [...previousMessages, optimisticMsg]);
      return { previousMessages };
    },
    onError: (err, newData, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(['chat', tripId], context.previousMessages);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['chat', tripId] });
    },
  });

  return {
    messages: messagesQuery.data || [],
    isLoading: messagesQuery.isLoading,
    error: messagesQuery.error,
    sendMessage,
  };
}
