import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, MapPin, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  format,
  startOfMonth, endOfMonth,
  startOfWeek, endOfWeek,
  eachDayOfInterval,
  isSameMonth, isToday,
  addWeeks, subWeeks,
  addMonths, subMonths,
} from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { getStatusColor, statusLabels } from "@/lib/status-utils";
import { roleLabels } from "@/lib/role-utils";
import { formatDateShort } from "@/lib/date-utils";
import { useAuth } from "@/contexts/auth-context";
import type { TripWithDetails, User, TransportType, Holiday } from "@shared/schema";

type ViewType = "month" | "week" | "quarter";

const transportLabels: Record<TransportType, string> = {
  car: "Авто",
  train: "Ж/Д",
  plane: "Авиа",
};

const WEEK_DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export default function CalendarView() {
  const { user: currentUser } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewType>("month");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [isDayDetailsOpen, setIsDayDetailsOpen] = useState(false);

  const { data: trips = [], isLoading } = useQuery<TripWithDetails[]>({
    queryKey: ["/api/trips"],
  });
  const { data: employees = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });
  const { data: holidaysList = [] } = useQuery<Holiday[]>({
    queryKey: ["/api/holidays"],
  });

  const holidayDates = new Set(holidaysList.map(h => h.date));
  const isHoliday = (date: Date) => holidayDates.has(format(date, "yyyy-MM-dd"));
  const getHolidayName = (date: Date) =>
    holidaysList.find(h => h.date === format(date, "yyyy-MM-dd"))?.description || "Праздничный день";

  const filteredEmployees = employees.filter(emp => {
    if (!currentUser) return false;
    if (currentUser.role === "admin") return true;
    return emp.id === currentUser.id || emp.managerId === currentUser.id;
  });

  // ── Navigation ───────────────────────────────────────────────
  const goToPrevious = () => {
    if (view === "week") setCurrentDate(d => subWeeks(d, 1));
    else if (view === "quarter") setCurrentDate(d => subMonths(d, 3));
    else setCurrentDate(d => subMonths(d, 1));
  };
  const goToNext = () => {
    if (view === "week") setCurrentDate(d => addWeeks(d, 1));
    else if (view === "quarter") setCurrentDate(d => addMonths(d, 3));
    else setCurrentDate(d => addMonths(d, 1));
  };
  const goToToday = () => setCurrentDate(new Date());

  // ── Title ─────────────────────────────────────────────────────
  const getTitle = () => {
    if (view === "week") {
      const ws = startOfWeek(currentDate, { locale: ru });
      const we = endOfWeek(currentDate, { locale: ru });
      return `${format(ws, "d MMM", { locale: ru })} — ${format(we, "d MMM yyyy", { locale: ru })}`;
    }
    if (view === "quarter") {
      const qStart = Math.floor(currentDate.getMonth() / 3) * 3;
      const m1 = new Date(currentDate.getFullYear(), qStart, 1);
      const m3 = new Date(currentDate.getFullYear(), qStart + 2, 1);
      return `${format(m1, "LLLL", { locale: ru })} — ${format(m3, "LLLL yyyy", { locale: ru })}`;
    }
    return format(currentDate, "LLLL yyyy", { locale: ru });
  };

  // ── Helpers ───────────────────────────────────────────────────
  const getTripsForDate = (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    return trips.filter(trip => {
      const matchesEmployee = employeeFilter === "all" || trip.employeeId === employeeFilter;
      return matchesEmployee && dateStr >= trip.startDate && dateStr <= trip.endDate;
    });
  };

  const getStatusBg = (status: string) => ({
    draft: "bg-muted",
    pending: "bg-amber-500",
    manager_approved: "bg-blue-400",
    director_approved: "bg-blue-600",
    approved: "bg-green-500",
    rejected: "bg-red-500",
  } as Record<string, string>)[status] || "bg-muted";

  const tripLabel = (trip: TripWithDetails) => {
    const parts = (trip.route?.path || "").split(/[-–—]/).map(s => s.trim()).filter(Boolean);
    const mid = parts.length >= 3 ? parts.slice(1, -1) : parts.slice(1);
    const dest = mid.join(" – ") || parts[0] || "—";
    const last = (trip.employee?.fullName || "?").split(" ")[0];
    return `${last} → ${dest}`;
  };

  const TripChip = ({ trip, tiny = false }: { trip: TripWithDetails; tiny?: boolean }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          "px-1.5 py-0.5 rounded truncate font-medium cursor-pointer",
          tiny ? "text-[9px]" : "text-[10px]",
          getStatusBg(trip.status),
          trip.status === "draft" ? "text-muted-foreground" : "text-white"
        )}>
          {tripLabel(trip)}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-52">
        <div className="space-y-1">
          <p className="font-medium text-xs">{trip.employee?.fullName}</p>
          <div className="flex items-start gap-1 text-xs">
            <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{trip.route?.path || "—"}{trip.route?.distance ? ` (${trip.route.distance})` : ""}</span>
          </div>
          <p className="text-xs opacity-80">{formatDateShort(trip.startDate)} — {formatDateShort(trip.endDate)}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );

  const DayCell = ({
    day,
    referenceMonth,
    minH = "min-h-24",
    tiny = false,
  }: {
    day: Date;
    referenceMonth: Date;
    minH?: string;
    tiny?: boolean;
  }) => {
    const dayTrips = getTripsForDate(day);
    const holiday = isHoliday(day);
    const holidayName = holiday ? getHolidayName(day) : null;
    const inMonth = isSameMonth(day, referenceMonth);
    const limit = tiny ? 2 : 3;

    return (
      <div className={cn(
        "bg-card p-2",
        minH,
        !inMonth && "bg-muted/30",
        isToday(day) && "bg-primary/5 ring-1 ring-primary/20",
        holiday && inMonth && "bg-red-50 dark:bg-red-950/20"
      )}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "font-medium mb-1 w-fit",
              tiny ? "text-xs" : "text-sm",
              !inMonth && "text-muted-foreground",
              isToday(day) && !holiday && "text-primary font-semibold",
              holiday && inMonth && "text-red-600 dark:text-red-400 font-semibold"
            )}>
              {format(day, "d")}
            </div>
          </TooltipTrigger>
          {holidayName && inMonth && (
            <TooltipContent side="top">
              <p className="text-xs">{holidayName}</p>
            </TooltipContent>
          )}
        </Tooltip>

        <div
          className="space-y-0.5 cursor-pointer"
          onClick={() => { setSelectedDay(day); setIsDayDetailsOpen(true); }}
          data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
        >
          {dayTrips.slice(0, limit).map(trip => (
            <TripChip key={trip.id} trip={trip} tiny={tiny} />
          ))}
          {dayTrips.length > limit && (
            <div className={cn("text-muted-foreground px-1", tiny ? "text-[9px]" : "text-xs")}>
              +{dayTrips.length - limit} ещё
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Month view ────────────────────────────────────────────────
  const renderMonth = () => {
    const ms = startOfMonth(currentDate);
    const me = endOfMonth(currentDate);
    const days = eachDayOfInterval({
      start: startOfWeek(ms, { locale: ru }),
      end: endOfWeek(me, { locale: ru }),
    });
    return (
      <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
        {WEEK_DAYS.map(d => (
          <div key={d} className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
        ))}
        {days.map((day, i) => (
          <DayCell key={i} day={day} referenceMonth={currentDate} minH="min-h-24" />
        ))}
      </div>
    );
  };

  // ── Week view ─────────────────────────────────────────────────
  const renderWeek = () => {
    const ws = startOfWeek(currentDate, { locale: ru });
    const we = endOfWeek(currentDate, { locale: ru });
    const days = eachDayOfInterval({ start: ws, end: we });
    return (
      <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
        {days.map((day, i) => (
          <div key={i} className={cn(
            "bg-muted p-2 text-center",
            isToday(day) && "bg-primary/10"
          )}>
            <div className="text-xs font-medium text-muted-foreground">{WEEK_DAYS[i]}</div>
            <div className={cn("text-sm font-semibold", isToday(day) && "text-primary")}>
              {format(day, "d")}
            </div>
            <div className="text-xs text-muted-foreground capitalize">
              {format(day, "MMM", { locale: ru })}
            </div>
          </div>
        ))}
        {days.map((day, i) => (
          <DayCell key={`b-${i}`} day={day} referenceMonth={currentDate} minH="min-h-48" />
        ))}
      </div>
    );
  };

  // ── Quarter view ──────────────────────────────────────────────
  const renderQuarter = () => {
    const qStart = Math.floor(currentDate.getMonth() / 3) * 3;
    const months = [0, 1, 2].map(i => new Date(currentDate.getFullYear(), qStart + i, 1));
    return (
      <div className="grid grid-cols-3 gap-4">
        {months.map((monthDate, mi) => {
          const ms = startOfMonth(monthDate);
          const me = endOfMonth(monthDate);
          const days = eachDayOfInterval({
            start: startOfWeek(ms, { locale: ru }),
            end: endOfWeek(me, { locale: ru }),
          });
          return (
            <div key={mi}>
              <h3 className="text-center text-sm font-semibold mb-2 capitalize">
                {format(monthDate, "LLLL yyyy", { locale: ru })}
              </h3>
              <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
                {WEEK_DAYS.map(d => (
                  <div key={d} className="bg-muted py-1 text-center text-[10px] font-medium text-muted-foreground">{d}</div>
                ))}
                {days.map((day, i) => (
                  <DayCell key={i} day={day} referenceMonth={monthDate} minH="min-h-14" tiny />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold text-foreground">Календарь</h1>
        <p className="text-sm text-muted-foreground mt-1">Календарное представление командировок</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={goToPrevious} data-testid="button-prev">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={goToToday} data-testid="button-today">Сегодня</Button>
              <Button variant="outline" size="icon" onClick={goToNext} data-testid="button-next">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <h2 className="text-lg font-semibold ml-2 capitalize">{getTitle()}</h2>
            </div>
            <div className="flex items-center gap-2">
              <Select value={view} onValueChange={(v) => setView(v as ViewType)}>
                <SelectTrigger className="w-36" data-testid="select-calendar-view">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Месяц</SelectItem>
                  <SelectItem value="week">Неделя</SelectItem>
                  <SelectItem value="quarter">Квартал</SelectItem>
                </SelectContent>
              </Select>
              <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                <SelectTrigger className="w-48" data-testid="select-employee-filter">
                  <SelectValue placeholder="Все сотрудники" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все сотрудники</SelectItem>
                  {filteredEmployees.map(emp => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <>
              {view === "month" && renderMonth()}
              {view === "week" && renderWeek()}
              {view === "quarter" && renderQuarter()}
            </>
          )}

          <Dialog open={isDayDetailsOpen} onOpenChange={setIsDayDetailsOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  Командировки на {selectedDay && format(selectedDay, "d MMMM yyyy", { locale: ru })}
                </DialogTitle>
                <DialogDescription>Детальная информация о запланированных поездках</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {selectedDay && getTripsForDate(selectedDay).length === 0 ? (
                  <p className="text-sm text-center text-muted-foreground py-4">Нет командировок на этот день</p>
                ) : (
                  selectedDay && getTripsForDate(selectedDay).map(trip => (
                    <div key={trip.id} className="p-3 border rounded-md space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-semibold">{trip.employee?.fullName || "Неизвестный"}</span>
                        <Badge variant="secondary" className={getStatusColor(trip.status)}>
                          {statusLabels[trip.status]}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground space-y-0.5">
                        <p><strong>Должность:</strong> {trip.employee?.role ? roleLabels[trip.employee.role] : "—"}</p>
                        <p><strong>Отдел:</strong> {trip.employee?.department || "—"}</p>
                        <p><strong>Маршрут:</strong> {trip.route?.path || "—"} {trip.route?.distance ? `(${trip.route.distance})` : ""}</p>
                        <p><strong>Транспорт:</strong> {transportLabels[trip.transportType]}</p>
                        <p><strong>Даты:</strong> {formatDateShort(trip.startDate)} — {formatDateShort(trip.endDate)}</p>
                        <p><strong>Цель:</strong> {trip.purpose}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </DialogContent>
          </Dialog>

          {!isLoading && trips.length === 0 && (
            <div className="mt-6 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Building2 className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Нет командировок</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <p className="text-sm font-medium">Легенда</p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {[
              { color: "bg-muted", label: "Черновик" },
              { color: "bg-amber-500", label: "На согласовании" },
              { color: "bg-blue-400", label: "Согл. менеджером" },
              { color: "bg-blue-600", label: "Согл. руководителем" },
              { color: "bg-green-500", label: "Утверждено" },
              { color: "bg-red-500", label: "Отклонено" },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2">
                <div className={cn("h-3 w-3 rounded-sm", color)} />
                <span className="text-sm">{label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
