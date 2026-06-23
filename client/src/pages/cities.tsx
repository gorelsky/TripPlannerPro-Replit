import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Plus, Pencil, Trash2, Search } from "lucide-react";
import type { City, InsertCity } from "@shared/schema";

export default function Cities() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState<InsertCity>({ name: "", region: "" });
  const { toast } = useToast();

  const { data: cities = [], isLoading } = useQuery<City[]>({
    queryKey: ["/api/cities"],
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertCity) => apiRequest("POST", "/api/cities", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cities"] });
      setIsDialogOpen(false);
      setFormData({ name: "", region: "" });
      toast({
        title: "Успешно",
        description: "Город добавлен",
      });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось добавить город",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/cities/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cities"] });
      toast({
        title: "Успешно",
        description: "Город удален",
      });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось удалить город",
        variant: "destructive",
      });
    },
  });

  const filteredCities = cities.filter(city =>
    city.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    city.region?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    createMutation.mutate(formData);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Города</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Управление справочником городов для командировок
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-city">
              <Plus className="h-4 w-4 mr-2" />
              Добавить город
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Добавить город</DialogTitle>
                <DialogDescription>
                  Заполните информацию о новом городе
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="city-name">Название города *</Label>
                  <Input
                    id="city-name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Москва"
                    data-testid="input-city-name"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="city-region">Регион</Label>
                  <Input
                    id="city-region"
                    value={formData.region || ""}
                    onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                    placeholder="Московская область"
                    data-testid="input-city-region"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-city">
                  {createMutation.isPending ? "Сохранение..." : "Сохранить"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Список городов</CardTitle>
              <CardDescription>Всего городов: {cities.length}</CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск города..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-cities"
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Регион</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCities.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-32 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <MapPin className="h-8 md:h-12 w-8 md:w-12 mb-2 md:mb-3 opacity-20" />
                        <p className="text-sm">
                          {searchQuery ? "Ничего не найдено" : "Городов пока нет"}
                        </p>
                        {!searchQuery && (
                          <p className="text-xs mt-1">Добавьте первый город</p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCities.map((city) => (
                    <TableRow key={city.id} className="hover-elevate">
                      <TableCell className="font-medium">{city.name}</TableCell>
                      <TableCell className="text-muted-foreground">{city.region || "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(city.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-city-${city.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
