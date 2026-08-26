import { useEffect, useRef } from "react";
import { Building2, Calendar, Users, MapPin, LayoutDashboard, CheckSquare, Shield, LogOut, MessageCircle, BookOpen } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { roleLabels } from "@/lib/role-utils";

type ChatUnreadData = {
  count: number;
  senders: Array<{
    id: string;
    fullName: string;
    latestMessageId: string;
    latestMessageAt: string;
  }>;
};

const menuItems = [
  {
    title: "Дашборд",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Календарь",
    url: "/calendar",
    icon: Calendar,
  },
  {
    title: "Мои командировки",
    url: "/trips",
    icon: Building2,
  },
  {
    title: "Согласование",
    url: "/approvals",
    icon: CheckSquare,
  },
  {
    title: "Мой профиль",
    url: "/profile",
    icon: Users,
  },
  {
    title: "Чат",
    url: "/chat",
    icon: MessageCircle,
  },
  {
    title: "Инструкция",
    url: "/guide",
    icon: BookOpen,
  },
];

const managementItems = [
  {
    title: "Сотрудники",
    url: "/employees",
    icon: Users,
  },
  {
    title: "Города",
    url: "/cities",
    icon: MapPin,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const unreadNotificationRef = useRef<string | null>(null);
  const { data: unreadChat = { count: 0, senders: [] } } = useQuery<ChatUnreadData>({
    queryKey: ["/api/chat/unread-count"],
    enabled: Boolean(user),
    refetchInterval: 10000,
  });

  useEffect(() => {
    const signature = unreadChat.senders.map((sender) => `${sender.id}:${sender.latestMessageId}`).join("|");
    const isInitialLoad = unreadNotificationRef.current === null;
    const hasNewMessage = unreadNotificationRef.current !== signature;
    unreadNotificationRef.current = signature;

    if (isInitialLoad || !hasNewMessage || unreadChat.count === 0 || unreadChat.senders.length === 0) return;

    const [sender, ...otherSenders] = unreadChat.senders;
    toast({
      title: "Новое сообщение",
      description: otherSenders.length > 0
        ? `${sender.fullName} и еще ${otherSenders.length} отправитель(я) написали вам.`
        : `${sender.fullName} написал(а) вам в чате.`,
      duration: 8000,
    });
  }, [toast, unreadChat]);

  const filteredMenuItems = menuItems.filter(item => {
    if (item.url === "/approvals") {
      // Только роли с подчиненными видят раздел согласования
      return user && user.role && ["territorial_manager", "commercial_manager", "marketing_director", "sales_director", "commerce_director", "admin"].includes(user.role);
    }
    return true;
  });

  return (
    <Sidebar>
      <SidebarHeader className="p-4 md:p-6 border-b">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="flex h-9 md:h-10 w-9 md:w-10 items-center justify-center rounded-md bg-primary text-primary-foreground flex-shrink-0">
            <Building2 className="h-5 md:h-6 w-5 md:w-6" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm md:text-base font-semibold truncate">Командировки</span>
            <span className="text-xs text-muted-foreground truncate">Система планирования</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Навигация</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredMenuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url}
                    data-testid={`nav-${item.url.slice(1) || 'dashboard'}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                      {item.url === "/chat" && unreadChat.count > 0 && (
                        <span
                          className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-destructive-foreground"
                          aria-label={`Непрочитанных сообщений: ${unreadChat.count}`}
                        >
                          {unreadChat.count > 99 ? "99+" : unreadChat.count}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Управление</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {managementItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url}
                    data-testid={`nav-${item.url.slice(1)}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {(user?.role === "admin" || user?.role === "coordinator") && (
                <SidebarMenuItem>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === "/admin"}
                    data-testid="nav-admin"
                  >
                    <Link href="/admin">
                      <Shield className="h-4 w-4" />
                      <span>Администратор</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary font-medium text-sm">
              {user?.fullName.split(' ').map(n => n[0]).join('') || '?'}
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-sm font-medium truncate">{user?.fullName || 'Unknown'}</span>
              <Badge variant="secondary" className="w-fit text-xs px-2 py-0">
                {user?.role ? roleLabels[user.role] : 'Unknown'}
              </Badge>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full justify-start text-muted-foreground hover:text-destructive"
            onClick={() => logout()}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Выйти из системы
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
