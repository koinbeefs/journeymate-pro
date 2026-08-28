import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { notificationsApi } from "@/lib/api";
import echo from '@/lib/echo';

export function useNotifications() {
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const response = await notificationsApi.getAll();
      return response.data;
    },
  });

  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const channel = echo.private(`App.Models.User.${user.id}`);
    channel.listen('NotificationReceived', () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });

    return () => {
      echo.leave(`App.Models.User.${user.id}`);
    };
  }, [user, queryClient]);

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, actionType }: { id: string; actionType: string }) =>
      notificationsApi.handleAction(id, actionType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['trips'] }); // Refetch trips to show newly accepted trip
    },
  });

  const unreadCount = notifications.filter((n: any) => !n.read).length;

  return {
    notifications,
    isLoading,
    unreadCount,
    markRead: markReadMutation.mutate,
    markAllRead: markAllReadMutation.mutate,
    deleteNotification: deleteMutation.mutate,
    handleAction: actionMutation.mutate,
    isActioning: actionMutation.isPending,
  };
}
