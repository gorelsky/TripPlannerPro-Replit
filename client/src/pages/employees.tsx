import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { StickyScrollTable } from "@/components/ui/sticky-scroll-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Users, Plus, Trash2, Search, Lock } from "lucide-react";
import { roleLabels, getRoleColor, isAdmin } from "@/lib/role-utils";
import { useAuth } from "@/contexts/auth-context";
import type { User, InsertUser, UserRole } from "@shared/schema";

export default function Employees() {
  const { user: currentUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState<InsertUser>({
    fullName: "",
    email: "",
    role: null,
    userType: "employee",
    department: "",
    managerId: undefined,
  });
  const { toast } = useToast();

  const isAdminOrDeputy = currentUser?.role === "admin" || currentUser?.role === "deputy_ceo";
  
  const { data: employees = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertUser) => apiRequest("POST", "/api/users", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsDialogOpen(false);
      setFormData({
        fullName: "",
        email: "",
        role: null,
        userType: "employee",
        department: "",
        managerId: undefined,
      });
      toast({
        title: "Успешно",
        description: "Сотрудник добавлен",
      });
    },
    onError: (error: any) => {
      const errorMsg = error.message || "Не удалось добавить сотрудника";
      toast({
        title: "Ошибка",
        description: errorMsg.includes("administrator") ? "Только администраторы могут добавлять сотрудников" : errorMsg,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Успешно",
        description: "Сотрудник удален",
      });
    },
    onError: (error: any) => {
      const errorMsg = error.message || "Не удалось удалить сотрудника";
      toast({
        title: "Ошибка",
        description: errorMsg.includes("administrator") ? "Только администраторы могут удалять сотрудников" : errorMsg,
        variant: "destructive",
      });
    },
  });

  const matchesSearch = (emp: User) =>
    emp.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    emp.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    emp.department?.toLowerCase().includes(searchQuery.toLowerCase());

  // Server-side already returns the correct scope per role.
  // Frontend only applies the text search filter.
  const filteredEmployees = employees.filter(emp => matchesSearch(emp));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName.trim() || !formData.email.trim()) return;
    createMutation.mutate(formData);
  };

  const potentialManagers = employees.filter(e => 
    e.userType === "manager" && e.id !== formData.managerId
  );

  const getManagerName = (managerId: string | null | undefined, fallbackName?: string | null) => {
    if (!managerId) return "—";
    const manager = employees.find(e => e.id === managerId);
    return manager?.fullName || fallbackName || "—";
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Сотрудники</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Управление списком сотрудников и руководителей
          </p>
        </div>
        {currentUser && isAdmin(currentUser.role) ? (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-employee">
                <Plus className="h-4 w-4 mr-2" />
                Добавить сотрудника
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Добавить сотрудника</DialogTitle>
                <DialogDescription>
                  Заполните информацию о новом сотруднике
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="employee-name">ФИО *</Label>
                  <Input
                    id="employee-name"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    placeholder="Иванов Иван Иванович"
                    data-testid="input-employee-name"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="employee-email">Email *</Label>
                  <Input
                    id="employee-email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="ivanov@company.ru"
                    data-testid="input-employee-email"
                    required
                  />
                </div>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="employee-department">Отдел</Label>
                    <Select
                      value={formData.department || ""}
                      onValueChange={(value) => setFormData({ ...formData, department: value })}
                    >
                      <SelectTrigger id="employee-department" data-testid="select-employee-department">
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
                    <Label htmlFor="employee-type">Тип</Label>
                    <Select
                      value={formData.userType || "employee"}
                      onValueChange={(value) => setFormData({ ...formData, userType: value as "employee" | "manager" })}
                    >
                      <SelectTrigger id="employee-type" data-testid="select-employee-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="employee">Сотрудник</SelectItem>
                        <SelectItem value="manager">Руководитель</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="employee-manager">Руководитель</Label>
                    <Select
                      value={formData.managerId || "none"}
                      onValueChange={(value) => setFormData({ ...formData, managerId: value === "none" ? undefined : value })}
                    >
                      <SelectTrigger id="employee-manager" data-testid="select-employee-manager">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Без руководителя</SelectItem>
                        {potentialManagers.map((manager) => (
                          <SelectItem key={manager.id} value={manager.id}>
                            {manager.fullName} ({manager.role ? roleLabels[manager.role] : "Сотрудник"})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-employee">
                  {createMutation.isPending ? "Сохранение..." : "Сохранить"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
          </Dialog>
        ) : (
          <Button disabled data-testid="button-add-employee-disabled">
            <Lock className="h-4 w-4 mr-2" />
            Только для админа
          </Button>
        )}
      </div>

      {!currentUser || !isAdmin(currentUser.role) && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
          <CardContent className="pt-6 flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-700 dark:text-amber-300" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Добавление и удаление сотрудников доступно только администраторам
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Список сотрудников</CardTitle>
              <CardDescription>Всего сотрудников: {filteredEmployees.length}</CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск сотрудника..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-employees"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
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
                  <TableHead>ФИО</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Должность (из файла)</TableHead>
                  <TableHead>Отдел</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Руководитель</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <Users className="h-8 md:h-12 w-8 md:w-12 mb-2 md:mb-3 opacity-20" />
                        <p className="text-sm">
                          {searchQuery ? "Ничего не найдено" : "Сотрудников пока нет"}
                        </p>
                        {!searchQuery && (
                          <p className="text-xs mt-1">Добавьте первого сотрудника</p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEmployees.map((employee) => (
                    <TableRow key={employee.id} className="hover-elevate">
                      <TableCell className="font-medium">{employee.fullName}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{employee.email}</TableCell>
                      <TableCell className="text-sm">{employee.jobTitle || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{employee.department || "—"}</TableCell>
                      <TableCell className="text-sm">
                        <Badge variant="outline" className="text-xs">
                          {employee.userType === "manager" ? "Руководитель" : "Сотрудник"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{getManagerName(employee.managerId, employee.managerName)}</TableCell>
                      <TableCell className="text-right">
                        {currentUser && isAdmin(currentUser.role) ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(employee.id)}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-employee-${employee.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : (
                          <div className="h-9 w-9" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))
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
