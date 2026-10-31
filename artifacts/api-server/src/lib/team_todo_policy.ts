export type TodoActor = {
  id: number;
  role?: string | null;
  canManageTodos?: boolean | null;
};

export function canManageTeamTodos(actor: TodoActor): boolean {
  return actor.role === "cio" || actor.canManageTodos === true;
}

export function canAccessTodo(actor: TodoActor, assigneeId: number): boolean {
  return canManageTeamTodos(actor) || actor.id === assigneeId;
}

export function todoAssigneeForCreate(
  actor: TodoActor,
  requestedAssigneeId?: number,
): number | null {
  if (requestedAssigneeId === undefined || requestedAssigneeId === actor.id) {
    return requestedAssigneeId ?? actor.id;
  }
  return canManageTeamTodos(actor) ? requestedAssigneeId : null;
}
