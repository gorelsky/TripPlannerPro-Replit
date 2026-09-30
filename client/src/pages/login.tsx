import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Building2 } from "lucide-react";
import slsLogo from "@assets/Средний_лого_1773929015411.png";

export default function Login() {
  const [error, setError] = useState("");
  const [oidcEnabled, setOidcEnabled] = useState(false);

  useEffect(() => {
    const authError = new URLSearchParams(window.location.search).get("authError");
    if (authError) setError(authError);
    fetch("/api/auth/yandex/status")
      .then((response) => response.ok ? response.json() : { enabled: false })
      .then((data) => setOidcEnabled(Boolean(data.enabled)))
      .catch(() => setOidcEnabled(false));
  }, []);

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

          {oidcEnabled ? (
            <Button asChild className="w-full" data-testid="button-login-yandex">
              <a href="/api/auth/yandex/start">
                <Building2 className="mr-2 h-4 w-4" />
                Войти через Яндекс 360
              </a>
            </Button>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Корпоративный вход временно недоступен
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
