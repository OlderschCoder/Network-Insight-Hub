import { useState } from "react";
import { useListUsers, useUpdateUser } from "@workspace/api-client-react";
import type { UpdateUserBody } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { authFetch } from "@/lib/authFetch";
import { Users, Shield, Trash2, UserPlus } from "lucide-react";

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
  const [editingDetails, setEditingDetails] = useState<Record<number, { name: string; department: string }>>({});
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    role: "staff",
    department: "IT Services",
  });
  const [saving, setSaving] = useState(false);

  const requireOk = async (response: Response) => {
    if (response.ok) return response;
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Request failed (${response.status})`);
  };

  const refreshUsers = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/users"] });

  const handleAddUser = async () => {
    if (!newUser.name.trim() || !newUser.email.trim()) {
      toast({ title: "Name and email are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await requireOk(await authFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      }));
      await refreshUsers();
      setNewUser({ name: "", email: "", role: "staff", department: "IT Services" });
      toast({ title: "IT staff member added" });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Failed to add user",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

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

  const handleSaveDetails = async (userId: number) => {
    const details = editingDetails[userId];
    if (!details) return;
    setSaving(true);
    try {
      await updateMutation.mutateAsync({ id: userId, data: details });
      await refreshUsers();
      setEditingDetails((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      toast({ title: "User details updated" });
    } catch {
      toast({ title: "Failed to update user", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId: number, name: string) => {
    if (!window.confirm(`Permanently delete the inactive account for ${name}?`)) return;
    setSaving(true);
    try {
      await requireOk(await authFetch(`/api/users/${userId}`, { method: "DELETE" }));
      await refreshUsers();
      toast({ title: "Inactive test account deleted" });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Failed to delete user",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Shield className="h-7 w-7 text-primary" />
        <h1 className="text-3xl font-bold tracking-tight">Admin: User Management</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Add IT Staff
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Input
            placeholder="Full name"
            value={newUser.name}
            onChange={(e) => setNewUser((v) => ({ ...v, name: e.target.value }))}
          />
          <Input
            type="email"
            placeholder="name@sccc.edu"
            value={newUser.email}
            onChange={(e) => setNewUser((v) => ({ ...v, email: e.target.value }))}
          />
          <Input
            placeholder="Department"
            value={newUser.department}
            onChange={(e) => setNewUser((v) => ({ ...v, department: e.target.value }))}
          />
          <Select
            value={newUser.role}
            onValueChange={(role) => setNewUser((v) => ({ ...v, role }))}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cio">CIO</SelectItem>
              <SelectItem value="network_engineer">Network Engineer</SelectItem>
              <SelectItem value="security_engineer">Security Engineer</SelectItem>
              <SelectItem value="helpdesk">Help Desk</SelectItem>
              <SelectItem value="staff">Staff</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => void handleAddUser()} disabled={saving} className="md:col-span-2">
            Add staff member
          </Button>
        </CardContent>
      </Card>

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
                      <Input
                        className="h-8 max-w-xs font-medium"
                        value={editingDetails[user.id]?.name ?? user.name}
                        onChange={(e) => setEditingDetails((prev) => ({
                          ...prev,
                          [user.id]: {
                            name: e.target.value,
                            department: prev[user.id]?.department ?? user.department ?? "",
                          },
                        }))}
                      />
                      {user.isActive === false && (
                        <Badge variant="destructive" className="text-xs">Inactive</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                    <Input
                      className="mt-1 h-7 max-w-xs text-xs"
                      placeholder="Department"
                      value={editingDetails[user.id]?.department ?? user.department ?? ""}
                      onChange={(e) => setEditingDetails((prev) => ({
                        ...prev,
                        [user.id]: {
                          name: prev[user.id]?.name ?? user.name,
                          department: e.target.value,
                        },
                      }))}
                    />
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
                    {editingDetails[user.id] && (
                      <Button size="sm" onClick={() => void handleSaveDetails(user.id)} disabled={saving}>
                        Save details
                      </Button>
                    )}
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
                    {user.isActive === false && (
                      <Button
                        variant="destructive"
                        size="icon"
                        title="Delete inactive account"
                        onClick={() => void handleDelete(user.id, user.name)}
                        disabled={saving}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
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
