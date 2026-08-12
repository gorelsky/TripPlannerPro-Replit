import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageCircle, Send } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { ChatMessage, User } from "@shared/schema";

type ChatThread = {
  user: User;
  latestMessage: ChatMessage | null;
  unreadCount: number;
};

function formatTime(value: Date | string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Chat() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const isAdmin = currentUser?.role === "admin";

  const { data: threads = [], isLoading: threadsLoading } = useQuery<ChatThread[]>({
    queryKey: ["/api/chat/threads"],
    enabled: isAdmin,
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (isAdmin && !selectedUserId && threads.length > 0) {
      setSelectedUserId(threads[0].user.id);
    }
  }, [isAdmin, selectedUserId, threads]);

  const chatUrl = isAdmin && selectedUserId
    ? `/api/chat/messages?userId=${encodeURIComponent(selectedUserId)}`
    : "/api/chat/messages";

  const { data: messages = [], isLoading: messagesLoading } = useQuery<ChatMessage[]>({
    queryKey: [chatUrl],
    enabled: Boolean(currentUser && (!isAdmin || selectedUserId)),
    refetchInterval: 10000,
  });

  const selectedThread = threads.find((thread) => thread.user.id === selectedUserId);

  const sendMessageMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/chat/messages", {
        message,
        ...(isAdmin ? { toUserId: selectedUserId } : {}),
      });
      return response.json() as Promise<ChatMessage>;
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: [chatUrl] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Не удалось отправить сообщение",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (message.trim() && !sendMessageMutation.isPending) {
      sendMessageMutation.mutate();
    }
  };

  if (!currentUser) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Чат</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isAdmin ? "Переписка с сотрудниками" : "Связь с администратором системы"}
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="grid min-h-[600px] lg:grid-cols-[280px_1fr]">
          {isAdmin && (
            <div className="border-b lg:border-b-0 lg:border-r">
              <div className="px-4 py-3 border-b font-medium">Сотрудники</div>
              <ScrollArea className="h-[220px] lg:h-[548px]">
                {threadsLoading ? (
                  <div className="p-4 space-y-3">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : threads.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">Сотрудников пока нет</p>
                ) : (
                  <div className="p-2 space-y-1">
                    {threads.map((thread) => (
                      <button
                        key={thread.user.id}
                        type="button"
                        onClick={() => setSelectedUserId(thread.user.id)}
                        className={`w-full rounded-md px-3 py-2 text-left hover-elevate ${selectedUserId === thread.user.id ? "bg-muted" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{thread.user.fullName}</span>
                          {thread.unreadCount > 0 && <Badge className="shrink-0">{thread.unreadCount}</Badge>}
                        </div>
                        <p className="truncate text-xs text-muted-foreground mt-1">
                          {thread.latestMessage?.message || thread.user.department || "Нет сообщений"}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          )}

          <div className="flex min-w-0 flex-col">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                {isAdmin ? selectedThread?.user.fullName || "Выберите сотрудника" : "Администратор"}
              </CardTitle>
              {isAdmin && selectedThread && (
                <CardDescription>{selectedThread.user.email}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="flex flex-1 flex-col p-0">
              <ScrollArea className="h-[360px] p-4">
                {messagesLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-3/4" />
                    <Skeleton className="h-16 w-2/3 ml-auto" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-[300px] items-center justify-center text-center text-sm text-muted-foreground">
                    Начните диалог, отправив первое сообщение
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((chatMessage) => {
                      const ownMessage = chatMessage.fromUserId === currentUser.id;
                      return (
                        <div key={chatMessage.id} className={`flex ${ownMessage ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] rounded-md px-3 py-2 text-sm ${ownMessage ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                            <p className="whitespace-pre-wrap break-words">{chatMessage.message}</p>
                            <p className={`mt-1 text-[11px] ${ownMessage ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                              {formatTime(chatMessage.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
              <form onSubmit={handleSubmit} className="border-t p-4">
                <div className="flex items-end gap-2">
                  <Textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Введите сообщение..."
                    className="min-h-[76px] resize-none"
                    disabled={isAdmin && !selectedUserId}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    aria-label="Отправить сообщение"
                    disabled={!message.trim() || sendMessageMutation.isPending || (isAdmin && !selectedUserId)}
                  >
                    <Send />
                  </Button>
                </div>
              </form>
            </CardContent>
          </div>
        </div>
      </Card>
    </div>
  );
}
