import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { authFetch } from "@/lib/authFetch";

const API = import.meta.env.VITE_API_URL || "/api";

type DriverCatalog = {
  configured: boolean;
  printServer: string;
  drivers: string[];
  message?: string;
};

type InstalledPrinter = {
  created: boolean;
  printer: {
    name: string;
    driver: string;
    portName: string;
    shareName: string;
    uncPath: string;
    location: string;
    comment: string;
  };
};

type Notice = {
  kind: "error" | "success";
  title: string;
  message: string;
  uncPath?: string;
};

function responseMessage(payload: any, fallback: string): string {
  if (typeof payload?.message === "string") return payload.message;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  if (typeof payload?.error === "string") return payload.error;
  return fallback;
}

export function isValidIpv4(value: string): boolean {
  const octets = value.trim().split(".");
  return octets.length === 4 && octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const number = Number(octet);
    return number >= 0 && number <= 255 && String(number) === octet;
  });
}

export function isPrivateIpv4(value: string): boolean {
  if (!isValidIpv4(value)) return false;
  const [first, second] = value.split(".").map(Number);
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function InstallPrinterTool() {
  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [driver, setDriver] = useState("");
  const [driverFilter, setDriverFilter] = useState("");
  const [location, setLocation] = useState("");
  const [comment, setComment] = useState("");
  const [catalog, setCatalog] = useState<DriverCatalog | null>(null);
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadDrivers = useCallback(async () => {
    setLoadingDrivers(true);
    setNotice(null);
    try {
      const response = await authFetch(`${API}/network/printers/drivers`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(responseMessage(payload, `Driver lookup failed (${response.status}).`));
      }

      if (
        typeof payload?.configured !== "boolean"
        || typeof payload?.printServer !== "string"
        || !Array.isArray(payload?.drivers)
        || payload.drivers.some((item: unknown) => typeof item !== "string")
      ) {
        throw new Error("Fred returned an invalid print-driver catalog.");
      }
      const nextCatalog = payload as DriverCatalog;
      setCatalog(nextCatalog);
      setDriver((current) => nextCatalog.drivers.includes(current) ? current : "");
      if (!nextCatalog.configured) {
        setNotice({
          kind: "error",
          title: "Printer service is not configured",
          message: nextCatalog.message ?? "Configure Fred's on-prem printer service before installing a queue.",
        });
      } else if (nextCatalog.drivers.length === 0) {
        setNotice({
          kind: "error",
          title: "No registered drivers returned",
          message: `No drivers were returned by ${nextCatalog.printServer}. Register the required driver on the print server, then refresh.`,
        });
      }
    } catch (error: any) {
      setCatalog(null);
      setNotice({
        kind: "error",
        title: "Could not load print-server drivers",
        message: error?.message ?? "Fred could not reach the printer service.",
      });
    } finally {
      setLoadingDrivers(false);
    }
  }, []);

  useEffect(() => {
    void loadDrivers();
  }, [loadDrivers]);

  const filteredDrivers = useMemo(() => {
    const needle = driverFilter.trim().toLocaleLowerCase();
    if (!needle) return catalog?.drivers ?? [];
    return (catalog?.drivers ?? []).filter((item) => item.toLocaleLowerCase().includes(needle));
  }, [catalog?.drivers, driverFilter]);

  const validationError = useMemo(() => {
    if (!name.trim()) return "Enter a printer name.";
    if (!ip.trim()) return "Enter the printer IPv4 address.";
    if (!isValidIpv4(ip)) return "Enter a valid IPv4 address.";
    if (!isPrivateIpv4(ip)) return "Enter an RFC1918 campus printer address.";
    if (!driver) return "Select an exact registered driver.";
    return null;
  }, [driver, ip, name]);

  const canInstall = catalog?.configured === true
    && !loadingDrivers
    && !installing
    && !validationError;

  const handleInstall = async () => {
    if (validationError) {
      setNotice({ kind: "error", title: "Check the printer details", message: validationError });
      return;
    }

    setInstalling(true);
    setNotice(null);
    try {
      const response = await authFetch(`${API}/network/printers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ip: ip.trim(),
          driver,
          location: location.trim(),
          comment: comment.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(responseMessage(payload, `Printer installation failed (${response.status}).`));
      }

      const result = payload as InstalledPrinter;
      if (
        typeof result.created !== "boolean"
        || !result.printer
        || typeof result.printer.name !== "string"
        || typeof result.printer.driver !== "string"
        || typeof result.printer.portName !== "string"
        || typeof result.printer.uncPath !== "string"
      ) {
        throw new Error("Fred returned an invalid printer verification result.");
      }
      setNotice({
        kind: "success",
        title: result.created ? "Shared printer created" : "Shared printer updated",
        message: `${result.printer.name} now uses ${result.printer.driver} on ${result.printer.portName}.`,
        uncPath: result.printer.uncPath,
      });
    } catch (error: any) {
      setNotice({
        kind: "error",
        title: "Printer installation failed",
        message: error?.message ?? "Fred could not configure the print-server queue.",
      });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Printer className="h-5 w-5" /> Add a shared network printer
        </CardTitle>
        <CardDescription>
          Fred creates or updates the queue on {catalog?.printServer || "the configured print server"}.
          Choose the exact registered driver below; Fred never installs or guesses a driver package.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="pr-name">Printer name</Label>
            <Input
              id="pr-name"
              placeholder="West Sharp Copier"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={installing}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pr-ip">Printer IPv4 address</Label>
            <Input
              id="pr-ip"
              inputMode="numeric"
              placeholder="172.25.0.125"
              value={ip}
              onChange={(event) => setIp(event.target.value)}
              disabled={installing}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="pr-driver-filter">Registered print-server driver</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void loadDrivers()}
                disabled={loadingDrivers || installing}
              >
                {loadingDrivers
                  ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  : <RefreshCw className="mr-1.5 h-4 w-4" />}
                Refresh
              </Button>
            </div>
            <Input
              id="pr-driver-filter"
              placeholder="Filter drivers, for example Sharp PCL6"
              value={driverFilter}
              onChange={(event) => setDriverFilter(event.target.value)}
              disabled={loadingDrivers || installing || !catalog?.configured}
            />
            <Select value={driver} onValueChange={setDriver} disabled={loadingDrivers || installing || !catalog?.configured}>
              <SelectTrigger aria-label="Registered print-server driver">
                <SelectValue placeholder={loadingDrivers ? "Loading registered drivers..." : "Select an exact driver"} />
              </SelectTrigger>
              <SelectContent>
                {filteredDrivers.map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!loadingDrivers && catalog?.configured && (
              <p className="text-xs text-muted-foreground">
                {filteredDrivers.length} of {catalog.drivers.length} registered drivers shown.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="pr-loc">Location</Label>
            <Input
              id="pr-loc"
              placeholder="Truck Driving Office Hallway"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              disabled={installing}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pr-comment">Comment</Label>
            <Input
              id="pr-comment"
              placeholder="Optional note"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              disabled={installing}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void handleInstall()} disabled={!canInstall}>
            {installing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {installing ? "Configuring print server..." : "Create or update shared printer"}
          </Button>
          {!installing && validationError && catalog?.configured && (
            <span className="text-sm text-muted-foreground">{validationError}</span>
          )}
        </div>

        {notice && (
          <div
            role={notice.kind === "error" ? "alert" : "status"}
            className={notice.kind === "error"
              ? "rounded-md border border-red-200 bg-red-50 p-4 text-red-800"
              : "rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-800"}
          >
            <div className="flex items-start gap-2">
              {notice.kind === "error"
                ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
              <div className="space-y-1">
                <p className="font-medium">{notice.title}</p>
                <p className="text-sm">{notice.message}</p>
                {notice.uncPath && (
                  <p className="font-mono text-sm">Client path: {notice.uncPath}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
