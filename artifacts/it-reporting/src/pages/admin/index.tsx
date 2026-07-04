import { useState } from "react";
import { useListUsers, useUpdateUser } from "@workspace/api-client-react";
import type { UpdateUserBody } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Users, Shield } from "lucide-react";

const roleColor: Record<string, string> = {
  cio: "bg-purple-500/10 text-purple-700 border-purple-200",
  network_engineer: "bg-blue-500/10 text-blue-700 border-blue-200",
  security_engineer: "bg-red-500/10 text-red-700 border-red-200",
  helpdesk: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  staff: "bg-muted text-muted-foreground border-border",
};

const roleLabels: Record<string, string> = {
  cio: "CIO",
  network_engineer: "Network Engineer",
  security_engineer: "Security Engineer",
  helpdesk: "Help Desk",
  staff: "Staff",
};

export default function Admin() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: users, isLoading } = useListUsers();
  const updateMutation = useUpdateUser();
  const [editingRole, setEditingRole] = useState<Record<number, string>>({});

  const handleRoleChange = (userId: number, newRole: string) => {
    setEditingRole((prev) => ({ ...prev, [userId]: newRole }));
  };

  const handleSaveRole = async (userId: number) => {
    const newRole = editingRole[userId];
    if (!newRole) return;
    try {
      await updateMutation.mutateAsync({ id: userId, data: { role: newRole as any } });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User updated" });
      setEditingRole((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    } catch {
      toast({ title: "Failed to update user", variant: "destructive" });
    }
  };

  const handleActiveToggle = async (userId: number, currentActive: boolean) => {
    try {
      await updateMutation.mutateAsync({ id: userId, data: { isActive: !currentActive } });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: currentActive ? "User deactivated" : "User activated" });
    } catch {
      toast({ title: "Failed to update user", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Shield className="h-7 w-7 text-primary" />
        <h1 className="text-3xl font-bold tracking-tight">Admin: User Management</h1>
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">Loading...</div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Users ({(users ?? []).length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(users ?? []).map((user) => (
                <div
                  key={user.id}
                  data-testid={`user-row-${user.id}`}
                  className={`flex items-center gap-4 p-3 rounded-lg border ${
                    user.isActive !== false ? "border-border" : "border-destructive/20 opacity-60"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{user.name}</p>
                      {user.isActive === false && (
                        <Badge variant="destructive" className="text-xs">Inactive</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                    {user.jobTitle && (
                      <p className="text-xs text-muted-foreground truncate">{user.jobTitle}</p>
                    )}
                  </div>

                  <Badge
                    variant="outline"
                    className={roleColor[user.role ?? "staff"] ?? ""}
                  >
                    {roleLabels[user.role ?? "staff"] ?? user.role}
                  </Badge>

                  <div className="flex items-center gap-2">
                    <Select
                      value={editingRole[user.id] ?? user.role ?? "staff"}
                      onValueChange={(val) => handleRoleChange(user.id, val)}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cio">CIO</SelectItem>
                        <SelectItem value="network_engineer">Network Engineer</SelectItem>
                        <SelectItem value="security_engineer">Security Engineer</SelectItem>
                        <SelectItem value="helpdesk">Help Desk</SelectItem>
                        <SelectItem value="staff">Staff</SelectItem>
                      </SelectContent>
                    </Select>

                    {editingRole[user.id] && editingRole[user.id] !== user.role && (
                      <Button
                        size="sm"
                        onClick={() => handleSaveRole(user.id)}
                        disabled={updateMutation.isPending}
                      >
                        Save
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-toggle-active-${user.id}`}
                      onClick={() => handleActiveToggle(user.id, user.isActive !== false)}
                      disabled={updateMutation.isPending}
                    >
                      {user.isActive !== false ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
