import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StickyScrollTable } from "@/components/ui/sticky-scroll-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2, Search } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

interface TripsReportData {
  periodStart: string;
  periodEnd: string;
  amountPerNight: number;
  withAllowance: any[];
  withoutAllowance: any[];
  totalWithAllowance: number;
  totalWithoutAllowance: number;
  grandTotal: number;
}

export function TripsReport() {
  const { toast } = useToast();
  const currentDate = new Date();
  const [periodStart, setPeriodStart] = useState(format(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1), "yyyy-MM-dd"));
  const [periodEnd, setPeriodEnd] = useState(format(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0), "yyyy-MM-dd"));
  const [isExporting, setIsExporting] = useState(false);
  const [search, setSearch] = useState("");
  const isPeriodValid = Boolean(periodStart && periodEnd && periodStart <= periodEnd);

  const { data: report, isLoading } = useQuery<TripsReportData>({
    queryKey: ["/api/admin/trips-report", periodStart, periodEnd],
    queryFn: async () => {
      const res = await fetch(`/api/admin/trips-report?startDate=${periodStart}&endDate=${periodEnd}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    },
    enabled: isPeriodValid,
  });

  const matchesTripSearch = (trip: any) => {
    const query = search.trim().toLocaleLowerCase("ru-RU");
    if (!query) return true;
    return [
      trip.number,
      trip.employee?.fullName,
      trip.employee?.department,
      trip.route?.path,
      trip.transportType,
      trip.startDate,
      trip.endDate,
    ].some((value) => String(value || "").toLocaleLowerCase("ru-RU").includes(query));
  };
  const visibleWithAllowance = (report?.withAllowance || []).filter(matchesTripSearch);
  const visibleWithoutAllowance = (report?.withoutAllowance || []).filter(matchesTripSearch);

  const handleExportReport = () => {
    if (!isPeriodValid) {
      toast({ title: "Проверьте период", description: "Дата окончания не может быть раньше даты начала.", variant: "destructive" });
      return;
    }

    setIsExporting(true);
    try {
      const filename = `Реестр_командировок_${periodStart}_по_${periodEnd}.xlsx`;
      
      const link = document.createElement("a");
      link.href = `/api/admin/trips-report/export?startDate=${periodStart}&endDate=${periodEnd}`;
      link.download = filename;
      link.style.display = "none";
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast({
        title: "Успешно",
        description: "Реестр командировок скачан",
      });
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось скачать реестр",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Реестр командировок</CardTitle>
          <CardDescription>
            Формирование реестра согласованных командировок за выбранный период
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-2 block text-sm font-medium">Начало периода</label>
                <Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Окончание периода</label>
                <Input type="date" min={periodStart} value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
              </div>

              <div className="flex items-end">
                <Button
                  onClick={handleExportReport}
                  disabled={!isPeriodValid || isExporting || (isLoading && !report)}
                  className="w-full"
                  data-testid="button-export-report"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Экспортирую...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Скачать Excel
                    </>
                  )}
                </Button>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Поиск в реестре</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="ФИО, отдел, маршрут"
                    className="pl-9"
                    data-testid="input-search-trips-report"
                  />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Загрузка...</p>
          </CardContent>
        </Card>
      )}

      {report && (
        <>
          {/* WITH ALLOWANCE */}
          {report.withAllowance && report.withAllowance.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Командировки с суточными ({visibleWithAllowance.length} из {report.withAllowance.length})
                </CardTitle>
                <CardDescription>
                  Суточные: {report.amountPerNight} руб/сутки
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StickyScrollTable maxHeight="calc(100vh - 500px)">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead>№ п/п</TableHead>
                        <TableHead>ФИО</TableHead>
                        <TableHead>Отдел</TableHead>
                        <TableHead>Срок</TableHead>
                        <TableHead>Маршрут</TableHead>
                        <TableHead>Транспорт</TableHead>
                        <TableHead className="text-right">Суточных дней</TableHead>
                        <TableHead className="text-right">Итог, руб.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleWithAllowance.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Ничего не найдено</TableCell>
                        </TableRow>
                      ) : visibleWithAllowance.map((trip) => {
                        const startDate = new Date(trip.startDate);
                        const endDate = new Date(trip.endDate);
                        const tripDates = `${format(startDate, "dd.MM")} - ${format(endDate, "dd.MM")}`;
                        const routePath = trip.route?.path || "-";
                        const transportMap: Record<string, string> = {
                          plane: "✈ Самолет",
                          train: "🚆 Поезд",
                          car: "🚗 Авто",
                        };

                        return (
                          <TableRow key={trip.id} data-testid={`row-trip-${trip.id}`}>
                            <TableCell className="font-medium">{trip.number}</TableCell>
                            <TableCell>{trip.employee?.fullName || "-"}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{trip.employee?.department || "-"}</Badge>
                            </TableCell>
                            <TableCell className="text-sm">{tripDates}</TableCell>
                            <TableCell className="text-sm">{routePath}</TableCell>
                            <TableCell className="text-sm">{transportMap[trip.transportType] || trip.transportType}</TableCell>
                            <TableCell className="text-right">{trip.allowanceDays}</TableCell>
                            <TableCell className="text-right font-semibold">{trip.totalAllowance.toLocaleString("ru-RU")}</TableCell>
                          </TableRow>
                        );
                      })}
                      {visibleWithAllowance.length > 0 && (
                        <TableRow className="border-t-2 font-bold">
                          <TableCell colSpan={7} className="text-right">Итого по найденным:</TableCell>
                          <TableCell className="text-right">{visibleWithAllowance.reduce((total, trip) => total + trip.totalAllowance, 0).toLocaleString("ru-RU")} ₽</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </StickyScrollTable>
              </CardContent>
            </Card>
          )}

          {/* WITHOUT ALLOWANCE */}
          {report.withoutAllowance && report.withoutAllowance.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Командировки без суточных ({visibleWithoutAllowance.length} из {report.withoutAllowance.length})
                </CardTitle>
                <CardDescription>
                  Командировки без суточных
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StickyScrollTable maxHeight="calc(100vh - 500px)">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead>№ п/п</TableHead>
                        <TableHead>ФИО</TableHead>
                        <TableHead>Отдел</TableHead>
                        <TableHead>Срок</TableHead>
                        <TableHead>Маршрут</TableHead>
                        <TableHead>Транспорт</TableHead>
                        <TableHead className="text-right">Суточных дней</TableHead>
                        <TableHead className="text-right">Итог, руб.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleWithoutAllowance.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Ничего не найдено</TableCell>
                        </TableRow>
                      ) : visibleWithoutAllowance.map((trip) => {
                        const startDate = new Date(trip.startDate);
                        const endDate = new Date(trip.endDate);
                        const tripDates = `${format(startDate, "dd.MM")} - ${format(endDate, "dd.MM")}`;
                        const routePath = trip.route?.path || "-";
                        const transportMap: Record<string, string> = {
                          plane: "✈ Самолет",
                          train: "🚆 Поезд",
                          car: "🚗 Авто",
                        };

                        return (
                          <TableRow key={trip.id} data-testid={`row-trip-${trip.id}`}>
                            <TableCell className="font-medium">{trip.number}</TableCell>
                            <TableCell>{trip.employee?.fullName || "-"}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{trip.employee?.department || "-"}</Badge>
                            </TableCell>
                            <TableCell className="text-sm">{tripDates}</TableCell>
                            <TableCell className="text-sm">{routePath}</TableCell>
                            <TableCell className="text-sm">{transportMap[trip.transportType] || trip.transportType}</TableCell>
                            <TableCell className="text-right">{trip.allowanceDays}</TableCell>
                            <TableCell className="text-right font-semibold">0</TableCell>
                          </TableRow>
                        );
                      })}
                      {visibleWithoutAllowance.length > 0 && (
                        <TableRow className="border-t-2 font-bold">
                          <TableCell colSpan={7} className="text-right">Итого по найденным:</TableCell>
                          <TableCell className="text-right">0 ₽</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </StickyScrollTable>
              </CardContent>
            </Card>
          )}

          {/* GRAND TOTAL */}
          {report && (report.withAllowance.length > 0 || report.withoutAllowance.length > 0) && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Итого с суточными</p>
                    <p className="text-lg font-bold">{report.totalWithAllowance.toLocaleString("ru-RU")} ₽</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Итого без суточных</p>
                    <p className="text-lg font-bold">{report.totalWithoutAllowance.toLocaleString("ru-RU")} ₽</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Общий итог</p>
                    <p className="text-xl font-bold text-primary">{report.grandTotal.toLocaleString("ru-RU")} ₽</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {(!report.withAllowance || report.withAllowance.length === 0) &&
            (!report.withoutAllowance || report.withoutAllowance.length === 0) && (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    Нет согласованных командировок за выбранный период
                  </p>
                </CardContent>
              </Card>
            )}
        </>
      )}
    </div>
  );
}
