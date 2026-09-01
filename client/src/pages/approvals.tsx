import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { CheckSquare, X, Check, Clock, Calendar as CalendarIcon, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { formatDateShort, getTripDuration } from "@/lib/date-utils";
import { getStatusColor, statusLabels } from "@/lib/status-utils";
import type { TripWithDetails, User, TripStatus, TransportType, ApprovalWithApprover } from "@shared/schema";

const transportLabels: Record<TransportType, string> = {
  car: "Авто",
  train: "Ж/Д",
  plane: "Авиа",
};

export default function Approvals() {
  const { user: currentUser } = useAuth();

  const hasPendingApproval = (trip: TripWithDetails) =>
    trip.approvals?.some((approval) => approval.approverId === currentUser?.id && approval.status === "pending") ?? false;
  const hasApprovedApproval = (trip: TripWithDetails) =>
    trip.approvals?.some((approval) => approval.approverId === currentUser?.id && approval.status === "approved") ?? false;
  const hasRejectedApproval = (trip: TripWithDetails) =>
    trip.approvals?.some((approval) => approval.approverId === currentUser?.id && approval.status === "rejected") ?? false;

  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [periodStart, setPeriodStart] = useState<Date>();
  const [periodEnd, setPeriodEnd] = useState<Date>();
  const [approvalDialog, setApprovalDialog] = useState<{
    open: boolean;
    type: "approve" | "reject" | null;
    tripId: string | null;
  }>({ open: false, type: null, tripId: null });
  const [comment, setComment] = useState("");
  const { toast } = useToast();

  const { data: subordinateTrips = [], isLoading } = useQuery<TripWithDetails[]>({
    queryKey: ["/api/approvals/pending", currentUser?.id],
    queryFn: async () => {
      if (!currentUser) return [];
      const res = await fetch(`/api/approvals/pending/${currentUser.id}`);
      if (!res.ok) throw new Error("Failed to fetch approvals");
      return res.json();
    },
    enabled: !!currentUser,
  });

  const approveMutation = useMutation({
    mutationFn: ({ tripId, status, comment }: { tripId: string; status: TripStatus; comment?: string }) => 
      apiRequest("POST", `/api/approvals/${tripId}`, {
        approverId: currentUser?.id,
        status,
        comment,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/approvals/pending", currentUser?.id] });
      queryClient.invalidateQueries({ queryKey: [`/api/stats/dashboard/${currentUser?.id}`] });
      setApprovalDialog({ open: false, type: null, tripId: null });
      setComment("");
      toast({
        title: "Успешно",
        description: "Решение по командировке принято",
      });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось обработать заявку",
        variant: "destructive",
      });
    },
  });

  const handleApprove = (tripId: string) => {
    setApprovalDialog({ open: true, type: "approve", tripId });
  };

  const handleReject = (tripId: string) => {
    setApprovalDialog({ open: true, type: "reject", tripId });
  };

  const handleSubmitApproval = () => {
    if (!approvalDialog.tripId) return;
    
    // For rejection, comment is mandatory
    if (approvalDialog.type === "reject" && !comment.trim()) {
      toast({
        title: "Ошибка",
        description: "Укажите причину отклонения",
        variant: "destructive",
      });
      return;
    }

    approveMutation.mutate({
      tripId: approvalDialog.tripId,
      status: "approved", // На бэкенде это перехватится и преобразуется в нужный статус
      comment: comment.trim() || undefined,
    });
  };

  const filteredTrips = subordinateTrips.filter(trip => {
    const tripStart = new Date(trip.startDate);
    const tripEnd = new Date(trip.endDate);

    if (periodStart && tripEnd < periodStart) return false;
    if (periodEnd && tripStart > periodEnd) return false;

    if (statusFilter === "all") return true;
    if (statusFilter === "pending") {
      return hasPendingApproval(trip);
    }
    if (statusFilter === "approved") {
      return hasApprovedApproval(trip);
    }
    return statusFilter === "rejected" && hasRejectedApproval(trip);
  });

  const pendingCount = subordinateTrips.filter(hasPendingApproval).length;
  const approvedCount = subordinateTrips.filter(hasApprovedApproval).length;
  const rejectedCount = subordinateTrips.filter(hasRejectedApproval).length;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">Согласование</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Командировки подчиненных, требующие вашего согласования
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Ожидают решения
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg md:text-2xl font-semibold">{pendingCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Новых заявок
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Утверждено
            </CardTitle>
            <Check className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg md:text-2xl font-semibold">{approvedCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Всего
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Отклонено
            </CardTitle>
            <X className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{rejectedCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Всего
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Очередь согласования</CardTitle>
              <CardDescription>Заявки на командировки от подчиненных</CardDescription>
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
                <SelectTrigger className="w-full sm:w-48" data-testid="select-approval-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">На согласовании</SelectItem>
                  <SelectItem value="approved">Утвержденные</SelectItem>
                  <SelectItem value="rejected">Отклоненные</SelectItem>
                  <SelectItem value="all">Все</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : filteredTrips.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <div className="text-center">
                <CheckSquare className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">
                  {statusFilter === "pending" ? "Заявок на согласование нет" : "Командировок не найдено"}
                </p>
                <p className="text-xs mt-1">
                  {statusFilter === "pending" && "Здесь появятся заявки от подчиненных"}
                </p>
              </div>
            </div>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {filteredTrips.map((trip) => (
                  <AccordionItem key={trip.id} value={trip.id} className="mb-2 rounded-md border px-3 sm:px-4">
                    <AccordionTrigger className="hover:no-underline">
                    <div className="mr-0 flex w-full min-w-0 items-start justify-between gap-2 sm:mr-4">
                      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
                        <div className="text-left">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{trip.employee?.fullName || "Неизвестный"}</span>
                            <Badge variant="secondary" className={getStatusColor(trip.status)}>
                              {statusLabels[trip.status]}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            <span className="font-bold text-primary">{trip.route.path}</span> ({trip.route.distance}, {transportLabels[trip.transportType]})
                            • {formatDateShort(trip.startDate)} - {formatDateShort(trip.endDate)} • {getTripDuration(trip.startDate, trip.endDate)} дн.
                          </p>
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pt-4">
                      <div>
                        <h4 className="text-sm font-medium mb-1">Цель командировки:</h4>
                        <p className="text-sm text-muted-foreground">{trip.purpose}</p>
                      </div>

                      {(trip.trivioBookingNumber || trip.trivioBookingUrl) && (
                        <div>
                          <h4 className="text-sm font-medium mb-1">Бронирование Trivio:</h4>
                          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            {trip.trivioBookingNumber && <span>Номер: {trip.trivioBookingNumber}</span>}
                            {trip.trivioBookingUrl && (
                              <a
                                href={trip.trivioBookingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                Открыть бронирование
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {hasPendingApproval(trip) && (
                        <div className="flex gap-2 pt-2">
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApprove(trip.id);
                            }}
                            disabled={approveMutation.isPending}
                            data-testid={`button-approve-${trip.id}`}
                          >
                            <Check className="h-4 w-4 mr-2" />
                            {trip.status === "coordinator_review"
                              ? "Проверить и передать ЗГД"
                              : trip.status === "awaiting_ceo_signature"
                                ? currentUser?.role === "ceo"
                                  ? "Подтвердить плановую"
                                  : "Передать ГД"
                                : trip.status === "ceo_review" && currentUser?.role === "ceo"
                                  ? "Утвердить командировку"
                                : "Утвердить"}
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReject(trip.id);
                            }}
                            disabled={approveMutation.isPending}
                            data-testid={`button-reject-${trip.id}`}
                          >
                            <X className="h-4 w-4 mr-2" />
                            Отклонить
                          </Button>
                        </div>
                      )}

                      {trip.approvals && trip.approvals.length > 0 && (
                        <div className="border-t pt-4">
                          <h4 className="text-sm font-medium mb-2">История согласования:</h4>
                          <div className="space-y-3">
                            {trip.approvals.map((approval) => (
                              <div key={approval.id} className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-foreground">
                                    {approval.approver?.fullName || "Неизвестный"}
                                  </span>
                                  {approval.approver?.jobTitle && (
                                    <span className="text-xs text-muted-foreground">
                                      {approval.approver.jobTitle}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary" className={getStatusColor(approval.status)}>
                                    {statusLabels[approval.status]}
                                  </Badge>
                                  {approval.createdAt && (
                                    <span className="text-xs text-muted-foreground">
                                      {format(new Date(approval.createdAt), "d MMM yyyy, HH:mm", { locale: ru })}
                                    </span>
                                  )}
                                </div>
                                {approval.comment && (
                                  <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
                                    {approval.comment}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <Dialog open={approvalDialog.open} onOpenChange={(open) => {
        setApprovalDialog({ ...approvalDialog, open });
        if (!open) setComment("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {approvalDialog.type === "approve" ? "Утвердить командировку" : "Отклонить командировку"}
            </DialogTitle>
            <DialogDescription>
              {approvalDialog.type === "approve" 
                ? "Добавьте комментарий к утверждению (необязательно)"
                : "Укажите причину отклонения"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="approval-comment">
                Комментарий {approvalDialog.type === "reject" && "*"}
              </Label>
              <Textarea
                id="approval-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={approvalDialog.type === "approve" 
                  ? "Ваш комментарий..." 
                  : "Укажите причину отклонения..."}
                rows={4}
                data-testid="input-approval-comment"
              />
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setApprovalDialog({ open: false, type: null, tripId: null });
                setComment("");
              }}
            >
              Отмена
            </Button>
            <Button 
              variant={approvalDialog.type === "approve" ? "default" : "destructive"}
              onClick={handleSubmitApproval}
              disabled={approveMutation.isPending}
              data-testid={`button-confirm-${approvalDialog.type}`}
            >
              {approveMutation.isPending ? "Обработка..." : (
                approvalDialog.type === "approve" ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Утвердить
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 mr-2" />
                    Отклонить
                  </>
                )
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
