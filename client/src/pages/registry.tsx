import { ClipboardList } from "lucide-react";
import { TripsReport } from "@/components/trips-report";

export default function Registry() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold sm:text-2xl">Реестр командировок</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Просмотр согласованных поездок и выгрузка реестра за любой период</p>
      </div>
      <TripsReport />
    </div>
  );
}
