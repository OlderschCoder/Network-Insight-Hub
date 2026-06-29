import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/layout";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";

import Login from "@/pages/login";
import Register from "@/pages/register";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import { ConfirmDialogProvider } from "@/components/ConfirmDialog";
import Dashboard from "@/pages/dashboard";
import Entries from "@/pages/entries/index";
import NewEntry from "@/pages/entries/new";
import EntryDetail from "@/pages/entries/[id]";
import EditEntry from "@/pages/entries/edit";
import Items from "@/pages/items/index";
import Reports from "@/pages/reports/index";
import ReportDetail from "@/pages/reports/[id]";
import Risks from "@/pages/risks/index";
import NewRisk from "@/pages/risks/new";
import EditRisk from "@/pages/risks/edit";
import RiskDetail from "@/pages/risks/[id]";
import Network from "@/pages/network/index";
import NetworkVisualize from "@/pages/network/visualize";
import AfterAction from "@/pages/after-action/index";
import NewAfterAction from "@/pages/after-action/new";
import AfterActionDetail from "@/pages/after-action/[id]";
import Admin from "@/pages/admin/index";
import AIReport from "@/pages/ai-report/index";
import ProcessesIndex from "@/pages/processes/index";
import NewProcess from "@/pages/processes/new";
import ProcessDetail from "@/pages/processes/[id]";
import ProjectsIndex from "@/pages/projects/index";
import NewProject from "@/pages/projects/new";
import ProjectDetail from "@/pages/projects/[id]";
import StrategicObjectivesIndex from "@/pages/strategic-objectives/index";
import AzureVms from "@/pages/azure-vms/index";
import Monitoring from "@/pages/monitoring/index";
import ITApps from "@/pages/it-apps/index";
import AnalyticsPage from "@/pages/analytics/index";
import DesignSystem from "@/pages/design-system/index";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component, adminOnly = false }: { component: React.ComponentType, adminOnly?: boolean }) {
  const { isAuthenticated, isLoading, isCIO } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return <div className="h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (!isAuthenticated) {
    setLocation("/login");
    return null;
  }

  if (adminOnly && !isCIO) {
    return <div className="h-screen flex flex-col items-center justify-center p-4 text-center">
      <h2 className="text-2xl font-bold">Access Denied</h2>
      <p className="text-muted-foreground mt-2">You need CIO privileges to view this page.</p>
    </div>;
  }

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/design-system" component={DesignSystem} />

      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      
      <Route path="/items" component={() => <ProtectedRoute component={Items} />} />
      <Route path="/entries" component={() => <ProtectedRoute component={Entries} />} />
      <Route path="/entries/new" component={() => <ProtectedRoute component={NewEntry} />} />
      <Route path="/entries/:id/edit" component={() => <ProtectedRoute component={EditEntry} />} />
      <Route path="/entries/:id" component={() => <ProtectedRoute component={EntryDetail} />} />
      
      <Route path="/reports" component={() => <ProtectedRoute component={Reports} />} />
      <Route path="/reports/:id" component={() => <ProtectedRoute component={ReportDetail} />} />
      
      <Route path="/projects" component={() => <ProtectedRoute component={ProjectsIndex} />} />
      <Route path="/projects/new" component={() => <ProtectedRoute component={NewProject} />} />
      <Route path="/projects/:id" component={() => <ProtectedRoute component={ProjectDetail} />} />

      <Route path="/strategic-objectives" component={() => <ProtectedRoute component={StrategicObjectivesIndex} />} />

      <Route path="/risks" component={() => <ProtectedRoute component={Risks} />} />
      <Route path="/risks/new" component={() => <ProtectedRoute component={NewRisk} />} />
      <Route path="/risks/:id/edit" component={() => <ProtectedRoute component={EditRisk} />} />
      <Route path="/risks/:id" component={() => <ProtectedRoute component={RiskDetail} />} />
      
      <Route path="/network" component={() => <ProtectedRoute component={Network} />} />
      <Route path="/network/visualize" component={() => <ProtectedRoute component={NetworkVisualize} />} />
      <Route path="/azure-vms" component={() => <ProtectedRoute component={AzureVms} />} />
      <Route path="/monitoring" component={() => <ProtectedRoute component={Monitoring} />} />
      <Route path="/it-apps" component={() => <ProtectedRoute component={ITApps} />} />
      
      <Route path="/after-action" component={() => <ProtectedRoute component={AfterAction} />} />
      <Route path="/after-action/new" component={() => <ProtectedRoute component={NewAfterAction} />} />
      <Route path="/after-action/:id" component={() => <ProtectedRoute component={AfterActionDetail} />} />
      
      <Route path="/ai-report" component={() => <ProtectedRoute component={AIReport} />} />

      <Route path="/processes" component={() => <ProtectedRoute component={ProcessesIndex} />} />
      <Route path="/processes/new" component={() => <ProtectedRoute component={NewProcess} />} />
      <Route path="/processes/:id" component={() => <ProtectedRoute component={ProcessDetail} />} />

      <Route path="/admin" component={() => <ProtectedRoute component={Admin} adminOnly={true} />} />
      <Route path="/analytics" component={() => <ProtectedRoute component={AnalyticsPage} adminOnly={true} />} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <ConfirmDialogProvider>
              <Router />
            </ConfirmDialogProvider>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
