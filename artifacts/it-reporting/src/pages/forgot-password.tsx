import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { useForgotPassword } from "@workspace/api-client-react";
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

const schema = z.object({ email: z.string().email() });

export default function ForgotPassword() {
  const mutation = useForgotPassword();
  const [submitted, setSubmitted] = useState<{ resetUrl?: string; emailConfigured?: boolean } | null>(null);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: z.infer<typeof schema>) => {
    try {
      const res: any = await mutation.mutateAsync({ data });
      setSubmitted({ resetUrl: res?.resetUrl, emailConfigured: res?.emailConfigured });
    } catch (e: any) {
      toast.error(e.message || "Could not send reset request");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Reset your password</CardTitle>
          <CardDescription>
            Enter the email address associated with your account and we'll send you a link to set a
            new password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-3">
              <p className="text-sm">
                If an account exists for that email, a reset link is on its way. Check your inbox
                and your spam folder. The link is valid for one hour.
              </p>
              {submitted.resetUrl && (
                <div className="rounded border border-yellow-200 bg-yellow-500/10 p-3 text-xs">
                  <p className="font-semibold mb-1">Email is not configured on this server.</p>
                  <p className="mb-2">
                    Use the link below directly to finish resetting your password:
                  </p>
                  <a className="break-all text-primary underline" href={submitted.resetUrl}>
                    {submitted.resetUrl}
                  </a>
                </div>
              )}
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="name@sccc.edu" autoFocus {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={mutation.isPending}>
                  {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send reset link
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
        <CardFooter className="flex justify-center border-t p-4">
          <p className="text-sm text-muted-foreground">
            Remembered it? <Link href="/login" className="text-primary hover:underline">Back to sign in</Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
