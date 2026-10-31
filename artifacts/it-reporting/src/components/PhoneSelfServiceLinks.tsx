import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, ExternalLink, PhoneCall, Settings2 } from "lucide-react";

const USER_HUB_URL = "https://user.webex.com";
const WEBEX_DOWNLOAD_URL = "https://www.webex.com/downloads.html";

export function PhoneSelfServiceLinks({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PhoneCall className="h-4 w-4" />
            Phone & Webex Self-Service
          </CardTitle>
          <CardDescription>
            Staff and faculty can manage call forwarding, Do Not Disturb, voicemail, and device settings in Webex User Hub.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="default" asChild>
              <a href={USER_HUB_URL} target="_blank" rel="noopener noreferrer">
                <Settings2 className="mr-2 h-4 w-4" />
                Open User Hub
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={WEBEX_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" />
                Download Webex
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            If the account has a Webex Calling license, the Calling section appears after sign-in.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <PhoneCall className="h-5 w-5" />
          Phone & Webex Self-Service
        </h2>
        <p className="text-sm text-muted-foreground">
          Staff and faculty can use Cisco&apos;s own self-service pages to manage forwarding, Do Not Disturb, voicemail, devices, and the Webex app.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Manage phone settings</CardTitle>
            <CardDescription>
              Open Webex User Hub to manage call forwarding, Do Not Disturb, voicemail, schedules, and device options.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild>
              <a href={USER_HUB_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Open Webex User Hub
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Users only see Calling settings there if their account has a Webex Calling license.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Get the Webex app</CardTitle>
            <CardDescription>
              Download the desktop or mobile Webex app to access calling, messaging, meetings, and additional call settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" asChild>
              <a href={WEBEX_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" />
                Download Webex
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              The app can also link users into additional calling settings after sign-in.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
