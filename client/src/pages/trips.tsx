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
import { Building2, Plus, Trash2, Search, Calendar as CalendarIcon, Send, MapPin, Wallet, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import type { TripStatus, City, User, InsertTrip, TripWithDetails, Route, DailyAllowance, TransportType, Holiday } from "@shared/schema";

export default function Trips() {
  const { user: currentUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [periodStart, setPeriodStart] = useState<Date>();
  const [periodEnd, setPeriodEnd] = useState<Date>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [routeSearch, setRouteSearch] = useState("");
  const [showRouteDropdown, setShowRouteDropdown] = useState(false);
  const [formData, setFormData] = useState({
    cityId: "",
    routeId: "",
    transportType: "car" as TransportType,
    purpose: "",
  });

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

  const getRouteDistance = (cityName: string): string | null => {
    const route = routes.find(r => r.cities.includes(cityName));
    return route ? route.distance : null;
  };

  const filteredRoutes = routeSearch.trim()
    ? routes.filter(route =>
        route.path.toLowerCase().includes(routeSearch.toLowerCase())
      )
    : routes;

  const calculateDailyAllowance = (start: Date | string | undefined, end: Date | string | undefined): number => {
    if (!start || !end) return 0;
    const s = new Date(start);
    const e = new Date(end);
    const nights = Math.max(0, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)));
    const perNight = parseInt(allowance?.amountPerNight || "1700");
    return nights * perNight;
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
      const message = error.response?.data?.error || "Не удалось создать командировку";
      toast({
        title: "Ошибка",
        description: message,
        variant: "destructive",
      });
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
    setFormData({ cityId: "", routeId: "", transportType: "car", purpose: "" });
    setStartDate(undefined);
    setEndDate(undefined);
    setRouteSearch("");
    setShowRouteDropdown(false);
  };

  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<TripStatus | null>(null);

  const isWorkDay = (date: Date) => {
    const day = date.getDay();
    const dateStr = format(date, "yyyy-MM-dd");
    return day !== 0 && day !== 6 && !holidayDatesSet.has(dateStr);
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
    if (!currentUser || !formData.routeId || !startDate || !endDate || !formData.purpose.trim()) {
      toast({
        title: "Ошибка",
        description: "Заполните все обязательные поля (Маршрут, Даты, Цель)",
        variant: "destructive",
      });
      return;
    }

    if (!force && hasNonWorkingDays(startDate, endDate)) {
      setPendingStatus(status);
      setIsConfirmDialogOpen(true);
      return;
    }

    createMutation.mutate({
      employeeId: currentUser.id,
      cityId: formData.cityId || undefined,
      routeId: formData.routeId,
      transportType: formData.transportType,
      startDate: format(startDate, "yyyy-MM-dd"),
      endDate: format(endDate, "yyyy-MM-dd"),
      purpose: formData.purpose,
      status,
    });
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Мои командировки</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Управление вашими командировками
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-trip">
              <Plus className="h-4 w-4 mr-2" />
              Создать командировку
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Создать командировку</DialogTitle>
              <DialogDescription>
                Заполните информацию о планируемой командировке
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

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Дата начала *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "justify-start text-left font-normal",
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
                          "justify-start text-left font-normal",
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
                <div className="p-3 bg-muted/50 rounded-md border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Предварительный расчет суточных:</span>
                  </div>
                  <span className="text-lg font-bold text-primary">
                    {calculateDailyAllowance(startDate, endDate).toLocaleString("ru-RU")} ₽
                  </span>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Отмена
              </Button>
              <Button 
                variant="outline" 
                onClick={() => handleSubmit("draft")}
                disabled={createMutation.isPending}
                data-testid="button-save-draft"
              >
                Сохранить черновик
              </Button>
              <Button 
                onClick={() => handleSubmit("pending")}
                disabled={createMutation.isPending}
                data-testid="button-submit-trip"
              >
                <Send className="h-4 w-4 mr-2" />
                {createMutation.isPending ? "Отправка..." : "Отправить на согласование"}
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
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Список командировок</CardTitle>
              <CardDescription>Всего командировок: {trips.length}</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 border rounded-md px-2 py-1 bg-muted/20">
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  className="h-8 w-36 border-0 bg-transparent p-0 focus-visible:ring-0 text-xs"
                  value={periodStart ? format(periodStart, "yyyy-MM-dd") : ""}
                  onChange={(e) => setPeriodStart(e.target.value ? new Date(e.target.value) : undefined)}
                />
                <span className="text-muted-foreground">—</span>
                <Input
                  type="date"
                  className="h-8 w-36 border-0 bg-transparent p-0 focus-visible:ring-0 text-xs"
                  value={periodEnd ? format(periodEnd, "yyyy-MM-dd") : ""}
                  onChange={(e) => setPeriodEnd(e.target.value ? new Date(e.target.value) : undefined)}
                />
                {(periodStart || periodEnd) && (
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6" 
                    onClick={() => { setPeriodStart(undefined); setPeriodEnd(undefined); }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40" data-testid="select-status-filter">
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
              <div className="relative w-64">
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
                            {calculateDailyAllowance(trip.startDate, trip.endDate).toLocaleString("ru-RU")} ₽
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
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(trip.id)}
                            disabled={deleteMutation.isPending || trip.status === "approved"}
                            data-testid={`button-delete-trip-${trip.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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
    </div>
  );
}
