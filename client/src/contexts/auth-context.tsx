import { createContext, useContext, useState, useEffect } from "react";
import { queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  switchUser: (userId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const getSessionHeaders = (): Record<string, string> => {
    const sessionId = localStorage.getItem("sessionId");
    return sessionId ? { "X-Session-ID": sessionId } : {};
  };

  useEffect(() => {
    // Проверяем сохранённую сессию при загрузке
    const checkSession = async () => {
      try {
        const res = await fetch("/api/auth/session", {
          headers: getSessionHeaders(),
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data);
        }
      } catch (error) {
        console.error("Failed to check session:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkSession();
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Ошибка входа. Проверьте email и пароль.");
      }

      const data = await res.json();
      // Store sessionId for environments where cookies are blocked (iframe)
      if (data.sessionId) {
        localStorage.setItem("sessionId", data.sessionId);
      }
      // Clear all cached data so the new user gets their own fresh scope
      queryClient.clear();
      setUser(data);
    } catch (error: any) {
      throw new Error(error.message || "Ошибка входа. Проверьте email и пароль.");
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: getSessionHeaders(),
        credentials: "include",
      });
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      localStorage.removeItem("sessionId");
      queryClient.clear();
      setUser(null);
    }
  };

  const switchUser = async (userId: string) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/switch-user", {
        method: "POST",
        headers: { ...getSessionHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
        credentials: "include",
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Ошибка переключения пользователя");
      }

      const data = await res.json();
      if (data.sessionId) {
        localStorage.setItem("sessionId", data.sessionId);
      }
      // Clear all cached data so the switched user gets their own fresh scope
      queryClient.clear();
      setUser(data);
    } catch (error: any) {
      throw new Error(error.message || "Ошибка переключения пользователя");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, switchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
