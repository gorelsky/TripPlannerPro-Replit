import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Building2, ShieldCheck } from "lucide-react";
import slsLogo from "@assets/Средний_лого_1773929015411.png";

export default function Login() {
  const [error, setError] = useState("");
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [passwordMode, setPasswordMode] = useState(false);
  const [passwordEmail, setPasswordEmail] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    const authError = new URLSearchParams(window.location.search).get("authError");
    if (authError) setError(authError);
    fetch("/api/auth/yandex/status")
      .then((response) => response.ok ? response.json() : { enabled: false })
      .then((data) => setOidcEnabled(Boolean(data.enabled)))
      .catch(() => setOidcEnabled(false));
  }, []);

  async function handleAdminLogin(event: React.FormEvent) {
    event.preventDefault();
    setAdminLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Не удалось выполнить вход администратора");
      window.location.assign("/");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Не удалось выполнить вход администратора");
    } finally {
      setAdminLoading(false);
    }
  }

  async function handlePasswordLogin(event: React.FormEvent) {
    event.preventDefault();
    setPasswordLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/password-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: passwordEmail, password: passwordValue }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Не удалось выполнить вход");
      window.location.assign("/");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Не удалось выполнить вход");
    } finally {
      setPasswordLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4 text-center">
          <div className="flex items-center justify-center mx-auto mb-2">
            <img src={slsLogo} alt="SLS Pharma" className="h-16 object-contain" />
          </div>
          <CardTitle className="text-2xl">Планировщик командировок</CardTitle>
          <CardDescription>
            Войдите с корпоративной учетной записью, чтобы продолжить
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 flex gap-2">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {adminMode ? (
            <form onSubmit={handleAdminLogin} className="space-y-3">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Вход только для учетной записи администратора приложения.
              </div>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                type="email"
                placeholder="Логин администратора"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
                autoComplete="username"
                required
              />
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                type="password"
                placeholder="Пароль администратора"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <Button type="submit" className="w-full" disabled={adminLoading}>
                <ShieldCheck className="mr-2 h-4 w-4" />
                {adminLoading ? "Проверка..." : "Войти как администратор"}
              </Button>
              <button type="button" className="w-full text-center text-sm text-muted-foreground underline underline-offset-4" onClick={() => setAdminMode(false)}>
                Вернуться к входу через Яндекс 360
              </button>
            </form>
          ) : passwordMode ? (
            <form onSubmit={handlePasswordLogin} className="space-y-3">
              <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                Резервный вход по email и паролю из базы приложения.
              </div>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                type="email"
                placeholder="Рабочий email"
                value={passwordEmail}
                onChange={(event) => setPasswordEmail(event.target.value)}
                autoComplete="username"
                required
              />
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                type="password"
                placeholder="Пароль"
                value={passwordValue}
                onChange={(event) => setPasswordValue(event.target.value)}
                autoComplete="current-password"
                required
              />
              <Button type="submit" className="w-full" disabled={passwordLoading}>
                {passwordLoading ? "Проверка..." : "Войти по паролю"}
              </Button>
              <button type="button" className="w-full text-center text-sm text-muted-foreground underline underline-offset-4" onClick={() => setPasswordMode(false)}>
                Вернуться к другим способам входа
              </button>
            </form>
          ) : oidcEnabled ? (
            <div className="space-y-3">
              <Button asChild className="w-full" data-testid="button-login-yandex">
                <a href="/api/auth/yandex/start">
                  <Building2 className="mr-2 h-4 w-4" />
                  Войти через Яндекс 360
                </a>
              </Button>
              <a
                href="/api/auth/yandex/start?account=other"
                className="block text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                data-testid="link-switch-yandex-account"
              >
                Войти под другой учетной записью
              </a>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                onClick={() => { setError(""); setAdminMode(true); }}
              >
                <ShieldCheck className="h-4 w-4" />
                Отдельный вход администратора
              </button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                onClick={() => { setError(""); setPasswordMode(true); }}
              >
                Войти по рабочему email и паролю
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-center text-sm text-muted-foreground">
                Корпоративный вход временно недоступен
              </p>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                onClick={() => { setError(""); setAdminMode(true); }}
              >
                <ShieldCheck className="h-4 w-4" />
                Отдельный вход администратора
              </button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                onClick={() => { setError(""); setPasswordMode(true); }}
              >
                Войти по рабочему email и паролю
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
