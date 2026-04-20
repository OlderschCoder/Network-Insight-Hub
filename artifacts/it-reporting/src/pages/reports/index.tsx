import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import WeeklyIndividual from "@/components/reports/WeeklyIndividual";
import WeeklyTeam from "@/components/reports/WeeklyTeam";
import MonthlyAchievement from "@/components/reports/MonthlyAchievement";
import OpenItemsReport from "@/components/reports/OpenItems";

const TABS = ["individual", "team", "monthly", "open"] as const;
type TabKey = (typeof TABS)[number];

export default function Reports() {
  const [location, setLocation] = useLocation();
  const initial = (() => {
    if (typeof window === "undefined") return "individual";
    const t = new URLSearchParams(window.location.search).get("tab");
    return (TABS as readonly string[]).includes(t || "") ? (t as TabKey) : "individual";
  })();
  const [tab, setTab] = useState<TabKey>(initial);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") !== tab) {
      params.set("tab", tab);
      setLocation(`/reports?${params.toString()}`, { replace: true });
    }
  }, [tab, setLocation]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Weekly individual and team views, monthly achievements, and an open-items dashboard.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 max-w-2xl">
          <TabsTrigger value="individual">Weekly Individual</TabsTrigger>
          <TabsTrigger value="team">Weekly Team</TabsTrigger>
          <TabsTrigger value="monthly">Monthly Achievement</TabsTrigger>
          <TabsTrigger value="open">Open Items</TabsTrigger>
        </TabsList>
        <TabsContent value="individual"><WeeklyIndividual /></TabsContent>
        <TabsContent value="team"><WeeklyTeam /></TabsContent>
        <TabsContent value="monthly"><MonthlyAchievement /></TabsContent>
        <TabsContent value="open"><OpenItemsReport /></TabsContent>
      </Tabs>
    </div>
  );
}
