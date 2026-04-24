import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { useResetPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const schema = z
  .object({
    password: z.string().min(6, "At least 6 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

function tokenFromUrl(): string {
  if (typeof window === "undefined") return "";
  const sp = new URLSearchParams(window.location.search);
  return sp.get("token") ?? "";
}

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const mutation = useResetPassword();
  const [token, setToken] = useState<string>("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setToken(tokenFromUrl());
  }, []);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: z.infer<typeof schema>) => {
    if (!token) {
      toast.error("Missing reset token");
      return;
    }
    try {
      await mutation.mutateAsync({ data: { token, password: data.password } });
      setDone(true);
      toast.success("Password updated");
      setTimeout(() => setLocation("/login"), 1500);
    } catch (e: any) {
      toast.error(e?.message || "Could not reset password — the link may have expired.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Choose a new password</CardTitle>
          <CardDescription>
            Pick something memorable. You'll be signed out everywhere and need to sign back in
            after this.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!token ? (
            <p className="text-sm text-destructive">
              This reset link is missing a token. Please request a new one from the sign-in page.
            </p>
          ) : done ? (
            <p className="text-sm">Password updated. Redirecting to sign in…</p>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New password</FormLabel>
                      <FormControl>
                        <Input type="password" autoFocus {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm new password</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={mutation.isPending}>
                  {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Update password
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
        <CardFooter className="flex justify-center border-t p-4">
          <p className="text-sm text-muted-foreground">
            <Link href="/login" className="text-primary hover:underline">Back to sign in</Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
