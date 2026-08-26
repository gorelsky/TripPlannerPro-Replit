import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageCircle, Search, Send } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { ChatMessage, User } from "@shared/schema";

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
  const [contactSearch, setContactSearch] = useState("");

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<User[]>({
    queryKey: ["/api/chat/contacts"],
    enabled: Boolean(currentUser),
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (!selectedUserId && contacts.length > 0) {
      setSelectedUserId(contacts[0].id);
    }
  }, [selectedUserId, contacts]);

  const chatUrl = selectedUserId ? `/api/chat/messages?userId=${encodeURIComponent(selectedUserId)}` : null;

  const { data: messages = [], isLoading: messagesLoading } = useQuery<ChatMessage[]>({
    queryKey: [chatUrl ?? "/api/chat/messages"],
    enabled: Boolean(currentUser && chatUrl),
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (selectedUserId) {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/unread-count"] });
    }
  }, [messages, selectedUserId]);

  const selectedContact = contacts.find((contact) => contact.id === selectedUserId);
  const filteredContacts = contacts.filter((contact) => {
    const search = contactSearch.trim().toLocaleLowerCase("ru-RU");
    if (!search) return true;
    return [contact.fullName, contact.department, contact.jobTitle]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase("ru-RU").includes(search));
  });

  const sendMessageMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/chat/messages", {
        message,
        toUserId: selectedUserId,
      });
      return response.json() as Promise<ChatMessage>;
    },
    onSuccess: () => {
      setMessage("");
      if (chatUrl) {
        queryClient.invalidateQueries({ queryKey: [chatUrl] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/chat/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/unread-count"] });
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
    <div className="mx-auto w-full max-w-[1600px] space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Чат</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {currentUser.role === "coordinator"
            ? "Все пользователи системы"
            : "Коллеги вашего отдела и непосредственный руководитель"}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          По вопросам работы приложения используйте раздел «Мой профиль» → «Связь с администратором».
        </p>
      </div>

      <Card className="min-w-0 w-full overflow-hidden">
        <div className="grid min-w-0 xl:min-h-[680px] xl:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
          <div className="min-w-0 border-b xl:border-b-0 xl:border-r">
              <div className="border-b px-3 py-3 sm:px-4">
                <div className="mb-2 font-medium">Контакты</div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={contactSearch}
                    onChange={(event) => setContactSearch(event.target.value)}
                    placeholder="Поиск сотрудника"
                    className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>
              </div>
              <div className="h-[220px] overflow-y-auto overscroll-contain xl:h-[560px]">
                {contactsLoading ? (
                  <div className="p-4 space-y-3">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : filteredContacts.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">Нет доступных контактов</p>
                ) : (
                  <div className="p-2 space-y-1">
                    {filteredContacts.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => setSelectedUserId(contact.id)}
                        className={`w-full rounded-md px-3 py-2 text-left hover-elevate ${selectedUserId === contact.id ? "bg-muted" : ""}`}
                      >
                        <span className="block truncate text-sm font-medium">{contact.fullName}</span>
                        <p className="truncate text-xs text-muted-foreground mt-1">
                          {contact.jobTitle || contact.department || "Сотрудник"}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

          <div className="flex min-w-0 flex-col">
            <CardHeader className="border-b px-4 py-4 sm:px-6">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <MessageCircle className="h-5 w-5 shrink-0" />
                <span className="truncate">{selectedContact?.fullName || "Выберите собеседника"}</span>
              </CardTitle>
              {selectedContact && (
                <CardDescription className="break-words">{selectedContact.jobTitle || selectedContact.department || selectedContact.email}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="flex flex-1 flex-col p-0">
              <ScrollArea className="h-[280px] p-3 sm:h-[440px] sm:p-4 xl:h-[520px]">
                {messagesLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-3/4" />
                    <Skeleton className="h-16 w-2/3 ml-auto" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-[220px] items-center justify-center px-6 text-center text-sm leading-6 text-muted-foreground sm:h-[300px]">
                    Начните диалог: отправьте первое сообщение.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((chatMessage) => {
                      const ownMessage = chatMessage.fromUserId === currentUser.id;
                      return (
                        <div key={chatMessage.id} className={`flex ${ownMessage ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[92%] rounded-md px-3 py-2 text-sm sm:max-w-[85%] ${ownMessage ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
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
              <form onSubmit={handleSubmit} className="min-w-0 border-t p-3 sm:p-4">
                <div className="flex flex-col gap-2">
                  <Textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Введите сообщение..."
                    className="min-h-[104px] min-w-0 w-full resize-none sm:min-h-[120px]"
                    disabled={!selectedUserId}
                  />
                  <Button
                    type="submit"
                    aria-label="Отправить сообщение"
                    className="w-full"
                    disabled={!message.trim() || sendMessageMutation.isPending || !selectedUserId}
                  >
                    <Send />
                    Отправить
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
