import { describe, expect, it } from "vitest";
import {
  canAccessTodo,
  canManageTeamTodos,
  todoAssigneeForCreate,
} from "./team_todo_policy";

describe("team to-do permissions", () => {
  it("allows the CIO and delegated managers to manage the team", () => {
    expect(canManageTeamTodos({ id: 1, role: "cio" })).toBe(true);
    expect(
      canManageTeamTodos({ id: 2, role: "helpdesk", canManageTodos: true }),
    ).toBe(true);
    expect(canManageTeamTodos({ id: 3, role: "staff" })).toBe(false);
  });

  it("keeps ordinary users scoped to their own assignments", () => {
    const staff = { id: 7, role: "staff" };
    expect(canAccessTodo(staff, 7)).toBe(true);
    expect(canAccessTodo(staff, 8)).toBe(false);
    expect(todoAssigneeForCreate(staff, 7)).toBe(7);
    expect(todoAssigneeForCreate(staff, 8)).toBeNull();
  });

  it("lets managers assign work to another team member", () => {
    const tracy = { id: 2, role: "helpdesk", canManageTodos: true };
    expect(todoAssigneeForCreate(tracy, 9)).toBe(9);
    expect(canAccessTodo(tracy, 9)).toBe(true);
  });
});
