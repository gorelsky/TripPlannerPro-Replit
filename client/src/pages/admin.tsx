import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/auth-context";
import { useLocation } from "wouter";
import { StickyScrollTable } from "@/components/ui/sticky-scroll-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ExcelJS from "exceljs";
import { LogOut, Plus, Trash2, Copy, Download, ArrowRight, Upload, RotateCcw, AlertTriangle, FileUp, Pencil, KeyRound, Mail, MailOpen, Paperclip, ExternalLink, Search } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { roleLabels, roleShortLabels, determineRoleFromJobTitle } from "@/lib/role-utils";
import { TripsReport } from "@/components/trips-report";
import { scrollAppToTop } from "@/lib/scroll-utils";
import type { User, City, UserRole, InsertUser, InsertCity, Route, DailyAllowance, Holiday, InsertHoliday, ContactMessage } from "@shared/schema";

export default function Admin() {
  const { user, logout, switchUser } = useAuth();
  const isCoordinator = user?.role === "coordinator";
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [isSendingCredentials, setIsSendingCredentials] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [routeSearch, setRouteSearch] = useState("");
  const [holidaySearch, setHolidaySearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");

  const matchesSearch = (query: string, ...values: Array<string | null | undefined>) => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
    return !normalizedQuery || values.some((value) =>
      value?.toLocaleLowerCase("ru-RU").includes(normalizedQuery),
    );
  };

  type CredentialBroadcastProgress = {
    status: "idle" | "running" | "completed" | "interrupted";
    total: number;
    sent: number;
    failed: number;
    startedAt?: string;
    completedAt?: string;
  };

  const { data: credentialBroadcast, refetch: refetchCredentialBroadcast } = useQuery<CredentialBroadcastProgress>({
    queryKey: ["/api/users/send-credentials/status"],
  });

  useEffect(() => {
    if (!isSendingCredentials) return;

    if (credentialBroadcast?.status === "completed") {
      setIsSendingCredentials(false);
      toast({
        title: credentialBroadcast.failed > 0 ? "Рассылка завершена с ошибками" : "Рассылка завершена",
        description: credentialBroadcast.failed > 0
          ? `Отправлено: ${credentialBroadcast.sent}. Не отправлено: ${credentialBroadcast.failed}; для них прежние пароли сохранены.`
          : `Отправлено писем: ${credentialBroadcast.sent}.`,
        variant: credentialBroadcast.failed > 0 ? "destructive" : "default",
      });
      return;
    }

    const pollId = window.setTimeout(() => {
      void refetchCredentialBroadcast();
    }, 1500);

    return () => window.clearTimeout(pollId);
  }, [credentialBroadcast, isSendingCredentials, refetchCredentialBroadcast, toast]);

  // ============ USERS ============
  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const sortedUsers = [...users].sort((a, b) =>
    a.fullName.localeCompare(b.fullName, "ru", { sensitivity: "base" })
  );
  const filteredUsers = sortedUsers.filter((user) => matchesSearch(
    userSearch,
    user.fullName,
    user.email,
    user.jobTitle,
    user.department,
    user.managerName,
    users.find((manager) => manager.id === user.managerId)?.fullName,
  ));

  const [newUserDialog, setNewUserDialog] = useState(false);
  const [newUser, setNewUser] = useState({
    fullName: "",
    email: "",
    role: null as UserRole | null,
    managerId: null as string | null,
    department: "",
    homeCityId: null as string | null,
    userType: "employee" as "employee" | "manager",
  });

  const [editUserDialog, setEditUserDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [manualEditDialog, setManualEditDialog] = useState(false);
  const [manualEditingUser, setManualEditingUser] = useState<User | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState<{ userId: string; password: string } | null>(null);
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [passwordResetUser, setPasswordResetUser] = useState<User | null>(null);

  const createUserMutation = useMutation({
    mutationFn: (data: InsertUser) => apiRequest("POST", "/api/users", data),
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setNewUserDialog(false);
      setGeneratedPassword({ userId: response.user.id, password: response.password });
      setNewUser({ fullName: "", email: "", role: null, managerId: null, department: "", homeCityId: null, userType: "employee" });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось создать пользователя",
        variant: "destructive",
      });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<InsertUser> }) => 
      apiRequest("PATCH", `/api/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditUserDialog(false);
      setEditingUser(null);
      toast({ title: "Успешно", description: "Данные пользователя обновлены" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось обновить пользователя", variant: "destructive" });
    }
  });

  const manualUpdateUserMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<InsertUser> }) => apiRequest("PATCH", `/api/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setManualEditDialog(false);
      setManualEditingUser(null);
      toast({ title: "Успешно", description: "Пользователь обновлен" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось сохранить изменения", variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Успешно", description: "Пользователь удален" });
      setDeleteConfirmDialog(false);
      setUserToDelete(null);
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось удалить пользователя", variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/users/${id}/reset-password`, {});
      return response.json() as Promise<{ email: string }>;
    },
    onSuccess: ({ email }) => {
      setPasswordResetUser(null);
      toast({ title: "Пароль сброшен", description: `Новый временный пароль отправлен на ${email}` });
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось сбросить пароль", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateUser = () => {
    if (!newUser.fullName || !newUser.email) {
      toast({
        title: "Ошибка",
        description: "Заполните обязательные поля",
        variant: "destructive",
      });
      return;
    }
    createUserMutation.mutate(newUser);
  };

  const handleUpdateUser = () => {
    if (!editingUser) return;
    if (!editingUser.fullName || !editingUser.email) {
      toast({ title: "Ошибка", description: "Заполните обязательные поля", variant: "destructive" });
      return;
    }
    updateUserMutation.mutate({ 
      id: editingUser.id, 
      data: {
        fullName: editingUser.fullName,
        email: editingUser.email,
        department: editingUser.department,
        userType: editingUser.userType,
        managerId: editingUser.managerId ?? undefined,
        homeCityId: editingUser.homeCityId ?? undefined,
      } 
    });
  };

  const handleManualUpdateUser = () => {
    if (!manualEditingUser) return;
    if (!manualEditingUser.fullName || !manualEditingUser.email) {
      toast({ title: "Ошибка", description: "Заполните обязательные поля", variant: "destructive" });
      return;
    }
    manualUpdateUserMutation.mutate({
      id: manualEditingUser.id,
      data: {
        fullName: manualEditingUser.fullName,
        email: manualEditingUser.email,
        jobTitle: manualEditingUser.jobTitle || undefined,
        department: manualEditingUser.department || undefined,
        userType: manualEditingUser.userType,
        managerId: manualEditingUser.managerId ?? undefined,
        role: manualEditingUser.role ?? undefined,
        homeCityId: manualEditingUser.homeCityId ?? undefined,
      },
    });
  };

  // ============ CITIES ============
  const { data: cities = [], isLoading: citiesLoading } = useQuery<City[]>({
    queryKey: ["/api/cities"],
  });
  const filteredCities = cities.filter((city) => matchesSearch(citySearch, city.name, city.region));

  // ============ ROUTES ============
  const { data: routes = [], isLoading: routesLoading } = useQuery<Route[]>({
    queryKey: ["/api/routes"],
  });

  const sortedRoutes = [...routes].sort((a, b) =>
    a.path.localeCompare(b.path, "ru", { sensitivity: "base" })
  );
  const filteredRoutes = sortedRoutes.filter((route) => matchesSearch(
    routeSearch,
    route.path,
    route.distance,
    route.kilometers,
    route.cities.join(" "),
  ));

  // ============ HOLIDAYS ============
  const { data: dbHolidays = [] } = useQuery<Holiday[]>({
    queryKey: ["/api/holidays"],
  });

  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [newHolidayStart, setNewHolidayStart] = useState("");
  const [newHolidayEnd, setNewHolidayEnd] = useState("");
  const [newHolidayDesc, setNewHolidayDesc] = useState("");
  const filteredHolidays = dbHolidays
    .filter((holiday) => {
      if (periodStart && holiday.date < periodStart) return false;
      if (periodEnd && holiday.date > periodEnd) return false;
      return matchesSearch(holidaySearch, holiday.date, holiday.description);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const [editingHoliday, setEditingHoliday] = useState<Holiday | null>(null);

  const createHolidayMutation = useMutation({
    mutationFn: (data: InsertHoliday) => apiRequest("POST", "/api/holidays", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/holidays"] });
    },
  });

  const updateHolidayMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<InsertHoliday> }) => 
      apiRequest("PATCH", `/api/holidays/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/holidays"] });
      setEditingHoliday(null);
      toast({ title: "Успешно", description: "Праздник обновлен" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось обновить праздник", variant: "destructive" });
    }
  });

  const deleteHolidayMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/holidays/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/holidays"] });
      toast({ title: "Успешно", description: "Праздник удален" });
    },
  });

  const handleAddHoliday = async () => {
    if (!newHolidayStart) return;
    
    const start = new Date(newHolidayStart);
    const end = newHolidayEnd ? new Date(newHolidayEnd) : start;
    
    if (end < start) {
      toast({ title: "Ошибка", description: "Дата окончания не может быть раньше начала", variant: "destructive" });
      return;
    }

    let current = new Date(start);
    const promises = [];
    
    while (current <= end) {
      promises.push(createHolidayMutation.mutateAsync({ 
        date: format(current, "yyyy-MM-dd"), 
        description: newHolidayDesc 
      }));
      current.setDate(current.getDate() + 1);
    }

    try {
      await Promise.all(promises);
      setNewHolidayStart("");
      setNewHolidayEnd("");
      setNewHolidayDesc("");
      toast({ title: "Успешно", description: `Добавлено дней: ${promises.length}` });
    } catch (error: any) {
      toast({ 
        title: "Ошибка", 
        description: "Некоторые даты не удалось добавить (возможно, они уже есть)", 
        variant: "destructive" 
      });
    }
  };

  // ============ DAILY ALLOWANCE ============
  const { data: allowance } = useQuery<DailyAllowance>({
    queryKey: ["/api/daily-allowance"],
  });

  const [allowanceAmount, setAllowanceAmount] = useState("");
  
  useEffect(() => {
    if (allowance) setAllowanceAmount(allowance.amountPerNight);
  }, [allowance]);

  const updateAllowanceMutation = useMutation({
    mutationFn: (amount: string) => apiRequest("POST", "/api/daily-allowance", { amountPerNight: amount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-allowance"] });
      toast({ title: "Успешно", description: "Суточные обновлены" });
    },
  });

  const { data: contactMsgs = [], refetch: refetchMessages } = useQuery<ContactMessage[]>({
    queryKey: ["/api/admin/messages"],
  });
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/admin/messages/unread-count"],
    refetchInterval: 30000,
  });
  const unreadCount = unreadData?.count ?? 0;
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);
  const filteredContactMessages = contactMsgs.filter((message) => matchesSearch(
    messageSearch,
    message.fromUserName,
    message.fromUserEmail,
    message.subject,
    message.message,
  ));

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/admin/messages/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/messages/unread-count"] });
    },
  });

  const clearMessagesMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/admin/messages"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/messages/unread-count"] });
      setExpandedMessageId(null);
      toast({ title: "Успешно", description: "Сообщения очищены" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось очистить сообщения", variant: "destructive" });
    },
  });

  const deleteRouteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/routes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({ title: "Успешно", description: "Маршрут удален" });
    },
  });

  const createRouteMutation = useMutation({
    mutationFn: (route: { path: string; distance: string; cities: string; kilometers: string }) =>
      apiRequest("POST", "/api/routes", {
        path: route.path,
        distance: route.distance,
        cities: route.cities.split(",").map((city) => city.trim()).filter(Boolean),
        kilometers: route.kilometers,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({ title: "Успешно", description: "Маршрут добавлен" });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось добавить маршрут",
        variant: "destructive",
      });
    },
  });

  const handleUploadRoutes = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const buffer = e.target.result;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.worksheets[0];
        
        const routes: any[] = [];
        
        // Parse data rows
        // Порядок колонок: Регион (1) - Маршрут (2) - Км (3)
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return; // Skip header
          
          // Безопасное получение значений ячеек
          const regionCell = row.getCell(1);
          const pathCell = row.getCell(2);
          const kmCell = row.getCell(3);
          
          // Извлекаем значения с правильной обработкой типов
          const region = regionCell && regionCell.value ? String(regionCell.value).trim() : "";
          const path = pathCell && pathCell.value ? String(pathCell.value).trim() : "";
          const kilometers = kmCell && kmCell.value ? String(kmCell.value).trim() : "0";
          
          console.log(`[ROUTES] Row ${rowNumber}: region="${region}", path="${path}", km="${kilometers}"`);
          
          if (!path) {
            console.log(`[ROUTES] Skipping row ${rowNumber}: empty path`);
            return;
          }
          
          try {
            const kmStr = kilometers.replace(/[^\d]/g, ''); // Извлекаем только цифры
            const kmNum = kmStr ? kmStr : "0";
            const distStr = kmNum !== "0" ? `${kmNum} км` : "0 км";
            const citiesArray = path.split(/[-–—]/).map(c => c.trim()).filter(c => c);
            
            console.log(`[ROUTES] Parsed: path="${path}", km="${kmNum}", cities=[${citiesArray.join(", ")}]`);
            
            routes.push({
              path: path,
              distance: distStr,
              cities: citiesArray,
              kilometers: kmNum,
            });
          } catch (rowError) {
            console.error(`[ROUTES] Error parsing row ${rowNumber}:`, rowError);
          }
        });

        console.log(`[ROUTES] Total parsed: ${routes.length} routes`);
        
        if (routes.length === 0) {
          toast({
            title: "Внимание",
            description: "В файле не найдено маршрутов для загрузки",
            variant: "destructive",
          });
          return;
        }
        
        let successCount = 0;
        let errorCount = 0;
        const errors: string[] = [];
        
        const uploadPromises = routes.map(async (route, idx) => {
          try {
            console.log(`[ROUTES] Creating route ${idx + 1}/${routes.length}: "${route.path}"`);
            // Не используем mutateAsync с onSuccess - отправляем напрямую
            const response = await apiRequest("POST", "/api/routes", route);
            console.log(`[ROUTES] Successfully created route:`, response);
            successCount++;
            return response;
          } catch (err: any) {
            const errMsg = err?.response?.data?.error || err?.message || String(err);
            console.error(`[ROUTES] Failed to create route "${route.path}": Status=${err?.response?.status}, Error=${errMsg}`, err);
            errors.push(`${route.path}: ${errMsg}`);
            errorCount++;
            return null;
          }
        });

        await Promise.all(uploadPromises);
        
        // Обновляем кэш ПОСЛЕ всех загрузок
        console.log(`[ROUTES] Upload complete. Invalidating cache...`);
        queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
        
        // Ждем обновления
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const message = errorCount === 0 
          ? `Загружено маршрутов: ${successCount}`
          : `Успешно: ${successCount}, Ошибок: ${errorCount}.\nОшибки:\n${errors.slice(0, 3).join('\n')}`;
        
        toast({
          title: errorCount === 0 ? "Успешно" : "Результат загрузки",
          description: message,
          variant: errorCount > 0 ? "destructive" : "default",
        });
      } catch (error) {
        console.error("[ROUTES] Upload error:", error);
        toast({
          title: "Ошибка",
          description: `Ошибка при загрузке: ${error instanceof Error ? error.message : "Неизвестная ошибка"}`,
          variant: "destructive",
        });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const [newCityDialog, setNewCityDialog] = useState(false);
  const [newCity, setNewCity] = useState({ name: "", region: "" });
  const [newRouteDialog, setNewRouteDialog] = useState(false);
  const [newRoute, setNewRoute] = useState({ path: "", distance: "", cities: "", kilometers: "" });

  const resetTripsMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/reset-trips"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/approvals/pending"] });
      toast({ title: "Успешно", description: "Удалены только командировки" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось сбросить данные", variant: "destructive" });
    },
  });

  const resetAllTripDataMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/reset-all-trip-data"),
    onSuccess: () => {
      [
        "/api/trips",
        "/api/approvals/pending",
        "/api/chat/contacts",
        "/api/chat/unread-count",
        "/api/admin/messages",
        "/api/admin/messages/unread-count",
      ].forEach((queryKey) => queryClient.invalidateQueries({ queryKey: [queryKey] }));
      toast({ title: "Успешно", description: "Командировки, согласования, чаты и обращения удалены" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось удалить данные", variant: "destructive" });
    },
  });

  const createCityMutation = useMutation({
    mutationFn: (data: InsertCity) => apiRequest("POST", "/api/cities", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cities"] });
      setNewCityDialog(false);
      setNewCity({ name: "", region: "" });
      toast({ title: "Успешно", description: "Город добавлен" });
    },
  });

  const deleteCityMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/cities/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cities"] });
      toast({ title: "Успешно", description: "Город удален" });
    },
  });

  const handleCreateCity = () => {
    if (!newCity.name) {
      toast({
        title: "Ошибка",
        description: "Укажите название города",
        variant: "destructive",
      });
      return;
    }
    createCityMutation.mutate(newCity);
  };

  const handleUploadCitiesExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      const buffer = e.target.result;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];
      
      const jsonData: any[] = [];
      const headerRow = worksheet.getRow(1);
      const headers: any[] = [];
      headerRow.eachCell((cell, colNumber) => {
        headers[colNumber] = cell.text.trim();
      });

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header
        const rowData: any = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const header = headers[colNumber];
          if (header) {
            rowData[header] = cell.value;
          }
        });
        jsonData.push(rowData);
      });

      console.log("[CITIES] Parsed JSON data from Excel:", JSON.stringify(jsonData));

      const uploadPromises = jsonData.map((row: any) => {
        const name = row["Город"] || row["City"] || row["name"] || row["Название"] || row["CITY"] || row["NAME"];
        const region = row["Регион"] || row["Region"] || row["region"] || row["REGION"];

        if (name) {
          console.log(`[CITIES] Attempting to create city: ${name} (${region})`);
          return createCityMutation.mutateAsync({
            name: String(name).trim(),
            region: region ? String(region).trim() : undefined,
          });
        }
        console.warn("[CITIES] Skipping row without city name:", JSON.stringify(row));
        return Promise.resolve();
      });

      try {
        await Promise.all(uploadPromises);
        queryClient.invalidateQueries({ queryKey: ["/api/cities"] });
        toast({ title: "Успешно", description: `Загружено городов: ${uploadPromises.length}` });
      } catch (error: any) {
        const message = error.response?.data?.error || "Не удалось загрузить некоторые города";
        toast({
          title: "Ошибка",
          description: message,
          variant: "destructive",
        });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleUploadUsersExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      const buffer = e.target.result;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];
      
      const jsonData: any[] = [];
      const headerRow = worksheet.getRow(1);
      const headers: any[] = [];
      headerRow.eachCell((cell, colNumber) => {
        headers[colNumber] = cell.text.trim();
      });

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const rowData: any = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const header = headers[colNumber];
          if (header) {
            rowData[header] = cell.value;
          }
        });
        jsonData.push(rowData);
      });

      console.log("[USERS] Parsed JSON data from Excel:", JSON.stringify(jsonData));
      if (jsonData.length > 0) {
        console.log("[USERS] First row keys:", Object.keys(jsonData[0]));
        console.log("[USERS] First row full data:", JSON.stringify(jsonData[0]));
      }

      try {
        // ШАГЕ 1: Удаляем old non-admin пользователей перед загрузкой нового файла
        console.log("[USERS] Step 1: Clearing old users...");
        await apiRequest("POST", "/api/users/clear-old", {});
        console.log("[USERS] Step 2: Creating upload promises for new users...");
        
        // ШАГЕ 2: ПОТОМ создаем promises для загрузки новых пользователей
        const uploadPromises = jsonData.map((row: any) => {
          const fullName = row["ФИО"] || row["Full Name"] || row["fullName"];
          const email = row["Email"] || row["email"] || row["EMail"] || row["E-mail"] || row["EMAIL"];
          const department = row["Отдел"] || row["Department"] || row["department"] || row["Подразделение"];
          const managerName = row["Руководитель"] || row["Manager"] || row["manager"];
          const jobTitle = row["Роль"] || row["Role"] || row["role"] || row["должность"] || row["Должность"] || 
                          row["Профессия"] || row["Специальность"] || row["Должностью"];
          
          // Читаем тип пользователя из столбца "Тип" или "Статус"
          let userTypeStr = row["Тип"] || row["Статус"] || row["Status"] || row["Type"] || "Сотрудник";
          userTypeStr = String(userTypeStr).trim().toLowerCase();

          if (!fullName || !email) {
            console.warn("[USERS] Skipping row without required fields (fullName/email):", JSON.stringify(row));
            return Promise.resolve();
          }

          // Определяем userType: сначала из столбца "Тип", потом по jobTitle
          let userType: "employee" | "manager" = "employee";
          
          // Приоритет 1: Явное значение в столбце "Тип"
          if (userTypeStr.includes("руководитель") || userTypeStr === "manager") {
            userType = "manager";
            console.log(`[USERS] ${fullName}: userType=manager (из столбца Тип)`);
          } 
          // Приоритет 2: Вычисляем из jobTitle + department если "Тип" не заполнен
          else if (!userTypeStr || userTypeStr === "сотрудник" || userTypeStr === "employee") {
            const jobLower = jobTitle ? String(jobTitle).trim().toLowerCase() : "";
            const deptLower = department ? String(department).trim().toLowerCase() : "";
            
            if (jobLower.includes("директор") || jobLower.includes("начальник") || jobLower.includes("глава")) {
              userType = "manager";
              console.log(`[USERS] ${fullName}: userType=manager (из jobTitle: директор/начальник/глава)`);
            } else if (jobLower.includes("менеджер") && !jobLower.includes("представитель")) {
              userType = "manager";
              console.log(`[USERS] ${fullName}: userType=manager (из jobTitle: менеджер)`);
            } else {
              userType = "employee";
            }
          }
          
          console.log(`[USERS] Parsed: ${fullName}, jobTitle="${jobTitle}", dept="${department}", userType="${userType}"`);

          // Determine role from jobTitle
          const determinedRole = determineRoleFromJobTitle(jobTitle ? String(jobTitle).trim() : undefined);
          
          console.log(`[USERS] Uploading: ${fullName} (${email}), jobTitle="${jobTitle}", role="${determinedRole}", dept="${department}", userType="${userType}", manager="${managerName || 'none'}"`);
          return apiRequest("POST", "/api/users", {
            fullName: String(fullName).trim(),
            email: String(email).trim(),
            role: determinedRole,
            jobTitle: jobTitle ? String(jobTitle).trim() : undefined,
            userType,
            department: department ? String(department).trim() : undefined,
            managerName: managerName ? String(managerName).trim() : undefined,
          });
        });
        
        // ШАГЕ 3: Загружаем всех новых пользователей
        console.log("[USERS] Step 3: Uploading all users...");
        await Promise.all(uploadPromises);
        queryClient.invalidateQueries({ queryKey: ["/api/users"] });
        toast({ title: "Успешно", description: `Загружено сотрудников: ${uploadPromises.length}` });
      } catch (error: any) {
        console.error("[USERS] Batch upload error:", error);
        console.error("[USERS] Error message:", error.message);
        console.error("[USERS] Error type:", typeof error);
        
        // Parse different error formats
        let message = "Не удалось загрузить некоторые записи";
        if (error.message) {
          message = error.message;
        } else if (error.response?.data?.error) {
          message = error.response.data.error;
        }
        
        toast({
          title: "Ошибка",
          description: message,
          variant: "destructive",
        });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ============ EXPORT ============
  const handleExportUsers = () => {
    const csv = [
      ["ФИО", "Email", "Роль", "Отдел", "Руководитель", "Тип"],
      ...sortedUsers.map(u => [
        u.fullName,
        u.email,
        u.jobTitle || "",
        u.department || "",
        users.find(m => m.id === u.managerId)?.fullName || "",
        u.userType === "manager" ? "Руководитель" : "Сотрудник",
      ]),
    ].map(row => row.join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `users_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const handleExportCities = () => {
    const csv = [
      ["Город", "Регион"],
      ...cities.map(c => [c.name, c.region || ""]),
    ].map(row => row.join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `cities_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Панель администратора</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Управление пользователями и справочниками системы
          </p>
        </div>
        <Button
          variant="outline"
          onClick={logout}
          data-testid="button-logout"
          className="w-full sm:w-auto"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Выход
        </Button>
      </div>

      {generatedPassword && (
        <Card className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
          <CardHeader>
            <CardTitle className="text-green-900 dark:text-green-100">Пользователь создан успешно</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-green-200 dark:border-green-800">
              <p className="text-sm text-muted-foreground mb-2">Временный пароль:</p>
              <p className="font-mono text-lg font-bold text-green-700 dark:text-green-300 mb-4">{generatedPassword.password}</p>
              <p className="text-sm text-muted-foreground mb-4">Скопируйте этот пароль и отправьте пользователю. Пароль сохранен только в этом сообщении.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(generatedPassword.password);
                  toast({
                    title: "Скопировано",
                    description: "Пароль скопирован в буфер обмена",
                  });
                }}
                data-testid="button-copy-password"
              >
                <Copy className="h-4 w-4 mr-2" />
                Скопировать пароль
              </Button>
            </div>
            <Button
              onClick={() => setGeneratedPassword(null)}
              className="w-full"
            >
              Закрыть
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="users" className="w-full" onValueChange={scrollAppToTop}>
        <div className="sticky top-0 z-40 bg-background pb-3 -mx-4 px-4 pt-1 border-b mb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <TabsList className="grid h-auto w-full grid-cols-2 items-stretch gap-1 p-1 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10">
            <TabsTrigger value="users" className="min-w-0 whitespace-normal break-words px-2 py-2 text-xs leading-tight sm:text-sm">Пользователи</TabsTrigger>
            <TabsTrigger value="cities" className="min-w-0 whitespace-normal break-words px-2 py-2 text-xs leading-tight sm:text-sm">Города</TabsTrigger>
            <TabsTrigger value="routes" className="min-w-0 whitespace-normal break-words px-2 py-2 text-xs leading-tight sm:text-sm">Маршруты</TabsTrigger>
            <TabsTrigger value="holidays" className="min-w-0 whitespace-normal break-words px-2 py-2 text-xs leading-tight sm:text-sm">Праздники</TabsTrigger>
            {!isCoordinator && <TabsTrigger value="allowance" className="min-w-0 whitespace-normal break-words px-2 py-2 text-xs leading-tight sm:text-sm">Суточные</TabsTrigger>}
            <TabsTrigger value="report" className="min-w-0 whitespace-normal break-words px-2 py-2 text-xs leading-tight sm:text-sm">Реестр</TabsTrigger>
            {!isCoordinator && <TabsTrigger value="credentials" className="min-w-0 whitespace-normal break-words px-2 py-2 text-xs leading-tight sm:text-sm">Рассылка</TabsTrigger>}
            <TabsTrigger value="testing" className="min-w-0 whitespace-normal break-words px-2 py-2 text-xs leading-tight sm:text-sm">Тест</TabsTrigger>
            {!isCoordinator && <TabsTrigger value="messages" className="relative min-w-0 whitespace-normal break-words px-2 py-2 text-xs leading-tight sm:text-sm">
              Сообщения
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs rounded-full h-4 w-4 flex items-center justify-center font-bold">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </TabsTrigger>}
            {!isCoordinator && <TabsTrigger value="danger" className="min-w-0 whitespace-normal break-words px-2 py-2 text-xs leading-tight text-destructive sm:text-sm">Опасно</TabsTrigger>}
          </TabsList>
        </div>

        {/* ============ USERS TAB ============ */}
        <TabsContent value="users" className="space-y-4">
          <Dialog open={editUserDialog} onOpenChange={setEditUserDialog}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Редактировать пользователя</DialogTitle>
                <DialogDescription>
                  Измените данные сотрудника ниже
                </DialogDescription>
              </DialogHeader>
              {editingUser && (
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>ФИО *</Label>
                    <Input
                      value={editingUser.fullName}
                      onChange={(e) => setEditingUser({ ...editingUser, fullName: e.target.value })}
                      placeholder="Иван Иванов"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Email *</Label>
                    <Input
                      type="email"
                      value={editingUser.email}
                      onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                      placeholder="ivan@company.ru"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Отдел</Label>
                    <Select 
                      value={editingUser.department || ""} 
                      onValueChange={(value) => setEditingUser({ ...editingUser, department: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите отдел" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Отдел продаж">Отдел продаж</SelectItem>
                        <SelectItem value="Коммерческий отдел">Коммерческий отдел</SelectItem>
                        <SelectItem value="Отдел маркетинга">Отдел маркетинга</SelectItem>
                        <SelectItem value="Другие отделы">Другие отделы</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Тип</Label>
                    <Select 
                      value={editingUser.userType || "employee"} 
                      onValueChange={(value) => setEditingUser({ ...editingUser, userType: value as "employee" | "manager" })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="employee">Сотрудник</SelectItem>
                        <SelectItem value="manager">Руководитель</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Руководитель</Label>
                    <Select 
                      value={editingUser.managerId || "none"} 
                      onValueChange={(id) => setEditingUser({ ...editingUser, managerId: id === "none" ? null : id })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите руководителя" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Нет</SelectItem>
                        {sortedUsers
                          .filter(u => u.userType === "manager" && u.id !== editingUser.id)
                          .map(u => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.fullName}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Город проживания</Label>
                    <Select value={editingUser.homeCityId || "none"} onValueChange={(id) => setEditingUser({ ...editingUser, homeCityId: id === "none" ? null : id })}>
                      <SelectTrigger><SelectValue placeholder="Не выбран" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Не выбран</SelectItem>
                        {[...cities].sort((first, second) => first.name.localeCompare(second.name, "ru")).map((city) => (
                          <SelectItem key={city.id} value={city.id}>{city.name}{city.region ? ` - ${city.region}` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditUserDialog(false)}>
                  Отмена
                </Button>
                <Button onClick={handleUpdateUser} disabled={updateUserMutation.isPending}>
                  Сохранить
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={manualEditDialog} onOpenChange={setManualEditDialog}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Ручное исправление сотрудника</DialogTitle>
                <DialogDescription>
                  Исправьте тип, руководителя, отдел и должность вручную
                </DialogDescription>
              </DialogHeader>
              {manualEditingUser && (
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>ФИО *</Label>
                    <Input
                      value={manualEditingUser.fullName}
                      onChange={(e) => setManualEditingUser({ ...manualEditingUser, fullName: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Email *</Label>
                    <Input
                      type="email"
                      value={manualEditingUser.email}
                      onChange={(e) => setManualEditingUser({ ...manualEditingUser, email: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Должность</Label>
                    <Input
                      value={manualEditingUser.jobTitle || ""}
                      onChange={(e) => setManualEditingUser({ ...manualEditingUser, jobTitle: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Отдел</Label>
                    <Input
                      value={manualEditingUser.department || ""}
                      onChange={(e) => setManualEditingUser({ ...manualEditingUser, department: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Тип</Label>
                    <Select value={manualEditingUser.userType || "employee"} onValueChange={(value) => setManualEditingUser({ ...manualEditingUser, userType: value as "employee" | "manager" })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="employee">Сотрудник</SelectItem>
                        <SelectItem value="manager">Руководитель</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Руководитель</Label>
                    <Select value={manualEditingUser.managerId || "none"} onValueChange={(id) => setManualEditingUser({ ...manualEditingUser, managerId: id === "none" ? null : id })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Нет" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Нет</SelectItem>
                        {sortedUsers
                          .filter(u => u.id !== manualEditingUser.id)
                          .map(u => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.fullName}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Город проживания</Label>
                    <Select value={manualEditingUser.homeCityId || "none"} onValueChange={(id) => setManualEditingUser({ ...manualEditingUser, homeCityId: id === "none" ? null : id })}>
                      <SelectTrigger><SelectValue placeholder="Не выбран" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Не выбран</SelectItem>
                        {[...cities].sort((first, second) => first.name.localeCompare(second.name, "ru")).map((city) => (
                          <SelectItem key={city.id} value={city.id}>{city.name}{city.region ? ` - ${city.region}` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setManualEditDialog(false)}>
                  Отмена
                </Button>
                <Button onClick={handleManualUpdateUser} disabled={manualUpdateUserMutation.isPending}>
                  Сохранить
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Card>
            <CardHeader className="flex flex-col items-stretch gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle>Управление пользователями</CardTitle>
                <CardDescription>Добавление, удаление и управление учетными записями</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <FileUp className="h-4 w-4 mr-2" />
                      Загрузить Excel
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Загрузка сотрудников из Excel</DialogTitle>
                      <DialogDescription>
                        Выберите Excel файл (.xlsx) со списком сотрудников.
                        <div className="mt-4 p-3 bg-muted rounded-md text-xs space-y-2">
                          <p className="font-semibold">Требуемый формат колонок:</p>
                          <ul className="list-disc pl-4 space-y-1">
                            <li><strong>ФИО</strong> (обязательно)</li>
                            <li><strong>Email</strong> (обязательно)</li>
                            <li><strong>Роль</strong> (например: МП, ТМ, ДОП, Директор отдела продаж, КАМ)</li>
                            <li><strong>Отдел</strong> (например: Отдел продаж)</li>
                            <li><strong>Руководитель</strong> (ФИО существующего пользователя)</li>
                          </ul>
                          <p className="text-muted-foreground italic">Заголовки должны быть в первой строке.</p>
                        </div>
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <Input
                        type="file"
                        accept=".xlsx"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadUsersExcel(file);
                        }}
                      />
                    </div>
                  </DialogContent>
                </Dialog>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportUsers}
                  data-testid="button-export-users"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Экспорт CSV
                </Button>
                <Dialog open={newUserDialog} onOpenChange={setNewUserDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-add-user">
                      <Plus className="h-4 w-4 mr-2" />
                      Добавить
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Добавить пользователя</DialogTitle>
                      <DialogDescription>
                        Пароль будет сгенерирован автоматически и показан после создания
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label>ФИО *</Label>
                        <Input
                          value={newUser.fullName}
                          onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })}
                          placeholder="Иван Иванов"
                          data-testid="input-user-fullname"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Email *</Label>
                        <Input
                          type="email"
                          value={newUser.email}
                          onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                          placeholder="ivan@company.ru"
                          data-testid="input-user-email"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Отдел</Label>
                        <Select value={newUser.department} onValueChange={(value) => setNewUser({ ...newUser, department: value })}>
                          <SelectTrigger data-testid="select-user-department">
                            <SelectValue placeholder="Выберите отдел" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Отдел продаж">Отдел продаж</SelectItem>
                            <SelectItem value="Коммерческий отдел">Коммерческий отдел</SelectItem>
                            <SelectItem value="Отдел маркетинга">Отдел маркетинга</SelectItem>
                            <SelectItem value="Другие отделы">Другие отделы</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Тип</Label>
                        <Select value={newUser.userType || "employee"} onValueChange={(value) => setNewUser({ ...newUser, userType: value as "employee" | "manager" })}>
                          <SelectTrigger data-testid="select-user-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="employee">Сотрудник</SelectItem>
                            <SelectItem value="manager">Руководитель</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Руководитель</Label>
                        <Select value={newUser.managerId || "none"} onValueChange={(id) => setNewUser({ ...newUser, managerId: id === "none" ? null : id })}>
                          <SelectTrigger data-testid="select-user-manager">
                            <SelectValue placeholder="Выберите руководителя" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Нет</SelectItem>
                            {sortedUsers
                              .filter(u => u.userType === "manager")
                              .map(u => (
                                <SelectItem key={u.id} value={u.id}>
                                  {u.fullName}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Город проживания</Label>
                        <Select value={newUser.homeCityId || "none"} onValueChange={(id) => setNewUser({ ...newUser, homeCityId: id === "none" ? null : id })}>
                          <SelectTrigger><SelectValue placeholder="Не выбран" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Не выбран</SelectItem>
                            {[...cities].sort((first, second) => first.name.localeCompare(second.name, "ru")).map((city) => (
                              <SelectItem key={city.id} value={city.id}>{city.name}{city.region ? ` - ${city.region}` : ""}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setNewUserDialog(false)}>
                        Отмена
                      </Button>
                      <Button onClick={handleCreateUser} disabled={createUserMutation.isPending}>
                        Создать
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="relative mb-3 max-w-xl">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="search"
                      value={userSearch}
                      onChange={(event) => setUserSearch(event.target.value)}
                      placeholder="Поиск по ФИО, email, отделу или руководителю"
                      className="pl-9"
                      data-testid="input-search-users"
                    />
                  </div>
                  <StickyScrollTable>
                    <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead className="text-xs md:text-sm">ФИО</TableHead>
                        <TableHead className="text-xs md:text-sm">Email</TableHead>
                        <TableHead className="text-xs md:text-sm hidden sm:table-cell">Должность</TableHead>
                        <TableHead className="text-xs md:text-sm hidden md:table-cell">Отдел</TableHead>
                        <TableHead className="text-xs md:text-sm">Тип</TableHead>
                        <TableHead className="text-xs md:text-sm hidden lg:table-cell">Руководитель</TableHead>
                        <TableHead className="text-xs md:text-sm">Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">Ничего не найдено</TableCell>
                        </TableRow>
                      ) : filteredUsers.map(u => (
                        <TableRow key={u.id}>
                          <TableCell className="text-xs md:text-sm font-medium truncate">{u.fullName}</TableCell>
                          <TableCell className="text-xs md:text-sm text-muted-foreground truncate">{u.email}</TableCell>
                          <TableCell className="text-xs md:text-sm hidden sm:table-cell truncate">{u.jobTitle || "—"}</TableCell>
                          <TableCell className="text-xs md:text-sm hidden md:table-cell truncate">{u.department || "—"}</TableCell>
                          <TableCell className="text-xs md:text-sm">
                            <Badge variant="secondary" className="text-[10px] md:text-xs">{u.userType === "manager" ? "РУК" : "СОТ"}</Badge>
                          </TableCell>
                          <TableCell className="text-xs md:text-sm hidden lg:table-cell truncate">
                            {users.find(m => m.id === u.managerId)?.fullName || u.managerName || "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setManualEditingUser(u);
                                  setManualEditDialog(true);
                                }}
                                data-testid={`button-edit-user-${u.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {!isCoordinator && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setPasswordResetUser(u)}
                                  disabled={resetPasswordMutation.isPending}
                                  title="Сбросить пароль"
                                  aria-label={`Сбросить пароль: ${u.fullName}`}
                                  data-testid={`button-reset-password-${u.id}`}
                                >
                                  <KeyRound className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setUserToDelete(u);
                                  setDeleteConfirmDialog(true);
                                }}
                                disabled={deleteUserMutation.isPending}
                                data-testid={`button-delete-user-${u.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    </Table>
                  </StickyScrollTable>
                </>
              )}
            </CardContent>
          </Card>

          {/* Delete Confirmation Dialog */}
          <AlertDialog open={deleteConfirmDialog} onOpenChange={setDeleteConfirmDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Удалить пользователя?</AlertDialogTitle>
                <AlertDialogDescription>
                  Вы действительно хотите удалить пользователя <strong>{userToDelete?.fullName}</strong> ({userToDelete?.email})?
                  <br />
                  Это действие нельзя отменить.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (userToDelete) {
                      deleteUserMutation.mutate(userToDelete.id);
                    }
                  }}
                  disabled={deleteUserMutation.isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-confirm-delete"
                >
                  {deleteUserMutation.isPending ? "Удаление..." : "Удалить"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog
            open={Boolean(passwordResetUser)}
            onOpenChange={(open) => {
              if (!open && !resetPasswordMutation.isPending) setPasswordResetUser(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Сбросить пароль?</AlertDialogTitle>
                <AlertDialogDescription>
                  Для пользователя <strong>{passwordResetUser?.fullName}</strong> будет создан новый временный пароль и отправлен только на {passwordResetUser?.email}. Прежний пароль перестанет действовать лишь после успешной отправки письма.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={resetPasswordMutation.isPending}>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => passwordResetUser && resetPasswordMutation.mutate(passwordResetUser.id)}
                  disabled={resetPasswordMutation.isPending}
                  data-testid="button-confirm-reset-password"
                >
                  {resetPasswordMutation.isPending ? "Отправка..." : "Сбросить и отправить"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        {/* ============ CITIES TAB ============ */}
        <TabsContent value="cities" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-col items-stretch gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle>Управление городами</CardTitle>
                <CardDescription>Справочник городов для командировок</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportCities}
                  data-testid="button-export-cities"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Экспорт CSV
                </Button>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    className="hidden"
                    id="city-upload"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUploadCitiesExcel(file);
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <label htmlFor="city-upload" className="cursor-pointer">
                      <FileUp className="h-4 w-4 mr-2" />
                      Загрузить Excel
                    </label>
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".xlsx";
                    input.onchange = (e: any) => handleUploadCitiesExcel(e.target.files[0]);
                    input.click();
                  }}
                  data-testid="button-upload-cities"
                >
                  <FileUp className="h-4 w-4 mr-2" />
                  Загрузить XLSX
                </Button>
                <Dialog open={newCityDialog} onOpenChange={setNewCityDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-add-city">
                      <Plus className="h-4 w-4 mr-2" />
                      Добавить
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Добавить город</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label>Название *</Label>
                        <Input
                          value={newCity.name}
                          onChange={(e) => setNewCity({ ...newCity, name: e.target.value })}
                          placeholder="Москва"
                          data-testid="input-city-name"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Регион</Label>
                        <Input
                          value={newCity.region}
                          onChange={(e) => setNewCity({ ...newCity, region: e.target.value })}
                          placeholder="Московская область"
                          data-testid="input-city-region"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setNewCityDialog(false)}>
                        Отмена
                      </Button>
                      <Button onClick={handleCreateCity} disabled={createCityMutation.isPending}>
                        Добавить
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {citiesLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="relative mb-3 max-w-xl">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="search"
                      value={citySearch}
                      onChange={(event) => setCitySearch(event.target.value)}
                      placeholder="Поиск по городу или региону"
                      className="pl-9"
                      data-testid="input-search-cities"
                    />
                  </div>
                  <StickyScrollTable>
                    <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead>Город</TableHead>
                        <TableHead>Регион</TableHead>
                        <TableHead>Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCities.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">Ничего не найдено</TableCell>
                        </TableRow>
                      ) : filteredCities.map(c => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{c.region || "—"}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteCityMutation.mutate(c.id)}
                              disabled={deleteCityMutation.isPending}
                              data-testid={`button-delete-city-${c.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    </Table>
                  </StickyScrollTable>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ ROUTES TAB ============ */}
        <TabsContent value="routes" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-col items-stretch gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle>Управление маршрутами</CardTitle>
                <CardDescription>Загрузите маршруты (Excel: Регион, Маршрут, Км) или добавьте вручную</CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Dialog open={newRouteDialog} onOpenChange={setNewRouteDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-add-route">
                      <Plus className="h-4 w-4 mr-2" />
                      Добавить вручную
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Добавить маршрут</DialogTitle>
                      <DialogDescription>Укажите путь, расстояние и города через запятую</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="route-path">Маршрут *</Label>
                        <Input
                          id="route-path"
                          value={newRoute.path}
                          onChange={(e) => setNewRoute({ ...newRoute, path: e.target.value })}
                          placeholder="Москва - Владимир - Москва"
                          data-testid="input-route-path"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="route-distance">Расстояние *</Label>
                          <Input
                            id="route-distance"
                            value={newRoute.distance}
                            onChange={(e) => setNewRoute({ ...newRoute, distance: e.target.value })}
                            placeholder="346 км"
                            data-testid="input-route-distance"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="route-kilometers">Километры</Label>
                          <Input
                            id="route-kilometers"
                            value={newRoute.kilometers}
                            onChange={(e) => setNewRoute({ ...newRoute, kilometers: e.target.value })}
                            placeholder="346"
                            data-testid="input-route-kilometers"
                          />
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="route-cities">Города *</Label>
                        <Textarea
                          id="route-cities"
                          value={newRoute.cities}
                          onChange={(e) => setNewRoute({ ...newRoute, cities: e.target.value })}
                          placeholder="Москва, Владимир, Москва"
                          data-testid="textarea-route-cities"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setNewRouteDialog(false)} data-testid="button-cancel-route">
                        Отмена
                      </Button>
                      <Button
                        onClick={() => createRouteMutation.mutate(newRoute)}
                        disabled={createRouteMutation.isPending}
                        data-testid="button-save-route"
                      >
                        Добавить
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".xlsx,.xls,.csv";
                    input.onchange = (e: any) => handleUploadRoutes(e.target.files[0]);
                    input.click();
                  }}
                  data-testid="button-upload-routes"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Загрузить CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative mb-3 max-w-xl">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={routeSearch}
                  onChange={(event) => setRouteSearch(event.target.value)}
                  placeholder="Поиск по маршруту, городу или расстоянию"
                  className="pl-9"
                  data-testid="input-search-routes"
                />
              </div>
              {routesLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : filteredRoutes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">{routes.length === 0 ? "Маршруты еще не добавлены" : "Ничего не найдено"}</p>
              ) : (
                <div className="space-y-2">
                  {filteredRoutes.map(route => (
                    <div key={route.id} className="flex items-center justify-between p-3 border rounded-md">
                      <div>
                        <p className="font-medium text-sm">{route.path}</p>
                        <p className="text-xs text-muted-foreground">{route.distance}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteRouteMutation.mutate(route.id)}
                        data-testid={`button-delete-route-${route.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ DAILY ALLOWANCE TAB ============ */}
        {/* ============ HOLIDAYS TAB ============ */}
        <TabsContent value="holidays" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-col items-stretch gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <CardTitle>Праздничные дни</CardTitle>
                <CardDescription>Управление праздниками и выходными для корректного расчета командировок</CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2 border rounded-md px-2 py-1 bg-muted/20">
                  <Input
                    type="date"
                    className="h-8 w-36 border-0 bg-transparent p-0 focus-visible:ring-0 text-xs"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                  />
                  <span className="text-muted-foreground">—</span>
                  <Input
                    type="date"
                    className="h-8 w-36 border-0 bg-transparent p-0 focus-visible:ring-0 text-xs"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                  />
                  {(periodStart || periodEnd) && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6" 
                      onClick={() => { setPeriodStart(""); setPeriodEnd(""); }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Добавить дату
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Добавить праздник</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>С даты *</Label>
                          <Input 
                            type="date" 
                            value={newHolidayStart} 
                            onChange={(e) => setNewHolidayStart(e.target.value)} 
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label>По дату</Label>
                          <Input 
                            type="date" 
                            value={newHolidayEnd} 
                            onChange={(e) => setNewHolidayEnd(e.target.value)} 
                            placeholder="Оставьте пустым для одного дня"
                          />
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label>Описание</Label>
                        <Input 
                          value={newHolidayDesc} 
                          onChange={(e) => setNewHolidayDesc(e.target.value)} 
                          placeholder="Название праздника" 
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={handleAddHoliday} disabled={createHolidayMutation.isPending}>
                        Добавить
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative mb-3 max-w-xl">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={holidaySearch}
                  onChange={(event) => setHolidaySearch(event.target.value)}
                  placeholder="Поиск по дате или описанию"
                  className="pl-9"
                  data-testid="input-search-holidays"
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Описание</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredHolidays.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">Ничего не найдено</TableCell>
                    </TableRow>
                  ) : filteredHolidays.map((holiday) => (
                      <TableRow key={holiday.id}>
                        <TableCell className="font-mono">
                          {format(new Date(holiday.date), "dd.MM.yyyy", { locale: ru })}
                        </TableCell>
                        <TableCell>{holiday.description}</TableCell>
                        <TableCell className="text-right space-x-2">
                          <Dialog open={editingHoliday?.id === holiday.id} onOpenChange={(open) => !open && setEditingHoliday(null)}>
                            <DialogTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => setEditingHoliday(holiday)}
                              >
                                Исправить
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Редактировать праздник</DialogTitle>
                              </DialogHeader>
                              <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                  <Label>Дата</Label>
                                  <Input 
                                    type="date" 
                                    defaultValue={holiday.date}
                                    onChange={(e) => setEditingHoliday(prev => prev ? { ...prev, date: e.target.value } : null)}
                                  />
                                </div>
                                <div className="grid gap-2">
                                  <Label>Описание</Label>
                                  <Input 
                                    defaultValue={holiday.description || ""}
                                    onChange={(e) => setEditingHoliday(prev => prev ? { ...prev, description: e.target.value } : null)}
                                  />
                                </div>
                              </div>
                              <DialogFooter>
                                <Button variant="outline" onClick={() => setEditingHoliday(null)}>Отмена</Button>
                                <Button onClick={() => {
                                  if (editingHoliday) {
                                    updateHolidayMutation.mutate({ 
                                      id: holiday.id, 
                                      data: { date: editingHoliday.date, description: editingHoliday.description } 
                                    });
                                  }
                                }}>
                                  Сохранить
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteHolidayMutation.mutate(holiday.id)}
                            disabled={deleteHolidayMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="allowance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Норма суточных</CardTitle>
              <CardDescription>Укажите сумму суточных выплат за одну ночь в командировке</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-4 max-w-sm">
                <div className="grid gap-2 flex-1">
                  <Label htmlFor="allowance-amount">Сумма за сутки (руб.)</Label>
                  <Input
                    id="allowance-amount"
                    type="number"
                    value={allowanceAmount || allowance?.amountPerNight || "1700"}
                    onChange={(e) => setAllowanceAmount(e.target.value)}
                    data-testid="input-allowance-amount"
                  />
                </div>
                <Button 
                  onClick={() => updateAllowanceMutation.mutate(allowanceAmount || allowance?.amountPerNight || "1700")}
                  disabled={updateAllowanceMutation.isPending}
                  data-testid="button-save-allowance"
                >
                  {updateAllowanceMutation.isPending ? "Сохранение..." : "Сохранить"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ TESTING TAB ============ */}
        <TabsContent value="testing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Переключение между сотрудниками</CardTitle>
              <CardDescription>
                Выберите сотрудника для проверки работы приложения с его ролью
              </CardDescription>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sortedUsers.map((u) => (
                    <Card key={u.id} className="flex flex-col gap-3 p-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{u.fullName}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <div className="flex gap-2 mt-1 flex-wrap items-start">
                        {u.role && (
                          <Badge variant="secondary" className="text-xs whitespace-normal">
                            {roleLabels[u.role as UserRole]}
                          </Badge>
                        )}
                        {u.jobTitle && (
                          <Badge variant="outline" className="text-xs whitespace-normal break-words max-w-xs">
                            {u.jobTitle}
                          </Badge>
                        )}
                        {u.department && (
                          <Badge variant="outline" className="text-xs whitespace-normal">
                            {u.department}
                          </Badge>
                        )}
                      </div>
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={async () => {
                          try {
                            setSwitchingTo(u.id);
                            await switchUser(u.id);
                            setLocation("/");
                            toast({
                              title: "Успешно",
                              description: `Переключились на ${u.fullName}`,
                            });
                          } catch (error: any) {
                            toast({
                              title: "Ошибка",
                              description: error.message || "Не удалось переключиться",
                              variant: "destructive",
                            });
                          } finally {
                            setSwitchingTo(null);
                          }
                        }}
                        disabled={switchingTo === u.id}
                        data-testid={`button-switch-to-${u.id}`}
                      >
                        {switchingTo === u.id ? (
                          "Переключение..."
                        ) : (
                          <>
                            <ArrowRight className="h-3 w-3 mr-1" />
                            Войти
                          </>
                        )}
                      </Button>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ TRIPS REPORT TAB ============ */}
        <TabsContent value="report" className="space-y-4">
          <TripsReport />
        </TabsContent>

        {/* ============ SEND CREDENTIALS TAB ============ */}
        <TabsContent value="credentials">
          <Card>
            <CardHeader>
              <CardTitle>Рассылка запуска тестирования и учетных данных</CardTitle>
              <CardDescription>
                Отправить объявление о тестовом периоде, ссылку на приложение, логин и временный пароль
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 border rounded-lg bg-muted">
                  <p className="text-sm font-medium mb-2">Как это работает:</p>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Кнопка ниже отправит персональное письмо всем пользователям, кроме администраторов</li>
                    <li>В письме будут сроки тестового периода, ссылка на приложение, email и временный пароль</li>
                    <li>Пароль изменится только для тех писем, которые принял почтовый сервер</li>
                    <li>Пользователи смогут войти и сменить пароль в личном кабинете</li>
                  </ul>
                </div>
                <Button
                  onClick={() => {
                    if (window.confirm("Вы уверены? Всем пользователям будут отправлены объявление о тестовом периоде и новые временные пароли.")) {
                      apiRequest("POST", "/api/users/send-credentials", {})
                        .then(async (response) => {
                          const result = await response.json() as { progress: CredentialBroadcastProgress };
                          queryClient.setQueryData(["/api/users/send-credentials/status"], result.progress);
                          setIsSendingCredentials(true);
                          toast({
                            title: "Рассылка запущена",
                            description: `Писем в очереди: ${result.progress.total}. Интервал между письмами - 5 секунд.`,
                          });
                        })
                        .catch((err) => {
                          setIsSendingCredentials(false);
                          toast({
                            title: "Ошибка",
                            description: err.response?.data?.error || "Не удалось отправить письма",
                            variant: "destructive",
                          });
                        });
                    }
                  }}
                  className="w-full"
                  disabled={isSendingCredentials || credentialBroadcast?.status === "running"}
                >
                  <FileUp className="h-4 w-4 mr-2" />
                  {credentialBroadcast?.status === "running" ? "Выполняется рассылка..." : "Отправить письмо о запуске всем"}
                </Button>
                {credentialBroadcast?.status === "running" && (
                  <p className="text-sm text-muted-foreground text-center" aria-live="polite">
                    Рассылка выполняется: {credentialBroadcast.sent + credentialBroadcast.failed} из {credentialBroadcast.total}. Успешно: {credentialBroadcast.sent}. Ошибок: {credentialBroadcast.failed}.
                  </p>
                )}
                {credentialBroadcast?.status === "completed" && (
                  <p className="text-sm text-center" aria-live="polite">
                    Последняя рассылка завершена: успешно {credentialBroadcast.sent} из {credentialBroadcast.total}; ошибок: {credentialBroadcast.failed}.
                  </p>
                )}
                {credentialBroadcast?.status === "interrupted" && (
                  <p className="text-sm text-destructive text-center" aria-live="polite">
                    Последняя рассылка была прервана перезапуском сервера: успешно {credentialBroadcast.sent} из {credentialBroadcast.total}; ошибок: {credentialBroadcast.failed}. Не запускайте её повторно, пока не уточним получателей.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ MESSAGES TAB ============ */}
        <TabsContent value="messages" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>Сообщения от пользователей</CardTitle>
                  {unreadCount > 0 && (
                    <Badge variant="destructive">{unreadCount} непрочитанных</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="default" onClick={() => refetchMessages()}>
                    Обновить
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="default"
                        disabled={clearMessagesMutation.isPending || contactMsgs.length === 0}
                        data-testid="button-clear-messages"
                      >
                        Очистить сообщения
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Очистить все сообщения?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Это удалит все сообщения пользователей без возможности восстановления.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground"
                          onClick={() => clearMessagesMutation.mutate()}
                        >
                          Очистить
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              <CardDescription>
                Сообщения, отправленные пользователями через кнопку «Написать администратору»
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative mb-3 max-w-xl">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={messageSearch}
                  onChange={(event) => setMessageSearch(event.target.value)}
                  placeholder="Поиск по отправителю, email, теме или тексту"
                  className="pl-9"
                  data-testid="input-search-contact-messages"
                />
              </div>
              {filteredContactMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <Mail className="h-10 w-10 opacity-30" />
                  <p>{contactMsgs.length === 0 ? "Нет сообщений" : "Ничего не найдено"}</p>
                </div>
              ) : (
                <StickyScrollTable maxHeight="calc(100vh - 420px)">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Дата</TableHead>
                        <TableHead>От кого</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Тема</TableHead>
                        <TableHead className="w-32">Статус</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredContactMessages.map((msg) => (
                        <>
                          <TableRow
                            key={msg.id}
                            className={`cursor-pointer ${msg.isRead === "false" ? "font-semibold" : "text-muted-foreground"}`}
                            onClick={() => {
                              setExpandedMessageId(expandedMessageId === msg.id ? null : msg.id);
                              if (msg.isRead === "false") {
                                markReadMutation.mutate(msg.id);
                              }
                            }}
                            data-testid={`row-message-${msg.id}`}
                          >
                            <TableCell>
                              {msg.isRead === "false"
                                ? <Mail className="h-4 w-4 text-destructive" />
                                : <MailOpen className="h-4 w-4 text-muted-foreground" />
                              }
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {format(new Date(msg.createdAt), "dd.MM.yyyy HH:mm", { locale: ru })}
                            </TableCell>
                            <TableCell className="font-medium">{msg.fromUserName}</TableCell>
                            <TableCell className="text-sm">{msg.fromUserEmail}</TableCell>
                            <TableCell>{msg.subject}</TableCell>
                            <TableCell>
                              {msg.isRead === "false"
                                ? <Badge variant="destructive" className="no-default-active-elevate text-xs">Новое</Badge>
                                : <Badge variant="secondary" className="no-default-active-elevate text-xs">Прочитано</Badge>
                              }
                            </TableCell>
                          </TableRow>
                          {expandedMessageId === msg.id && (
                            <TableRow key={`${msg.id}-expanded`}>
                              <TableCell colSpan={6} className="bg-muted/40 p-4">
                                <div className="space-y-3 text-sm whitespace-pre-wrap leading-relaxed">
                                  {msg.attachmentUrl && (
                                    <a href={msg.attachmentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-primary underline">
                                      <Paperclip className="h-4 w-4" />
                                      {msg.attachmentName || "Скриншот"}
                                      <ExternalLink className="h-4 w-4" />
                                    </a>
                                  )}
                                  {msg.attachmentUrl && (
                                    <img src={msg.attachmentUrl} alt={msg.attachmentName || "Скриншот"} className="max-w-full rounded-md border" />
                                  )}
                                  <div>{msg.message}</div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      ))}
                    </TableBody>
                  </Table>
                </StickyScrollTable>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ DANGER TAB ============ */}
        <TabsContent value="danger">
          <Card className="border-destructive/20">
            <CardHeader>
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <CardTitle>Опасные операции</CardTitle>
              </div>
              <CardDescription>
                Эти действия необратимы. Пожалуйста, будьте осторожны.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex flex-col gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="font-medium text-destructive">Удалить все данные поездок и переписки</h4>
                    <p className="text-sm text-muted-foreground">Удаляет командировки, согласования, сообщения чата и обращения к администратору. Пользователи и справочники останутся без изменений.</p>
                  </div>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="destructive" size="sm">
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Удалить все
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Удалить все данные поездок и переписки?</DialogTitle>
                        <DialogDescription>
                          Будут безвозвратно удалены командировки, согласования, сообщения чата и обращения к администратору. Пользователи, города, маршруты, праздники и суточные сохранятся.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button variant="destructive" onClick={() => resetAllTripDataMutation.mutate()} disabled={resetAllTripDataMutation.isPending}>
                          Да, удалить все данные
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>

                <div className="flex flex-col gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="font-medium text-destructive">Очистить только командировки</h4>
                    <p className="text-sm text-muted-foreground">Удаляет только командировки. Согласования, чат, обращения к администратору и все справочники сохранятся.</p>
                  </div>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="destructive" size="sm">
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Очистить командировки
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Очистить только командировки?</DialogTitle>
                        <DialogDescription>
                          Будут безвозвратно удалены только записи командировок. Согласования, сообщения чата, обращения к администратору, пользователи и справочники останутся без изменений.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button variant="destructive" onClick={() => resetTripsMutation.mutate()} disabled={resetTripsMutation.isPending}>
                          Да, очистить командировки
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
