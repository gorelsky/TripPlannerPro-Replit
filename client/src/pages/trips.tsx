import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { StickyScrollTable } from "@/components/ui/sticky-scroll-table";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Building2, Plus, Trash2, Search, Calendar as CalendarIcon, Send, MapPin, Wallet, X, ExternalLink, FileText, MoreHorizontal, Pencil } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format, addDays } from "date-fns";
import { ru } from "date-fns/locale";
import { statusLabels, getStatusColor } from "@/lib/status-utils";
import { formatDateShort, getTripDuration } from "@/lib/date-utils";
import type { TripStatus, City, User, InsertTrip, TripWithDetails, Route, DailyAllowance, TransportType, Holiday, TripType, TripMemoType } from "@shared/schema";

type MemoKind = "unplanned" | "cancel" | "reschedule" | "change";
type UnplannedScenario = "new" | "reschedule";

export default function Trips() {
  const { user: currentUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [periodStart, setPeriodStart] = useState<Date>();
  const [periodEnd, setPeriodEnd] = useState<Date>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<TripWithDetails | null>(null);
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [routeSearch, setRouteSearch] = useState("");
  const [showRouteDropdown, setShowRouteDropdown] = useState(false);
  const [formData, setFormData] = useState({
    cityId: "",
    routeId: "",
    transportType: "car" as TransportType,
    purpose: "",
    trivioBookingNumber: "",
    trivioBookingUrl: "",
    tripType: "planned" as TripType,
    unplannedReason: "",
  });
  const [memoDialog, setMemoDialog] = useState<{ trip: TripWithDetails; kind: MemoKind } | null>(null);
  const [memoFields, setMemoFields] = useState({ reason: "", place: "", travelCost: "", accommodationCost: "", otherCost: "", newStartDate: "", newEndDate: "", newPurpose: "" });
  const [isGeneratingMemo, setIsGeneratingMemo] = useState(false);
  const [unplannedScenario, setUnplannedScenario] = useState<UnplannedScenario>("new");
  const [sourceTripId, setSourceTripId] = useState("");

  const transportLabels: Record<TransportType, string> = {
    car: "Авто",
    train: "Ж/Д",
    plane: "Авиа",
  };
  const { toast } = useToast();

  const isAdminOrDeputy = currentUser?.role === "admin" || currentUser?.role === "deputy_ceo";
  
  const { data: trips = [], isLoading: tripsLoading } = useQuery<TripWithDetails[]>({
    queryKey: currentUser?.department ? ["/api/trips", { department: currentUser.department }] : ["/api/trips"],
    queryFn: async () => {
      const url = isAdminOrDeputy 
        ? "/api/trips" 
        : `/api/trips?department=${encodeURIComponent(currentUser?.department || "")}`;
      const res = await fetch(url);
      return res.json();
    },
    enabled: !!currentUser,
  });

  const { data: cities = [] } = useQuery<City[]>({
    queryKey: ["/api/cities"],
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: currentUser?.department ? ["/api/users", { department: currentUser.department }] : ["/api/users"],
    queryFn: async () => {
      const url = isAdminOrDeputy 
        ? "/api/users" 
        : `/api/users?department=${encodeURIComponent(currentUser?.department || "")}`;
      const res = await fetch(url);
      return res.json();
    },
  });

  const { data: routes = [] } = useQuery<Route[]>({
    queryKey: ["/api/routes"],
  });

  const { data: allowance } = useQuery<DailyAllowance>({
    queryKey: ["/api/daily-allowance"],
  });

  const { data: holidaysList = [] } = useQuery<Holiday[]>({
    queryKey: ["/api/holidays"],
  });

  const holidayDatesSet = new Set(holidaysList.map(h => h.date));
  const isNonWorkingDay = (date: Date) => {
    const day = date.getDay();
    return day === 0 || day === 6 || holidayDatesSet.has(format(date, "yyyy-MM-dd"));
  };
  const nonWorkingDayModifiers = { nonWorkingDay: isNonWorkingDay };
  const nonWorkingDayClassNames = {
    nonWorkingDay: "bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/35",
  };

  const getRouteDistance = (cityName: string): string | null => {
    const route = routes.find(r => r.cities.includes(cityName));
    return route ? route.distance : null;
  };

  const filteredRoutes = routeSearch.trim()
    ? routes.filter(route =>
        route.path.toLowerCase().includes(routeSearch.toLowerCase())
      )
    : routes;

  const calculateDailyAllowance = (start: Date | string | undefined, end: Date | string | undefined, transportType: TransportType): number => {
    if (!start || !end) return 0;
    const s = typeof start === "string" ? start : start.toISOString().slice(0, 10);
    const e = typeof end === "string" ? end : end.toISOString().slice(0, 10);
    const days = getTripDuration(s, e);
    if (days === 1 && transportType === "car") return 0;
    const perNight = parseInt(allowance?.amountPerNight || "1700");
    return days * perNight;
  };

  const createMutation = useMutation({
    mutationFn: (data: InsertTrip) => apiRequest("POST", "/api/trips", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      setIsDialogOpen(false);
      resetForm();
      toast({
        title: "Успешно",
        description: "Командировка создана",
      });
    },
    onError: (error: any) => {
      const rawMessage = error?.message || "";
      const responseBody = rawMessage.replace(/^\d+:\s*/, "");
      let message = "Не удалось создать командировку";
      try {
        message = JSON.parse(responseBody).error || message;
      } catch {
        message = responseBody || message;
      }
      toast({
        title: "Ошибка",
        description: message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: InsertTrip }) => apiRequest("PATCH", `/api/trips/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      setIsDialogOpen(false);
      resetForm();
      setEditingTrip(null);
      toast({ title: "Успешно", description: "Черновик обновлен" });
    },
    onError: (error: any) => {
      const rawMessage = error?.message || "";
      const responseBody = rawMessage.replace(/^\d+:\s*/, "");
      let message = "Не удалось обновить черновик";
      try {
        message = JSON.parse(responseBody).error || message;
      } catch {
        message = responseBody || message;
      }
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/trips/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      toast({
        title: "Успешно",
        description: "Командировка удалена",
      });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось удалить командировку",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({ cityId: "", routeId: "", transportType: "car", purpose: "", trivioBookingNumber: "", trivioBookingUrl: "", tripType: "planned", unplannedReason: "" });
    setUnplannedScenario("new");
    setSourceTripId("");
    setStartDate(undefined);
    setEndDate(undefined);
    setRouteSearch("");
    setShowRouteDropdown(false);
  };

  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<TripStatus | null>(null);

  const isWorkDay = (date: Date) => {
    return !isNonWorkingDay(date);
  };

  const hasNonWorkingDays = (start: Date, end: Date) => {
    let current = new Date(start);
    while (current <= end) {
      if (!isWorkDay(current)) return true;
      current.setDate(current.getDate() + 1);
    }
    return false;
  };

  const handleSubmit = (status: TripStatus, force = false) => {
    if (!currentUser || !formData.routeId || !startDate || !endDate || !formData.purpose.trim() || (formData.tripType === "unplanned" && (!formData.unplannedReason.trim() || (unplannedScenario === "reschedule" && !sourceTripId)))) {
      toast({
        title: "Ошибка",
        description: "Заполните все обязательные поля, включая основание внеплановой поездки и исходную командировку при переносе",
        variant: "destructive",
      });
      return;
    }

    if (!force && hasNonWorkingDays(startDate, endDate)) {
      setPendingStatus(status);
      setIsConfirmDialogOpen(true);
      return;
    }

    const tripData: InsertTrip = {
      employeeId: currentUser.id,
      cityId: formData.cityId || undefined,
      routeId: formData.routeId,
      transportType: formData.transportType,
      startDate: format(startDate, "yyyy-MM-dd"),
      endDate: format(endDate, "yyyy-MM-dd"),
      purpose: formData.purpose,
      trivioBookingNumber: formData.trivioBookingNumber.trim() || undefined,
      trivioBookingUrl: formData.trivioBookingUrl.trim() || undefined,
      tripType: formData.tripType,
      status,
    };
    if (formData.tripType === "unplanned") {
      tripData.unplannedReason = formData.unplannedReason.trim();
      tripData.memoType = (unplannedScenario === "reschedule" ? "reschedule" : "unplanned") as TripMemoType;
      if (unplannedScenario === "reschedule") tripData.sourceTripId = sourceTripId;
    }
    if (editingTrip) {
      updateMutation.mutate({ id: editingTrip.id, data: tripData });
      return;
    }
    createMutation.mutate(tripData);
  };

  const filteredTrips = trips.filter(trip => {
    // В разделе "Мои командировки" отображаем ТОЛЬКО личные командировки пользователя
    if (trip.employeeId !== currentUser?.id) return false;

    const tripStart = new Date(trip.startDate);
    const tripEnd = new Date(trip.endDate);

    if (periodStart && tripEnd < periodStart) return false;
    if (periodEnd && tripStart > periodEnd) return false;

    const matchesSearch = 
      trip.route.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      trip.purpose.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || trip.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const sourceTrips = trips
    .filter((trip) => trip.employeeId === currentUser?.id && trip.status !== "rejected" && trip.status !== "rescheduling")
    .sort((first, second) => first.startDate.localeCompare(second.startDate));

  const openMemoDialog = (trip: TripWithDetails, kind: MemoKind, initialReason?: string) => {
    setMemoFields({
      reason: (initialReason ?? trip.unplannedReason) || "",
      place: "",
      travelCost: "",
      accommodationCost: "",
      otherCost: "",
      newStartDate: kind === "reschedule" ? trip.startDate : "",
      newEndDate: kind === "reschedule" ? trip.endDate : "",
      newPurpose: "",
    });
    setMemoDialog({ trip, kind });
  };

  const startReschedule = (trip: TripWithDetails) => {
    resetForm();
    setFormData((current) => ({ ...current, tripType: "unplanned" }));
    setUnplannedScenario("reschedule");
    setSourceTripId(trip.id);
    setIsDialogOpen(true);
  };

  const startEditDraft = (trip: TripWithDetails) => {
    resetForm();
    setEditingTrip(trip);
    setFormData({
      cityId: trip.cityId || "",
      routeId: trip.routeId,
      transportType: trip.transportType,
      purpose: trip.purpose,
      trivioBookingNumber: trip.trivioBookingNumber || "",
      trivioBookingUrl: trip.trivioBookingUrl || "",
      tripType: trip.tripType,
      unplannedReason: trip.unplannedReason || "",
    });
    setUnplannedScenario(trip.memoType === "reschedule" ? "reschedule" : "new");
    setSourceTripId(trip.sourceTripId || "");
    setStartDate(new Date(`${trip.startDate}T00:00:00`));
    setEndDate(new Date(`${trip.endDate}T00:00:00`));
    setRouteSearch(trip.route.path);
    setIsDialogOpen(true);
  };

  const downloadMemo = async () => {
    if (!memoDialog) return;
    if (memoDialog.kind === "reschedule" && (!memoFields.newStartDate || !memoFields.newEndDate)) {
      toast({ title: "Укажите новые даты", description: "Для служебной записки о переносе нужны обе новые даты.", variant: "destructive" });
      return;
    }
    setIsGeneratingMemo(true);
    try {
      const response = await apiRequest("POST", `/api/trips/${memoDialog.trip.id}/memo`, { kind: memoDialog.kind, ...memoFields });
      const blob = await response.blob();
      const contentDisposition = response.headers.get("Content-Disposition") || "";
      const encodedName = /filename\*=UTF-8''([^;]+)/.exec(contentDisposition)?.[1];
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = encodedName ? decodeURIComponent(encodedName) : "Служебная_записка.docx";
      link.click();
      URL.revokeObjectURL(link.href);
      setMemoDialog(null);
    } catch (error: any) {
      toast({ title: "Не удалось сформировать документ", description: error.message, variant: "destructive" });
    } finally {
      setIsGeneratingMemo(false);
    }
  };

  const memoTitle: Record<MemoKind, string> = {
    unplanned: "СЗ на внеплановую командировку",
    cancel: "СЗ на отмену командировки",
    reschedule: "СЗ на перенос командировки",
    change: "СЗ на изменение условий командировки",
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">Мои командировки</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Управление вашими командировками
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            resetForm();
            setEditingTrip(null);
          }
        }}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto" data-testid="button-add-trip">
              <Plus className="h-4 w-4 mr-2" />
              Создать командировку
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-2xl overflow-y-auto p-4 sm:max-h-[calc(100dvh-3rem)] sm:p-6">
            <DialogHeader>
              <DialogTitle>{editingTrip ? "Редактировать черновик" : "Создать командировку"}</DialogTitle>
              <DialogDescription>
                {editingTrip ? "Скорректируйте данные и сохраните черновик или отправьте его на согласование" : "Заполните информацию о планируемой командировке"}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2 relative">
                <Label htmlFor="trip-route">Маршрут *</Label>
                <div className="relative">
                  <Input
                    id="trip-route"
                    placeholder="Введите маршрут (например, красн...)"
                    value={routeSearch}
                    onChange={(e) => {
                      setRouteSearch(e.target.value);
                      setShowRouteDropdown(true);
                    }}
                    onFocus={() => setShowRouteDropdown(true)}
                    data-testid="input-trip-route"
                  />
                  {showRouteDropdown && (
                    <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-950 border rounded-md shadow-lg max-h-60 overflow-y-auto">
                      {filteredRoutes.length > 0 ? (
                        filteredRoutes.map((route) => (
                          <button
                            key={route.id}
                            className="w-full text-left px-3 py-2 hover:bg-muted cursor-pointer text-sm flex justify-between items-center"
                            onClick={() => {
                              setFormData({ ...formData, routeId: route.id });
                              setRouteSearch(route.path);
                              setShowRouteDropdown(false);
                            }}
                            type="button"
                            data-testid={`option-route-${route.id}`}
                          >
                            <span>{route.path}</span>
                            <span className="text-xs text-muted-foreground">{route.distance}</span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Маршруты не найдены
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="trip-transport">Вид транспорта *</Label>
                <Select 
                  value={formData.transportType} 
                  onValueChange={(value) => setFormData({ ...formData, transportType: value as TransportType })}
                >
                  <SelectTrigger id="trip-transport" data-testid="select-trip-transport">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(transportLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="trip-type">Тип командировки *</Label>
                <Select value={formData.tripType} onValueChange={(value) => {
                  setFormData({ ...formData, tripType: value as TripType });
                  if (value !== "unplanned") {
                    setUnplannedScenario("new");
                    setSourceTripId("");
                  }
                }}>
                  <SelectTrigger id="trip-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planned">Плановая</SelectItem>
                    <SelectItem value="unplanned">Внеплановая</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.tripType === "unplanned" && (
                <div className="grid gap-4 rounded-md border bg-muted/20 p-3">
                  <div className="grid gap-2">
                    <Label htmlFor="unplanned-scenario">Основание создания внеплановой поездки *</Label>
                    <Select value={unplannedScenario} onValueChange={(value) => {
                      setUnplannedScenario(value as UnplannedScenario);
                      setSourceTripId("");
                    }}>
                      <SelectTrigger id="unplanned-scenario"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">Новая внеплановая командировка</SelectItem>
                        <SelectItem value="reschedule">Перенос ранее созданной командировки</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {unplannedScenario === "reschedule" && (
                    <div className="grid gap-2">
                      <Label htmlFor="source-trip">Какую командировку переносим? *</Label>
                      <Select value={sourceTripId} onValueChange={setSourceTripId}>
                        <SelectTrigger id="source-trip"><SelectValue placeholder="Выберите командировку" /></SelectTrigger>
                        <SelectContent>
                          {sourceTrips.length ? sourceTrips.map((trip) => (
                            <SelectItem key={trip.id} value={trip.id}>
                              {trip.route.path} | {formatDateShort(trip.startDate)} - {formatDateShort(trip.endDate)}
                            </SelectItem>
                          )) : <SelectItem value="no-trips" disabled>Подходящих командировок нет</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="grid gap-2">
                    <Label htmlFor="unplanned-reason">
                      {unplannedScenario === "reschedule" ? "Причина переноса *" : "Обоснование внеплановой командировки *"}
                    </Label>
                    <Textarea
                      id="unplanned-reason"
                      value={formData.unplannedReason}
                      onChange={(event) => setFormData({ ...formData, unplannedReason: event.target.value })}
                      placeholder={unplannedScenario === "reschedule" ? "Укажите причину переноса" : "Укажите обстоятельства, требующие срочного выезда"}
                      rows={3}
                    />
                  </div>
                </div>
              )}

              <Button variant="outline" className="w-full justify-start" asChild>
                <a
                  href="https://login.trivio.ru/?toUrl=/desktop/info"
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-4 w-4" />
                  Подобрать билеты и проживание в Trivio
                </a>
              </Button>
              <p className="-mt-2 text-xs text-muted-foreground">
                Откроется в новой вкладке: Ж/Д, авиа и размещение.
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="trivio-booking-number">Номер бронирования Trivio</Label>
                  <Input
                    id="trivio-booking-number"
                    value={formData.trivioBookingNumber}
                    onChange={(event) => setFormData({ ...formData, trivioBookingNumber: event.target.value })}
                    placeholder="Например, TRV-12345"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="trivio-booking-url">Ссылка на бронирование Trivio</Label>
                  <Input
                    id="trivio-booking-url"
                    type="url"
                    value={formData.trivioBookingUrl}
                    onChange={(event) => setFormData({ ...formData, trivioBookingUrl: event.target.value })}
                    placeholder="https://..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Дата начала *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !startDate && "text-muted-foreground"
                        )}
                        data-testid="button-start-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {startDate ? format(startDate, "d MMMM yyyy", { locale: ru }) : "Выберите дату"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={setStartDate}
                        locale={ru}
                        modifiers={nonWorkingDayModifiers}
                        modifiersClassNames={nonWorkingDayClassNames}
                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="grid gap-2">
                  <Label>Дата окончания *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !endDate && "text-muted-foreground"
                        )}
                        data-testid="button-end-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {endDate ? format(endDate, "d MMMM yyyy", { locale: ru }) : "Выберите дату"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={endDate}
                        onSelect={setEndDate}
                        locale={ru}
                        modifiers={nonWorkingDayModifiers}
                        modifiersClassNames={nonWorkingDayClassNames}
                        disabled={(date) => {
                          const today = new Date(new Date().setHours(0, 0, 0, 0));
                          if (startDate) {
                            return date < startDate;
                          }
                          return date < today;
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="trip-purpose">Цель командировки *</Label>
                <Textarea
                  id="trip-purpose"
                  value={formData.purpose}
                  onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                  placeholder="Опишите цель и задачи командировки..."
                  rows={4}
                  data-testid="input-trip-purpose"
                />
              </div>

              {startDate && endDate && (
                <div className="flex flex-col items-start gap-2 rounded-md border bg-muted/50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Предварительный расчет суточных:</span>
                  </div>
                  <span className="text-lg font-bold text-primary">
                    {calculateDailyAllowance(startDate, endDate, formData.transportType).toLocaleString("ru-RU")} ₽
                  </span>
                </div>
              )}
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button className="w-full sm:w-auto" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Отмена
              </Button>
              <Button 
                className="w-full sm:w-auto"
                variant="outline" 
                onClick={() => handleSubmit("draft")}
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-draft"
              >
                {updateMutation.isPending ? "Сохранение..." : "Сохранить черновик"}
              </Button>
              <Button 
                className="w-full sm:w-auto"
                onClick={() => handleSubmit("pending")}
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-submit-trip"
              >
                <Send className="h-4 w-4 mr-2" />
                {createMutation.isPending || updateMutation.isPending ? "Отправка..." : "Отправить на согласование"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Внимание</AlertDialogTitle>
              <AlertDialogDescription>
                Командировка выпадает на нерабочий день. Все верно?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingStatus(null)}>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                if (pendingStatus) handleSubmit(pendingStatus, true);
                setIsConfirmDialogOpen(false);
              }}>
                Да, всё верно
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Список командировок</CardTitle>
              <CardDescription>Всего командировок: {trips.length}</CardDescription>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap lg:w-auto">
              <div className="flex flex-col gap-1 rounded-md border bg-muted/20 p-2 sm:flex-row sm:items-center sm:gap-2 sm:px-2 sm:py-1">
                <CalendarIcon className="hidden h-4 w-4 text-muted-foreground sm:block" />
                <Input
                  type="date"
                  aria-label="Дата начала периода"
                  className="h-8 w-full border-0 bg-transparent p-0 text-xs focus-visible:ring-0 sm:w-36"
                  value={periodStart ? format(periodStart, "yyyy-MM-dd") : ""}
                  onChange={(e) => setPeriodStart(e.target.value ? new Date(e.target.value) : undefined)}
                />
                <span className="hidden text-muted-foreground sm:block">—</span>
                <Input
                  type="date"
                  aria-label="Дата окончания периода"
                  className="h-8 w-full border-0 bg-transparent p-0 text-xs focus-visible:ring-0 sm:w-36"
                  value={periodEnd ? format(periodEnd, "yyyy-MM-dd") : ""}
                  onChange={(e) => setPeriodEnd(e.target.value ? new Date(e.target.value) : undefined)}
                />
                {(periodStart || periodEnd) && (
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-full sm:h-6 sm:w-6" 
                    onClick={() => { setPeriodStart(undefined); setPeriodEnd(undefined); }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40" data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все статусы</SelectItem>
                  {Object.entries(statusLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-trips"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {tripsLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <StickyScrollTable maxHeight="calc(100vh - 360px)">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="text-xs md:text-sm">Маршрут</TableHead>
                  <TableHead className="text-xs md:text-sm hidden sm:table-cell">Транспорт</TableHead>
                  <TableHead className="text-xs md:text-sm hidden md:table-cell">Расстояние</TableHead>
                  <TableHead className="text-xs md:text-sm">Даты</TableHead>
                  <TableHead className="text-xs md:text-sm hidden lg:table-cell">Длительность</TableHead>
                  <TableHead className="text-xs md:text-sm hidden xl:table-cell">Суточные</TableHead>
                  <TableHead className="text-xs md:text-sm hidden 2xl:table-cell">Цель</TableHead>
                  <TableHead className="text-xs md:text-sm">Статус</TableHead>
                  <TableHead className="text-xs md:text-sm text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTrips.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 md:h-32 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <Building2 className="h-8 md:h-12 w-8 md:w-12 mb-2 md:mb-3 opacity-20" />
                        <p className="text-xs md:text-sm">
                          {searchQuery || statusFilter !== "all" ? "Ничего не найдено" : "Командировок пока нет"}
                        </p>
                        {!searchQuery && statusFilter === "all" && (
                          <p className="text-xs mt-1">Создайте первую командировку</p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTrips.map((trip) => {
                    const distance = trip.route.distance;
                    const routePath = trip.route.path;
                    return (
                      <TableRow key={trip.id} className="hover-elevate">
                        <TableCell className="text-xs md:text-sm font-medium">
                          <span className="font-bold text-primary truncate">{routePath}</span>
                          {trip.tripType === "unplanned" && <Badge variant="outline" className="ml-2 border-amber-500 text-[10px] text-amber-700">Внеплановая</Badge>}
                          {trip.memoType === "reschedule" && <Badge variant="outline" className="ml-2 border-sky-500 text-[10px] text-sky-700">Перенос</Badge>}
                          {(trip.trivioBookingNumber || trip.trivioBookingUrl) && (
                            <div className="mt-1 flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                              <span>Trivio{trip.trivioBookingNumber ? `: ${trip.trivioBookingNumber}` : ""}</span>
                              {trip.trivioBookingUrl && (
                                <a
                                  href={trip.trivioBookingUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex text-primary hover:underline"
                                  aria-label="Открыть бронирование Trivio"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs md:text-sm hidden sm:table-cell">
                          <Badge variant="outline" className="text-[9px] md:text-xs">{transportLabels[trip.transportType]}</Badge>
                        </TableCell>
                        <TableCell className="text-xs md:text-sm hidden md:table-cell">
                          {distance ? (
                            <div className="flex items-center gap-1">
                              <MapPin className="h-3 w-3 text-muted-foreground" />
                              <span className="font-mono">{distance}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs md:text-sm text-muted-foreground font-mono">
                          {formatDateShort(trip.startDate)} - {formatDateShort(trip.endDate)}
                        </TableCell>
                        <TableCell className="text-xs md:text-sm hidden lg:table-cell">
                          {getTripDuration(trip.startDate, trip.endDate)} дн.
                        </TableCell>
                        <TableCell className="text-xs md:text-sm font-medium hidden xl:table-cell">
                          <div className="flex items-center gap-1">
                            <Wallet className="h-3 w-3 text-muted-foreground" />
                            {calculateDailyAllowance(trip.startDate, trip.endDate, trip.transportType).toLocaleString("ru-RU")} ₽
                          </div>
                        </TableCell>
                        <TableCell className="text-xs md:text-sm hidden 2xl:table-cell max-w-xs">
                          <p className="line-clamp-2">{trip.purpose}</p>
                        </TableCell>
                        <TableCell className="text-xs md:text-sm">
                          <Badge variant="secondary" className={cn(getStatusColor(trip.status), "text-[9px] md:text-xs")}>
                            {statusLabels[trip.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs md:text-sm text-right">
                          <div className="flex justify-end gap-1">
                    {trip.tripType === "unplanned" && <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 gap-1 px-2" aria-label="Служебные записки">
                          <FileText className="h-3.5 w-3.5" />
                          СЗ
                        </Button>
                      </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {trip.tripType === "unplanned" && (
                                  <DropdownMenuItem onClick={() => openMemoDialog(trip, "unplanned")}>
                                    <FileText /> СЗ на внеплановую
                                  </DropdownMenuItem>
                                )}
                                {trip.memoType === "reschedule" && (
                                  <DropdownMenuItem onClick={() => openMemoDialog(trip, "reschedule")}>
                                    <FileText /> СЗ на перенос
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                    }
                    {trip.status === "draft" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 px-2"
                        onClick={() => startEditDraft(trip)}
                        aria-label="Редактировать черновик"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Редактировать
                      </Button>
                    ) : !(["rescheduling", "rejected"] as TripStatus[]).includes(trip.status) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 gap-1 px-2" aria-label="Действия с командировкой">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                            Действия
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => startReschedule(trip)}>
                            <CalendarIcon /> Перенести командировку
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openMemoDialog(trip, "change")}>
                            <FileText /> Изменить условия
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openMemoDialog(trip, "cancel")}>
                            <X /> Отменить командировку
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteMutation.mutate(trip.id)}
                              disabled={deleteMutation.isPending || trip.status === "approved"}
                              data-testid={`button-delete-trip-${trip.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            </StickyScrollTable>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(memoDialog)} onOpenChange={(open) => !open && setMemoDialog(null)}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{memoDialog ? memoTitle[memoDialog.kind] : "Служебная записка"}</DialogTitle>
            <DialogDescription>ФИО, маршрут и исходные даты будут подставлены в ваш шаблон автоматически.</DialogDescription>
          </DialogHeader>
          {memoDialog?.kind === "unplanned" && (
            <div className="grid gap-4 py-2">
              <div className="grid gap-2"><Label>Обоснование внеплановой поездки</Label><Textarea value={memoFields.reason} onChange={(event) => setMemoFields({ ...memoFields, reason: event.target.value })} rows={3} /></div>
              <div className="grid gap-2"><Label>Место пребывания</Label><Input value={memoFields.place} onChange={(event) => setMemoFields({ ...memoFields, place: event.target.value })} placeholder="Организация, подразделение или объект" /></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="grid gap-2"><Label>Проезд</Label><Input value={memoFields.travelCost} onChange={(event) => setMemoFields({ ...memoFields, travelCost: event.target.value })} placeholder="Сумма" /></div>
                <div className="grid gap-2"><Label>Проживание</Label><Input value={memoFields.accommodationCost} onChange={(event) => setMemoFields({ ...memoFields, accommodationCost: event.target.value })} placeholder="Сумма" /></div>
                <div className="grid gap-2"><Label>Прочее</Label><Input value={memoFields.otherCost} onChange={(event) => setMemoFields({ ...memoFields, otherCost: event.target.value })} placeholder="Сумма" /></div>
              </div>
            </div>
          )}
          {memoDialog?.kind === "cancel" && <div className="grid gap-2 py-2"><Label>Причина отмены</Label><Textarea value={memoFields.reason} onChange={(event) => setMemoFields({ ...memoFields, reason: event.target.value })} rows={4} /></div>}
          {memoDialog?.kind === "reschedule" && (
            <div className="grid gap-4 py-2">
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                Новые даты командировки: <span className="font-medium">{memoDialog && formatDateShort(memoDialog.trip.startDate)} - {memoDialog && formatDateShort(memoDialog.trip.endDate)}</span>
              </div>
              <div className="grid gap-2"><Label>Причина переноса</Label><Textarea value={memoFields.reason} onChange={(event) => setMemoFields({ ...memoFields, reason: event.target.value })} rows={4} /></div>
            </div>
          )}
          {memoDialog?.kind === "change" && (
            <div className="grid gap-4 py-2">
              <div className="grid gap-2"><Label>Новое направление</Label><Input value={memoFields.place} onChange={(event) => setMemoFields({ ...memoFields, place: event.target.value })} placeholder="Город, регион" /></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-2"><Label>Новая дата начала</Label><Input type="date" value={memoFields.newStartDate} onChange={(event) => setMemoFields({ ...memoFields, newStartDate: event.target.value })} /></div>
                <div className="grid gap-2"><Label>Новая дата окончания</Label><Input type="date" value={memoFields.newEndDate} onChange={(event) => setMemoFields({ ...memoFields, newEndDate: event.target.value })} /></div>
              </div>
              <div className="grid gap-2"><Label>Изменение цели командировки</Label><Textarea value={memoFields.newPurpose} onChange={(event) => setMemoFields({ ...memoFields, newPurpose: event.target.value })} rows={3} /></div>
              <div className="grid gap-2"><Label>Причина изменения</Label><Textarea value={memoFields.reason} onChange={(event) => setMemoFields({ ...memoFields, reason: event.target.value })} rows={3} /></div>
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button className="w-full sm:w-auto" variant="outline" onClick={() => setMemoDialog(null)}>Отмена</Button>
            <Button className="w-full sm:w-auto" onClick={downloadMemo} disabled={isGeneratingMemo}>
              <FileText /> {isGeneratingMemo ? "Формирование..." : "Скачать Word"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
