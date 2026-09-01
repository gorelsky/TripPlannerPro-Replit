import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Users, Building2, CheckSquare, TrendingUp, Clock, X, MessageCircle } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import type { TripWithDetails, TransportType, User } from "@shared/schema";

const transportLabels: Record<TransportType, string> = {
  car: "Авто",
  train: "Ж/Д",
  plane: "Авиа",
};
import { formatDateShort, getTripDuration } from "@/lib/date-utils";
import { getStatusColor, statusLabels } from "@/lib/status-utils";
import { roleLabels } from "@/lib/role-utils";

type StatsFilter = null | "all" | "pending" | "approved" | "active";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [selectedStats, setSelectedStats] = useState<StatsFilter>(null);
  const [nearestTripNotice, setNearestTripNotice] = useState<TripWithDetails | null>(null);
  const shownTripNoticeForUser = useRef<string | null>(null);
  
  const { data: trips = [], isLoading: tripsLoading } = useQuery<TripWithDetails[]>({
    queryKey: ["/api/trips"],
    enabled: !!user,
  });

  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: !!user,
  });

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<{
    totalTrips: number;
    pendingTrips: number;
    approvedTrips: number;
    activeTrips: number;
    rejectedTrips: number;
    pendingApprovals: number;
  }>({
    queryKey: [`/api/stats/dashboard/${user?.id}`],
    enabled: !!user,
    refetchOnWindowFocus: true,
  });

  const { data: unreadChat = { count: 0 } } = useQuery<{ count: number }>({
    queryKey: ["/api/chat/unread-count"],
    enabled: !!user,
    refetchInterval: 10000,
  });

  const isManager = user && user.role && ["territorial_manager", "commercial_manager", "marketing_director", "sales_director", "commerce_director", "admin", "ceo", "deputy_ceo", "coordinator"].includes(user.role);
  const isCoordinator = user?.role === "coordinator";
  const isAccountant = user?.role === "accountant";
  const canViewAllTrips = user?.role && ["admin", "ceo", "deputy_ceo", "coordinator", "accountant"].includes(user.role);

  // Separate query for trips pending approval — uses server-side logic that correctly handles hierarchy
  const { data: approvalTripsData, isLoading: approvalTripsLoading } = useQuery<TripWithDetails[]>({
    queryKey: ["/api/approvals/pending", user?.id],
    queryFn: async (): Promise<TripWithDetails[]> => {
      if (!user?.id) return [] as TripWithDetails[];
      const res = await fetch(`/api/approvals/pending/${user.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch approval trips");
      const data = await res.json();
      return (data || []) as TripWithDetails[];
    },
    enabled: !!(user && isManager),
  });
  const approvalTrips = approvalTripsData || [];
  const pendingStatuses = ["pending", "manager_approved", "director_approved", "coordinator_review", "deputy_review", "ceo_review", "awaiting_ceo_signature"];
  const confirmedStatuses = ["approved", "planned"];

  // Refetch stats whenever trips change
  useEffect(() => {
    if (trips.length > 0) {
      refetchStats();
    }
  }, [trips, refetchStats]);

  useEffect(() => {
    if (!user || tripsLoading || shownTripNoticeForUser.current === user.id) return;

    const today = new Date().toISOString().slice(0, 10);
    const relevantStatuses = [...pendingStatuses, ...confirmedStatuses];
    const visibleTrips = trips.filter((trip) => {
      const isOwnTrip = trip.employeeId === user.id;
      const canSeeSubordinateTrip = user.userType === "manager";
      return relevantStatuses.includes(trip.status) && trip.endDate >= today && (isOwnTrip || canSeeSubordinateTrip);
    });
    const nearestTrip = visibleTrips.sort((first, second) => {
      const firstIsActive = first.startDate <= today && first.endDate >= today;
      const secondIsActive = second.startDate <= today && second.endDate >= today;
      if (firstIsActive !== secondIsActive) return firstIsActive ? -1 : 1;
      return first.startDate.localeCompare(second.startDate);
    })[0];

    shownTripNoticeForUser.current = user.id;
    if (nearestTrip) setNearestTripNotice(nearestTrip);
  }, [trips, tripsLoading, user]);

  const filteredTrips = canViewAllTrips
    ? trips
    : trips.filter((trip) => trip.employeeId === user?.id);

  const recentTrips = filteredTrips.slice(0, 5);

  // Функция расчета суточных
  const calculateAllowance = (startDate: string, endDate: string, transportType: TransportType) => {
    const days = getTripDuration(startDate, endDate);
    if (days === 1 && transportType === "car") return 0;
    const amountPerDay = 1700;
    return days * amountPerDay;
  };

  // Получаем отфильтрованные командировки для модального окна
  let displayTrips: TripWithDetails[] = [];
  let modalTitle = "";

  if (selectedStats === "all") {
    displayTrips = trips;
    modalTitle = `Всего командировок (${stats?.totalTrips || 0})`;
  } else if (selectedStats === "pending") {
    if (isManager) {
      displayTrips = approvalTrips;
      modalTitle = `Требуют согласования (${stats?.pendingApprovals || 0})`;
    } else {
      displayTrips = trips.filter(t => t.status === "pending");
      modalTitle = `На согласовании (${stats?.pendingTrips || 0})`;
    }
  } else if (selectedStats === "approved") {
    displayTrips = trips.filter(t => confirmedStatuses.includes(t.status));
    modalTitle = `Утверждено (${stats?.approvedTrips || 0})`;
  } else if (selectedStats === "active") {
    const today = new Date();
    displayTrips = trips.filter(t => {
      const startDate = new Date(t.startDate);
      const endDate = new Date(t.endDate);
      return confirmedStatuses.includes(t.status) && startDate <= today && endDate >= today;
    });
    modalTitle = `Активных командировок (${displayTrips.length})`;
  }

  // Trips pending approval — fetched from server-side endpoint that correctly handles hierarchy
  const pendingTripsToApprove = approvalTrips.filter((trip) =>
    trip.approvals?.some((approval) => approval.approverId === user?.id && approval.status === "pending"),
  );

  // User's own pending trips (for everyone)
  const myPendingTrips = trips.filter(t => t.employeeId === user?.id && pendingStatuses.includes(t.status));

  // User's own rejected trips (for everyone, including managers)
  const myRejectedTrips = trips.filter(t => t.employeeId === user?.id && t.status === "rejected");

  const todayStr = new Date().toISOString().split("T")[0];
  const usersById = new Map(users.map((u) => [u.id, u]));
  const managerPlanMap = new Map<string, {
    id: string;
    name: string;
    department: string | null;
    plannedTrips: number;
    activeTrips: number;
    upcomingTrips: number;
    pendingTrips: number;
    approvedTrips: number;
    totalDays: number;
    employeeIds: Set<string>;
    nextTripDate: string | null;
  }>();

  trips
    .filter((trip) => trip.status !== "rejected" && trip.endDate >= todayStr)
    .forEach((trip) => {
      const employee = trip.employee || usersById.get(trip.employeeId);
      const manager = employee?.managerId ? usersById.get(employee.managerId) : undefined;
      const managerId = manager?.id || (employee?.userType === "manager" ? employee.id : employee?.managerName ? `name:${employee.managerName}` : "unassigned");
      const managerName = manager?.fullName || (employee?.userType === "manager" ? employee.fullName : employee?.managerName) || "Без менеджера";
      const department = manager?.department || employee?.department || null;

      if (!managerPlanMap.has(managerId)) {
        managerPlanMap.set(managerId, {
          id: managerId,
          name: managerName,
          department,
          plannedTrips: 0,
          activeTrips: 0,
          upcomingTrips: 0,
          pendingTrips: 0,
          approvedTrips: 0,
          totalDays: 0,
          employeeIds: new Set<string>(),
          nextTripDate: null,
        });
      }

      const row = managerPlanMap.get(managerId)!;
      row.plannedTrips += 1;
      row.totalDays += getTripDuration(trip.startDate, trip.endDate);
      row.employeeIds.add(trip.employeeId);
      if (trip.startDate <= todayStr && trip.endDate >= todayStr) row.activeTrips += 1;
      if (trip.startDate > todayStr) row.upcomingTrips += 1;
      if (pendingStatuses.includes(trip.status)) row.pendingTrips += 1;
      if (["approved", "planned"].includes(trip.status)) row.approvedTrips += 1;
      if (trip.startDate >= todayStr && (!row.nextTripDate || trip.startDate < row.nextTripDate)) {
        row.nextTripDate = trip.startDate;
      }
    });

  const managerPlanRows = Array.from(managerPlanMap.values())
    .sort((a, b) => b.plannedTrips - a.plannedTrips || a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">Дашборд</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Обзор командировочной активности
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
          <Button variant="outline" onClick={() => setLocation("/chat")} data-testid="button-chat" className="w-full sm:w-auto">
            <MessageCircle className="h-4 w-4 mr-2" />
            Чат
            {unreadChat.count > 0 && (
              <Badge variant="destructive" className="ml-1 min-w-5 justify-center px-1.5">
                {unreadChat.count > 99 ? "99+" : unreadChat.count}
              </Badge>
            )}
          </Button>
          <Button onClick={() => setLocation("/trips")} data-testid="button-new-trip" className="w-full sm:w-auto">
            <Building2 className="h-4 w-4 mr-2" />
            Новая командировка
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:gap-4 grid-cols-2 md:grid-cols-2 lg:grid-cols-4">
        <Card className="cursor-pointer hover-elevate" onClick={() => setSelectedStats("all")} data-testid="card-total-trips">
          <CardHeader className="flex flex-row items-center justify-between gap-1 md:gap-2 space-y-0 pb-2">
            <CardTitle className="text-xs md:text-sm font-medium truncate">
              Всего командировок
            </CardTitle>
            <Calendar className="h-3 md:h-4 w-3 md:w-4 text-muted-foreground flex-shrink-0" />
          </CardHeader>
          <CardContent className="p-3 pt-0 md:p-4 md:pt-0">
            {statsLoading ? <Skeleton className="h-6 md:h-8 w-8 md:w-12" /> : <div className="text-lg md:text-2xl font-semibold">{stats?.totalTrips || 0}</div>}
            <p className="text-xs text-muted-foreground mt-1">
              В системе
            </p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover-elevate" onClick={() => setSelectedStats("pending")} data-testid="card-pending-trips">
          <CardHeader className="flex flex-row items-center justify-between gap-1 md:gap-2 space-y-0 pb-2">
            <CardTitle className="text-xs md:text-sm font-medium truncate">
              {isManager ? "Требуют согласования" : "На согласовании"}
            </CardTitle>
            <Clock className="h-3 md:h-4 w-3 md:w-4 text-muted-foreground flex-shrink-0" />
          </CardHeader>
          <CardContent className="p-3 pt-0 md:p-4 md:pt-0">
            {statsLoading ? <Skeleton className="h-6 md:h-8 w-8 md:w-12" /> : <div className="text-lg md:text-2xl font-semibold">{isManager ? (stats?.pendingApprovals || 0) : (stats?.pendingTrips || 0)}</div>}
            <p className="text-xs text-muted-foreground mt-1">
              {isManager ? "Ожидают вашего решения" : "Ожидают решения"}
            </p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover-elevate" onClick={() => setSelectedStats("approved")} data-testid="card-approved-trips">
          <CardHeader className="flex flex-row items-center justify-between gap-1 md:gap-2 space-y-0 pb-2">
            <CardTitle className="text-xs md:text-sm font-medium truncate">
              Утверждено
            </CardTitle>
            <CheckSquare className="h-3 md:h-4 w-3 md:w-4 text-muted-foreground flex-shrink-0" />
          </CardHeader>
          <CardContent className="p-3 pt-0 md:p-4 md:pt-0">
            {statsLoading ? <Skeleton className="h-6 md:h-8 w-8 md:w-12" /> : <div className="text-lg md:text-2xl font-semibold">{stats?.approvedTrips || 0}</div>}
            <p className="text-xs text-muted-foreground mt-1">
              Всего
            </p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover-elevate" onClick={() => setSelectedStats("active")} data-testid="card-active-trips">
          <CardHeader className="flex flex-row items-center justify-between gap-1 md:gap-2 space-y-0 pb-2">
            <CardTitle className="text-xs md:text-sm font-medium truncate">
              Активных
            </CardTitle>
            <TrendingUp className="h-3 md:h-4 w-3 md:w-4 text-muted-foreground flex-shrink-0" />
          </CardHeader>
          <CardContent className="p-3 pt-0 md:p-4 md:pt-0">
            {statsLoading ? <Skeleton className="h-6 md:h-8 w-8 md:w-12" /> : <div className="text-lg md:text-2xl font-semibold">{stats?.activeTrips || 0}</div>}
            <p className="text-xs text-muted-foreground mt-1">
              Сейчас в командировках
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3 md:pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm md:text-base">Планирование менеджеров</CardTitle>
              <CardDescription className="text-xs md:text-sm">
                Реальные командировки из текущей базы: активные и будущие планы
              </CardDescription>
            </div>
            <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </div>
        </CardHeader>
        <CardContent>
          {tripsLoading || usersLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : managerPlanRows.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <p className="text-sm">Нет активных или будущих планов</p>
            </div>
          ) : (
            <div className="space-y-2">
              {managerPlanRows.map((row) => (
                <div key={row.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(180px,1.5fr)_repeat(6,minmax(72px,1fr))] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.department || "Без отдела"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">В плане</p>
                    <p className="text-sm font-semibold">{row.plannedTrips}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Сейчас</p>
                    <p className="text-sm font-semibold">{row.activeTrips}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Будущие</p>
                    <p className="text-sm font-semibold">{row.upcomingTrips}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">На соглас.</p>
                    <p className="text-sm font-semibold">{row.pendingTrips}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Сотр.</p>
                    <p className="text-sm font-semibold">{row.employeeIds.size}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Ближайшая</p>
                    <p className="text-sm font-semibold">{row.nextTripDate ? formatDateShort(row.nextTripDate) : "-"}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {nearestTripNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setNearestTripNotice(null)}>
          <Card className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
            <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
              <div>
                <CardTitle className="text-base">Ближайшая командировка</CardTitle>
                <CardDescription className="mt-1 text-sm">
                  {nearestTripNotice.startDate <= todayStr && nearestTripNotice.endDate >= todayStr ? "Командировка уже идёт" : "Следующая поездка в вашем плане"}
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon" aria-label="Закрыть уведомление" onClick={() => setNearestTripNotice(null)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {nearestTripNotice.employeeId !== user?.id && (
                <p className="text-sm font-medium">Сотрудник: {nearestTripNotice.employee?.fullName || "Сотрудник"}</p>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Маршрут</p>
                <p className="text-sm font-medium">{nearestTripNotice.route?.path || "Не указан"}</p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 p-3">
                <div>
                  <p className="text-xs text-muted-foreground">Даты</p>
                  <p className="text-sm font-medium">{formatDateShort(nearestTripNotice.startDate)} - {formatDateShort(nearestTripNotice.endDate)}</p>
                </div>
                <Badge variant="secondary" className={getStatusColor(nearestTripNotice.status)}>{statusLabels[nearestTripNotice.status]}</Badge>
              </div>
              <Button className="w-full" onClick={() => setNearestTripNotice(null)}>Понятно</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Модальное окно с расшифровкой */}
      {selectedStats && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setSelectedStats(null)}>
          <Card className="w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
              <CardTitle>{modalTitle}</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedStats(null)}
                data-testid="button-close-modal"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="overflow-y-auto flex-1">
              {displayTrips.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <p className="text-sm">Нет данных</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {displayTrips.map((trip) => {
                    const nights = getTripDuration(trip.startDate, trip.endDate);
                    const allowance = calculateAllowance(trip.startDate, trip.endDate, trip.transportType);
                    
                    return (
                      <div
                        key={trip.id}
                        className="p-4 border rounded-lg hover-elevate"
                        data-testid={`trip-detail-${trip.id}`}
                      >
                        <div className="flex flex-col gap-3">
                          {/* Кто создал и статус */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-col gap-1">
                              <p className="font-semibold text-foreground">
                                {trip.employee?.fullName || "Неизвестный сотрудник"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Создана: {trip.createdAt ? formatDateShort(trip.createdAt) : "—"}
                              </p>
                            </div>
                            <Badge variant="secondary" className={getStatusColor(trip.status)}>
                              {statusLabels[trip.status]}
                            </Badge>
                          </div>

                          {/* Маршрут/Город */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <div>
                              <p className="text-xs text-muted-foreground font-medium">Маршрут</p>
                              <p className="text-sm font-medium">{trip.route?.path || "—"}</p>
                              <p className="text-xs text-muted-foreground">{trip.route?.distance || "—"}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground font-medium">Город</p>
                              <p className="text-sm font-medium">{trip.city?.name || "—"}</p>
                            </div>
                          </div>

                          {/* Даты */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-muted/50 p-2 rounded">
                            <div>
                              <p className="text-xs text-muted-foreground">Начало</p>
                              <p className="text-sm font-medium">{formatDateShort(trip.startDate)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Окончание</p>
                              <p className="text-sm font-medium">{formatDateShort(trip.endDate)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Дней</p>
                              <p className="text-sm font-medium">{nights} дн.</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Суточные</p>
                              <p className="text-sm font-semibold text-primary">{allowance.toLocaleString()} ₽</p>
                            </div>
                          </div>

                          {/* Цель */}
                          <div>
                            <p className="text-xs text-muted-foreground font-medium">Цель командировки</p>
                            <p className="text-sm">{trip.purpose}</p>
                          </div>

                          {/* Транспорт */}
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {transportLabels[trip.transportType]}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className={cn("grid gap-4 md:gap-6", isManager ? "md:grid-cols-2" : "grid-cols-1")}>
        <Card>
          <CardHeader className="pb-3 md:pb-4">
            <CardTitle className="text-sm md:text-base">Последние командировки</CardTitle>
            <CardDescription className="text-xs md:text-sm">
              Недавно созданные и обновленные
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tripsLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : recentTrips.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <div className="text-center">
                  <Building2 className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">Командировок пока нет</p>
                  <p className="text-xs mt-1">Создайте первую командировку</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2 md:space-y-3">
                {recentTrips.map((trip) => (
                  <div
                    key={trip.id}
                    className="flex flex-col gap-1.5 p-2 md:p-3 rounded-md border hover-elevate"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-xs md:text-sm font-medium text-foreground truncate">{trip.employee?.fullName || "Неизвестный"}</p>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Badge variant="outline" className="text-[9px] md:text-[10px]">{transportLabels[trip.transportType]}</Badge>
                        <Badge variant="secondary" className={cn(getStatusColor(trip.status), "text-[9px] md:text-[10px]")}>
                          {statusLabels[trip.status]}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-xs md:text-sm font-bold text-primary truncate">{trip.route.path}</p>
                      <div className="flex flex-col gap-0.5">
                        {trip.city?.name && <p className="text-xs text-muted-foreground truncate">{trip.city.name as string}</p>}
                        <p className="text-xs text-muted-foreground">
                          {formatDateShort(trip.startDate)} - {formatDateShort(trip.endDate)}
                          <span className="mx-1">•</span>
                          {getTripDuration(trip.startDate, trip.endDate)} дн.
                        </p>
                        <p className="text-xs text-muted-foreground font-mono truncate">{trip.route.distance as string}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {trip.purpose}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {isManager ? (
          <Card>
            <CardHeader className="pb-3 md:pb-4">
              <CardTitle className="text-sm md:text-base">Требуют согласования</CardTitle>
              <CardDescription className="text-xs md:text-sm">
                Командировки подчиненных
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tripsLoading || approvalTripsLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : pendingTripsToApprove.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <div className="text-center">
                    <CheckSquare className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">
                      {stats?.pendingApprovals ? `У вас ${stats.pendingApprovals} новых заявок` : "Заявок на согласование нет"}
                    </p>
                    <p className="text-xs mt-1">
                      {stats?.pendingApprovals ? "Перейдите в раздел согласования" : "Здесь появятся новые заявки"}
                    </p>
                    {stats?.pendingApprovals ? (
                      <Button variant="ghost" onClick={() => setLocation("/approvals")} className="mt-2">
                        Перейти к согласованию
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="space-y-2 md:space-y-3">
                  {pendingTripsToApprove.slice(0, 5).map((trip) => (
                    <div
                      key={trip.id}
                      className="flex flex-col gap-1.5 p-2 md:p-3 rounded-md border hover-elevate cursor-pointer"
                      onClick={() => setLocation("/approvals")}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs md:text-sm font-medium truncate">{trip.employee?.fullName || "Неизвестный"}</p>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Badge variant="outline" className="text-[9px] md:text-[10px]">{transportLabels[trip.transportType]}</Badge>
                          <Badge variant="secondary" className={cn(getStatusColor(trip.status), "text-[9px] md:text-[10px]")}>
                            {statusLabels[trip.status]}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <p className="text-xs md:text-sm font-bold text-primary truncate">
                          {trip.route.path}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateShort(trip.startDate)} - {formatDateShort(trip.endDate)}
                          <span className="mx-1">•</span>
                          {getTripDuration(trip.startDate, trip.endDate)} дн.
                        </p>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {trip.route.distance}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {trip.purpose}
                        </p>
                      </div>
                    </div>
                  ))}
                  {pendingTripsToApprove.length > 5 && (
                    <Button variant="ghost" className="w-full text-xs" onClick={() => setLocation("/approvals")}>
                      Показать все ({pendingTripsToApprove.length})
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-3 md:pb-4">
              <CardTitle className="text-sm md:text-base">Статус согласования</CardTitle>
              <CardDescription className="text-xs md:text-sm">
                Ваши командировки на рассмотрении
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tripsLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : myPendingTrips.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <div className="text-center">
                    <Clock className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">Нет командировок на согласовании</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 md:space-y-3">
                  {myPendingTrips.map((trip) => (
                    <div
                      key={trip.id}
                      className="flex flex-col gap-1.5 p-2 md:p-3 rounded-md border hover-elevate"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs md:text-sm font-medium truncate">{trip.employee?.fullName || "Неизвестный"}</p>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Badge variant="outline" className="text-[9px] md:text-[10px]">{transportLabels[trip.transportType]}</Badge>
                          <Badge variant="secondary" className={cn(getStatusColor(trip.status), "text-[9px] md:text-[10px]")}>
                            {statusLabels[trip.status]}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <p className="text-xs md:text-sm font-bold text-primary truncate">
                          {trip.route.path}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateShort(trip.startDate)} - {formatDateShort(trip.endDate)}
                          <span className="mx-1">•</span>
                          {getTripDuration(trip.startDate, trip.endDate)} дн.
                        </p>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {trip.route.distance as string}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {trip.purpose}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {(myRejectedTrips.length > 0) && (
        <Card className="border-destructive/20 bg-destructive/5 mt-6">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <X className="h-5 w-5" />
              Отклоненные командировки
            </CardTitle>
            <CardDescription>
              Требуют корректировки или удаления
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {myRejectedTrips.map((trip) => (
                <div
                  key={trip.id}
                  className="flex items-start justify-between p-3 rounded-md border border-destructive/10 bg-white dark:bg-slate-950 hover-elevate"
                >
                  <div className="flex-1">
                    <div className="flex flex-col gap-0.5 mb-2">
                      <p className="text-sm font-medium">{trip.employee?.fullName || "Неизвестный"}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-primary">{trip.city?.name || trip.route.path.split(/[-–—]/)[0]}</span>
                        <Badge variant="secondary" className={getStatusColor(trip.status)}>
                          {statusLabels[trip.status]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{trip.city?.region || ""}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatDateShort(trip.startDate)} - {formatDateShort(trip.endDate)}
                    </p>
                    {trip.approvals?.find(a => a.status === "rejected")?.comment && (
                      <div className="mt-2 p-2 bg-muted rounded text-xs text-destructive">
                        <strong>Причина отказа:</strong> {trip.approvals.find(a => a.status === "rejected")?.comment}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
