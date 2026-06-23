import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StickyScrollTable } from "@/components/ui/sticky-scroll-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

interface TripsReportData {
  month: number;
  year: number;
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
  const [month, setMonth] = useState(String(currentDate.getMonth() + 1));
  const [year, setYear] = useState(String(currentDate.getFullYear()));
  const [isExporting, setIsExporting] = useState(false);

  const { data: report, isLoading } = useQuery<TripsReportData>({
    queryKey: ["/api/admin/trips-report", month, year],
    queryFn: async () => {
      const res = await fetch(`/api/admin/trips-report?month=${month}&year=${year}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    },
    enabled: !!month && !!year,
  });

  const months = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: format(new Date(2024, i, 1), "LLLL", { locale: ru }),
  }));

  const years = Array.from({ length: 5 }, (_, i) => {
    const y = currentDate.getFullYear() - 2 + i;
    return { value: String(y), label: String(y) };
  });

  const handleExportReport = () => {
    if (!month || !year) return;

    setIsExporting(true);
    try {
      console.log(`[EXPORT] Starting download for month=${month}, year=${year}`);
      
      // Use simple link navigation - browser automatically includes cookies
      const monthNames = ["", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
      const filename = `Реестр_командировок_${monthNames[parseInt(month)]}_${year}.xlsx`;
      
      const link = document.createElement("a");
      link.href = `/api/admin/trips-report/export?month=${month}&year=${year}`;
      link.download = filename;
      link.style.display = "none";
      
      document.body.appendChild(link);
      console.log(`[EXPORT] Clicking download link for: ${filename}`);
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
            Формирование реестра команди ровок на выбранный месяц
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Месяц</label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Год</label>
                <Select value={year} onValueChange={setYear}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y.value} value={y.value}>
                        {y.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button
                  onClick={handleExportReport}
                  disabled={isExporting || (isLoading && !report)}
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
                  Командировки с суточными ({report.withAllowance.length})
                </CardTitle>
                <CardDescription>
                  Суточные: {report.amountPerNight} руб/ночь
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
                        <TableHead className="text-right">Ночей</TableHead>
                        <TableHead className="text-right">Итог, руб.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.withAllowance.map((trip) => {
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
                            <TableCell className="text-right">{trip.nights}</TableCell>
                            <TableCell className="text-right font-semibold">{trip.totalAllowance.toLocaleString("ru-RU")}</TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="border-t-2 font-bold">
                        <TableCell colSpan={7} className="text-right">Итого по суточным:</TableCell>
                        <TableCell className="text-right">{report.totalWithAllowance.toLocaleString("ru-RU")} ₽</TableCell>
                      </TableRow>
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
                  Командировки без суточных ({report.withoutAllowance.length})
                </CardTitle>
                <CardDescription>
                  Командировки на один день (без ночевок)
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
                        <TableHead className="text-right">Ночей</TableHead>
                        <TableHead className="text-right">Итог, руб.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.withoutAllowance.map((trip) => {
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
                            <TableCell className="text-right">{trip.nights}</TableCell>
                            <TableCell className="text-right font-semibold">0</TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="border-t-2 font-bold">
                        <TableCell colSpan={7} className="text-right">Итого по без суточных:</TableCell>
                        <TableCell className="text-right">{report.totalWithoutAllowance.toLocaleString("ru-RU")} ₽</TableCell>
                      </TableRow>
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
                    Нет одобренных командировок на выбранный месяц
                  </p>
                </CardContent>
              </Card>
            )}
        </>
      )}
    </div>
  );
}
