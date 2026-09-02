import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, CalendarDays, CheckCircle2, Clock3, MessageCircle, Plane, RefreshCw, Route, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type AnalyticsData = {
  period: { from: string; to: string };
  summary: { trips: number; approved: number; pending: number; totalDays: number; totalEstimatedCost: number; totalKilometers: number; chatMessages: number; unreadChatMessages: number; contactMessages: number; averageApprovalHours: number; allowancePerNight: number };
  tripTypes: { planned: number; unplanned: number };
  transport: { plane: number; train: number; car: number };
  statuses: Array<{ status: string; count: number }>;
  monthly: Array<{ month: string; total: number; planned: number; unplanned: number }>;
  departments: Array<{ department: string; trips: number; approved: number; pending: number; days: number; estimatedCost: number; kilometers: number }>;
  employees: Array<{ employee: string; department: string; trips: number; approved: number; days: number; estimatedCost: number; kilometers: number }>;
  routes: Array<{ route: string; trips: number; kilometers: number }>;
  approvals: { total: number; pending: number; resolved: number; ranking: Array<{ approver: string; total: number; pending: number; resolved: number; averageHours: number }> };
  chat: { total: number; unread: number; departmentActivity: Array<{ department: string; messages: number }>; ranking: Array<{ user: string; department: string; sent: number; received: number; unread: number }> };
};

const statusLabels: Record<string, string> = {
  draft: "Черновик", pending: "На согласовании", manager_approved: "Согласовано руководителем", director_approved: "На финальном согласовании", coordinator_review: "Проверка координатора", deputy_review: "Ожидает ЗГД", ceo_review: "Ожидает ГД", awaiting_ceo_signature: "В реестре на подпись ГД", planned: "Плановая", approved: "Согласовано", rejected: "Отклонено", rescheduling: "Перенос",
};
const colors = ["#2563eb", "#0f766e", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#4d7c0f"];
const formatMoney = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value) + " ₽";
const formatNumber = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);

function Metric({ title, value, description, icon: Icon }: { title: string; value: string; description: string; icon: typeof Plane }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-semibold tracking-normal">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Icon className="h-5 w-5 shrink-0 text-primary" />
      </CardContent>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">{text}</div>;
}

export default function Analytics() {
  const currentYear = new Date().getFullYear();
  const defaultFrom = `${currentYear}-01-01`;
  const defaultTo = `${currentYear}-12-31`;
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [appliedPeriod, setAppliedPeriod] = useState({ from: defaultFrom, to: defaultTo });
  const { data, isLoading, isFetching, error } = useQuery<AnalyticsData>({
    queryKey: ["/api/analytics", appliedPeriod],
    queryFn: async () => {
      const response = await fetch(`/api/analytics?from=${appliedPeriod.from}&to=${appliedPeriod.to}`, { credentials: "include" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Не удалось загрузить аналитику");
      }
      return response.json();
    },
  });

  const statusData = (data?.statuses || []).map((item) => ({ name: statusLabels[item.status] || item.status, value: item.count }));
  const transportData = data ? [
    { name: "Авиа", value: data.transport.plane }, { name: "Ж/Д", value: data.transport.train }, { name: "Авто", value: data.transport.car },
  ].filter((item) => item.value > 0) : [];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2"><BarChart3 className="h-6 w-6 text-primary" /><h1 className="text-xl font-semibold sm:text-2xl">Аналитика</h1></div>
          <p className="mt-1 text-sm text-muted-foreground">Командировки всех сотрудников, расчётные суточные, согласования и активность чата</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
          <label className="grid gap-1 text-xs text-muted-foreground">Начало<Input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="grid gap-1 text-xs text-muted-foreground">Окончание<Input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
          <Button className="col-span-2 sm:col-span-1" onClick={() => setAppliedPeriod({ from, to })} disabled={isFetching || from > to}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Обновить
          </Button>
        </div>
      </div>

      {isLoading && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-32" />)}</div>}
      {error && <Card><CardContent className="p-5 text-sm text-destructive">{error.message}</CardContent></Card>}
      {data && <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric title="Командировки" value={formatNumber(data.summary.trips)} description={`Согласовано: ${data.summary.approved}; в работе: ${data.summary.pending}`} icon={Plane} />
          <Metric title="Дней в поездках" value={formatNumber(data.summary.totalDays)} description={`Плановые: ${data.tripTypes.planned}; внеплановые: ${data.tripTypes.unplanned}`} icon={CalendarDays} />
          <Metric title="Расчётные суточные" value={formatMoney(data.summary.totalEstimatedCost)} description={`${formatMoney(data.summary.allowancePerNight)} за ночь; без билетов и проживания`} icon={Route} />
          <Metric title="Пробег по маршрутам" value={`${formatNumber(data.summary.totalKilometers)} км`} description="По справочнику маршрутов" icon={Route} />
          <Metric title="Сообщения в чате" value={formatNumber(data.summary.chatMessages)} description={`Непрочитано: ${data.summary.unreadChatMessages}`} icon={MessageCircle} />
          <Metric title="Обращения к администратору" value={formatNumber(data.summary.contactMessages)} description="За выбранный период" icon={Send} />
          <Metric title="Согласования" value={formatNumber(data.approvals.total)} description={`Ожидают решения: ${data.approvals.pending}`} icon={CheckCircle2} />
          <Metric title="Среднее согласование" value={`${data.summary.averageApprovalHours} ч`} description="От создания этапа до решения" icon={Clock3} />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Динамика командировок</CardTitle><CardDescription>По месяцу начала поездки</CardDescription></CardHeader>
            <CardContent>{data.monthly.length ? <div className="h-72"><ResponsiveContainer><BarChart data={data.monthly}><CartesianGrid vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="planned" name="Плановые" fill="#2563eb" radius={[3, 3, 0, 0]} /><Bar dataKey="unplanned" name="Внеплановые" fill="#d97706" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div> : <EmptyState text="В выбранном периоде нет командировок" />}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Статусы заявок</CardTitle><CardDescription>Текущий статус командировок, попавших в период</CardDescription></CardHeader>
            <CardContent>{statusData.length ? <div className="h-72"><ResponsiveContainer><PieChart><Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="48%" outerRadius={88} label={({ percent }) => `${Math.round((percent || 0) * 100)}%`}>{statusData.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}</Pie><Tooltip /><Legend verticalAlign="bottom" /></PieChart></ResponsiveContainer></div> : <EmptyState text="Нет данных по статусам" />}</CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Командировки по отделам</CardTitle><CardDescription>Рейтинг отделов по числу поездок</CardDescription></CardHeader>
            <CardContent>{data.departments.length ? <div className="h-80"><ResponsiveContainer><BarChart layout="vertical" data={data.departments.slice(0, 8)} margin={{ left: 24 }}><CartesianGrid horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis dataKey="department" type="category" width={125} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="trips" name="Командировки" fill="#0f766e" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div> : <EmptyState text="Нет данных по отделам" />}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Виды транспорта</CardTitle><CardDescription>По всем поездкам выбранного периода</CardDescription></CardHeader>
            <CardContent>{transportData.length ? <div className="h-80"><ResponsiveContainer><PieChart><Pie data={transportData} dataKey="value" nameKey="name" cx="50%" cy="48%" outerRadius={92} label>{transportData.map((_, index) => <Cell key={index} fill={colors[index]} />)}</Pie><Tooltip /><Legend verticalAlign="bottom" /></PieChart></ResponsiveContainer></div> : <EmptyState text="В поездках не указан транспорт" />}</CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Рейтинг сотрудников</CardTitle><CardDescription>Топ-10 по числу командировок</CardDescription></CardHeader>
            <CardContent className="space-y-2">{data.employees.length ? data.employees.map((row, index) => <div key={row.employee} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 border-b pb-2 last:border-0"><span className="text-sm font-semibold text-muted-foreground">{index + 1}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{row.employee}</p><p className="truncate text-xs text-muted-foreground">{row.department} · {row.days} дн. · {formatMoney(row.estimatedCost)}</p></div><Badge variant="secondary">{row.trips}</Badge></div>) : <EmptyState text="Нет поездок" />}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Популярные маршруты</CardTitle><CardDescription>Топ-10 по количеству поездок</CardDescription></CardHeader>
            <CardContent className="space-y-2">{data.routes.length ? data.routes.map((row, index) => <div key={row.route} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 border-b pb-2 last:border-0"><span className="text-sm font-semibold text-muted-foreground">{index + 1}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{row.route}</p><p className="text-xs text-muted-foreground">{formatNumber(row.kilometers)} км по справочнику</p></div><Badge variant="secondary">{row.trips}</Badge></div>) : <EmptyState text="Нет маршрутов" />}</CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Нагрузка согласующих</CardTitle><CardDescription>Этапы согласования по поездкам выбранного периода</CardDescription></CardHeader>
            <CardContent className="space-y-2">{data.approvals.ranking.length ? data.approvals.ranking.map((row) => <div key={row.approver} className="flex items-center justify-between gap-3 border-b pb-2 last:border-0"><div className="min-w-0"><p className="truncate text-sm font-medium">{row.approver}</p><p className="text-xs text-muted-foreground">Решено: {row.resolved}; ожидает: {row.pending}; среднее: {row.averageHours} ч</p></div><Badge variant="secondary">{row.total}</Badge></div>) : <EmptyState text="Нет этапов согласования" />}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Активность в чате</CardTitle><CardDescription>Рейтинг по отправленным сообщениям; текст переписки не анализируется</CardDescription></CardHeader>
            <CardContent className="space-y-2">{data.chat.ranking.length ? data.chat.ranking.map((row, index) => <div key={row.user} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 border-b pb-2 last:border-0"><span className="text-sm font-semibold text-muted-foreground">{index + 1}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{row.user}</p><p className="truncate text-xs text-muted-foreground">{row.department} · получено: {row.received} · непрочитано: {row.unread}</p></div><Badge variant="secondary">{row.sent}</Badge></div>) : <EmptyState text="Нет сообщений в чате" />}</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Детализация по отделам</CardTitle><CardDescription>Суммы являются расчётными суточными: фактические расходы на билеты и проживание в приложении пока не ведутся</CardDescription></CardHeader>
          <CardContent><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="px-2 py-2 font-medium">Отдел</th><th className="px-2 py-2 text-right font-medium">Поездки</th><th className="px-2 py-2 text-right font-medium">Согласовано</th><th className="px-2 py-2 text-right font-medium">В работе</th><th className="px-2 py-2 text-right font-medium">Дни</th><th className="px-2 py-2 text-right font-medium">Суточные</th><th className="px-2 py-2 text-right font-medium">Км</th></tr></thead><tbody>{data.departments.map((row) => <tr key={row.department} className="border-b last:border-0"><td className="px-2 py-3 font-medium">{row.department}</td><td className="px-2 py-3 text-right">{row.trips}</td><td className="px-2 py-3 text-right">{row.approved}</td><td className="px-2 py-3 text-right">{row.pending}</td><td className="px-2 py-3 text-right">{row.days}</td><td className="px-2 py-3 text-right">{formatMoney(row.estimatedCost)}</td><td className="px-2 py-3 text-right">{formatNumber(row.kilometers)}</td></tr>)}</tbody></table></div></CardContent>
        </Card>
      </>}
    </div>
  );
}
