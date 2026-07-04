import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { useLogin, useEntraStatus, useEntraExchange } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

// Full-page navigation to the API's OIDC start route (relative to origin, the
// same base the generated API client uses for /api).
const ENTRA_LOGIN_URL = "/api/auth/entra/login";

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="h-4 w-4" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function Login() {
  const loginMutation = useLogin();
  const exchangeMutation = useEntraExchange();
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [showBreakGlass, setShowBreakGlass] = useState(false);
  const [exchanging, setExchanging] = useState(false);

  const { data: entraStatus } = useEntraStatus({
    query: { retry: false } as any,
  });
  const ssoConfigured = entraStatus?.configured ?? false;

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  // Handle the SSO callback landing: ?entra_code=... (redeem for a token) or
  // ?entra_error=... (show the refusal reason). Cleans the URL afterwards.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("entra_error");
    const code = params.get("entra_code");
    if (err) {
      toast.error(err);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (code) {
      setExchanging(true);
      window.history.replaceState({}, "", window.location.pathname);
      exchangeMutation
        .mutateAsync({ data: { code } })
        .then((res) => {
          login(res.token, res.user);
        })
        .catch((e: any) => {
          toast.error(e?.message || "Microsoft sign-in failed");
          setExchanging(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (data: z.infer<typeof schema>) => {
    try {
      const res = await loginMutation.mutateAsync({ data });
      login(res.token, res.user);
    } catch (e: any) {
      toast.error(e.message || "Failed to login");
    }
  };

  if (exchanging) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Signing you in…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">SCCC IT Hub</CardTitle>
          <CardDescription>Sign in with your SCCC Microsoft account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              window.location.href = ENTRA_LOGIN_URL;
            }}
            disabled={ssoConfigured === false && !!entraStatus}
          >
            <MicrosoftLogo />
            <span className="ml-2">Sign in with Microsoft</span>
          </Button>
          {entraStatus && !ssoConfigured && (
            <p className="text-center text-xs text-muted-foreground">
              Microsoft sign-in isn't configured yet. Use the emergency login below.
            </p>
          )}

          {!showBreakGlass ? (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowBreakGlass(true)}
                className="text-xs text-muted-foreground hover:text-primary hover:underline"
              >
                Use emergency (break-glass) login
              </button>
            </div>
          ) : (
            <div className="space-y-4 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                Emergency access for administrators when Microsoft sign-in is unavailable.
              </p>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="name@sccc.edu" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" variant="secondary" className="w-full" disabled={loginMutation.isPending}>
                    {loginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Sign in
                  </Button>
                  <div className="text-center text-sm">
                    <Link href="/forgot-password" className="text-muted-foreground hover:text-primary hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                </form>
              </Form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
