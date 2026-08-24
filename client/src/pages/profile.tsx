import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Lock, Mail, Users, AlertCircle, Upload, X } from "lucide-react";
import type { User } from "@shared/schema";
import { roleLabels } from "@/lib/role-utils";
import { scrollAppToTop } from "@/lib/scroll-utils";

export default function Profile() {
  const { user: currentUser, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [contactSubject, setContactSubject] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactAttachment, setContactAttachment] = useState<File | null>(null);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const { toast } = useToast();

  const { data: colleagues = [] } = useQuery<User[]>({
    queryKey: ["/api/users", { department: currentUser?.department }],
    queryFn: async () => {
      const url = `/api/users?department=${encodeURIComponent(currentUser?.department || "")}`;
      const res = await fetch(url);
      return res.json();
    },
    enabled: !!currentUser?.department,
  });

  const { data: userTrips = [] } = useQuery({
    queryKey: ["/api/trips", { department: currentUser?.department }],
    queryFn: async () => {
      const url = `/api/trips?department=${encodeURIComponent(currentUser?.department || "")}`;
      const res = await fetch(url);
      return res.json();
    },
    enabled: !!currentUser?.department,
  });

  const changePasswordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      apiRequest("PATCH", "/api/auth/change-password", data),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordErrors([]);
      toast({
        title: "Успешно",
        description: "Пароль изменен",
      });
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || "Не удалось изменить пароль";
      if (message.includes(",")) {
        setPasswordErrors(message.split(","));
      } else {
        setPasswordErrors([message]);
      }
    },
  });

  const contactAdminMutation = useMutation({
    mutationFn: async (data: { subject: string; message: string; attachment?: File | null }) => {
      const formData = new FormData();
      formData.append("subject", data.subject);
      formData.append("message", data.message);
      if (data.attachment) formData.append("attachment", data.attachment, data.attachment.name);
      const res = await fetch("/api/contact-admin", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) throw new Error((await res.text()) || "Failed");
      return res;
    },
    onSuccess: () => {
      setContactSubject("");
      setContactMessage("");
      setContactAttachment(null);
      toast({
        title: "Успешно",
        description: "Сообщение отправлено администратору",
      });
    },
    onError: (error: any) => {
      console.error("contact-admin failed", error);
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось отправить сообщение",
        variant: "destructive",
      });
    },
  });

  if (!currentUser) {
    return <div>Загрузка...</div>;
  }

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordErrors([]);

    if (newPassword !== confirmPassword) {
      setPasswordErrors(["Пароли не совпадают"]);
      return;
    }

    changePasswordMutation.mutate({
      currentPassword,
      newPassword,
    });
  };

  const handleContactAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    if (contactSubject.trim() && contactMessage.trim()) {
      contactAdminMutation.mutate({
        subject: contactSubject,
        message: contactMessage,
        attachment: contactAttachment,
      });
    }
  };

  const myTrips = userTrips.filter((t: any) => t.employeeId === currentUser.id);

  return (
    <div className="grid gap-6">
      {/* User Info Card */}
      <Card>
        <CardHeader className="pb-3 md:pb-4">
          <CardTitle className="text-sm md:text-base">Личный кабинет</CardTitle>
          <CardDescription className="text-xs md:text-sm">Ваша информация в системе</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 md:space-y-4">
          <div className="grid gap-3 md:gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">ФИО</Label>
              <p className="text-xs md:text-sm font-medium truncate">{currentUser.fullName}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <p className="text-xs md:text-sm font-medium truncate">{currentUser.email}</p>
            </div>
            {currentUser.jobTitle && (
              <div>
                <Label className="text-xs text-muted-foreground">Должность</Label>
                <p className="text-xs md:text-sm font-medium truncate">{currentUser.jobTitle}</p>
              </div>
            )}
            <div>
              <Label className="text-xs text-muted-foreground">Отдел</Label>
              <p className="text-xs md:text-sm font-medium truncate">{currentUser.department || "—"}</p>
            </div>
            {currentUser.role && (
              <div>
                <Label className="text-xs text-muted-foreground">Роль</Label>
                <Badge className="mt-1 text-[10px] md:text-xs">{roleLabels[currentUser.role]}</Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="colleagues" className="w-full" onValueChange={scrollAppToTop}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="colleagues" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Коллеги
          </TabsTrigger>
          <TabsTrigger value="password" className="flex items-center gap-2">
            <Lock className="w-4 h-4" />
            Пароль
          </TabsTrigger>
          <TabsTrigger value="admin" className="flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Админ
          </TabsTrigger>
        </TabsList>

        {/* Colleagues Tab */}
        <TabsContent value="colleagues">
          <Card>
            <CardHeader className="pb-3 md:pb-4">
              <CardTitle className="text-sm md:text-base">Коллеги по отделу</CardTitle>
              <CardDescription className="text-xs md:text-sm">
                Всех сотрудников вашего отдела: {currentUser.department}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {colleagues.length > 0 ? (
                <div className="space-y-2">
                  {colleagues.map((colleague) => (
                    <div
                      key={colleague.id}
                      className="p-2 md:p-3 border rounded-md hover:bg-muted"
                    >
                      <p className="text-xs md:text-sm font-medium truncate">{colleague.fullName}</p>
                      <p className="text-xs md:text-sm text-muted-foreground truncate">{colleague.email}</p>
                      {colleague.jobTitle && (
                        <p className="text-xs text-muted-foreground truncate">{colleague.jobTitle}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs md:text-sm text-muted-foreground">Нет коллег в отделе</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Password Tab */}
        <TabsContent value="password">
          <Card>
            <CardHeader className="pb-3 md:pb-4">
              <CardTitle className="text-sm md:text-base">Смена пароля</CardTitle>
              <CardDescription className="text-xs md:text-sm">
                Создайте новый надежный пароль
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangePassword} className="space-y-4">
                {passwordErrors.length > 0 && (
                  <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 flex gap-2">
                    <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-destructive">
                      {passwordErrors.map((err, idx) => (
                        <div key={idx}>{err}</div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-2">
                  <Label htmlFor="current-password">Текущий пароль</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="new-password">Новый пароль</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Минимум 8 символов, прописные, строчные буквы и цифры
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="confirm-password">Подтвердите пароль</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>

                <Button
                  type="submit"
                  disabled={changePasswordMutation.isPending}
                  className="w-full"
                >
                  {changePasswordMutation.isPending ? "Сохранение..." : "Изменить пароль"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Contact Admin Tab */}
        <TabsContent value="admin">
          <Card>
            <CardHeader className="pb-3 md:pb-4">
              <CardTitle className="text-sm md:text-base">Связь с администратором</CardTitle>
              <CardDescription className="text-xs md:text-sm">
                Отправьте сообщение администратору системы
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleContactAdmin} className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="contact-subject">Тема</Label>
                  <Input
                    id="contact-subject"
                    value={contactSubject}
                    onChange={(e) => setContactSubject(e.target.value)}
                    placeholder="Например, запрос на изменение должности"
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="contact-message">Сообщение</Label>
                  <Textarea
                    id="contact-message"
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                    placeholder="Опишите вашу проблему или вопрос..."
                    rows={5}
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="contact-attachment">Скриншот (необязательно)</Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label htmlFor="contact-attachment" className="inline-flex min-h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer">
                      <Upload className="mr-2 h-4 w-4" />
                      Выбрать файл
                    </label>
                    <Input
                      id="contact-attachment"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => setContactAttachment(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                    {contactAttachment && (
                      <Button type="button" variant="ghost" size="icon" onClick={() => setContactAttachment(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {contactAttachment && (
                    <p className="text-xs text-muted-foreground">Выбран файл: {contactAttachment.name}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={contactAdminMutation.isPending}
                  className="w-full"
                >
                  {contactAdminMutation.isPending ? "Отправка..." : "Отправить сообщение"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
