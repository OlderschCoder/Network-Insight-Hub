/**
 * Incident Room API
 *
 * POST   /api/incidents                    — create room
 * GET    /api/incidents                    — list rooms
 * GET    /api/incidents/:id               — room detail + messages
 * PATCH  /api/incidents/:id               — update (resolve, rename)
 * POST   /api/incidents/:id/messages      — post a message (triggers Fred if @fred mentioned)
 * POST   /api/incidents/:id/members       — add a member
 * GET    /api/incidents/:id/stream        — SSE stream for real-time messages
 */

import { Router, Response } from "express";
import { db, incidentRoomsTable, incidentMessagesTable, incidentMembersTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "./auth";
import { logger } from "../lib/logger";
import { getKnowledgeContext, runChatWithMemory } from "../lib/ai_knowledge";
import { getOpenAI } from "../lib/openai";

const router = Router();

// ── SSE broadcast registry ────────────────────────────────────────────────────
// roomId → Set of active SSE response objects
const roomStreams = new Map<number, Set<Response>>();

function broadcast(roomId: number, event: string, data: unknown) {
  const clients = roomStreams.get(roomId);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

// ── List rooms ────────────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req: any, res) => {
  try {
    const rooms = await db
      .select()
      .from(incidentRoomsTable)
      .orderBy(desc(incidentRoomsTable.createdAt));
    res.json(rooms);
  } catch (err) {
    logger.error("incidents list", err);
    res.status(500).json({ error: "Failed to list rooms" });
  }
});

// ── Create room ───────────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req: any, res) => {
  const { name, description, severity = "medium" } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: "name required" });

  try {
    const [room] = await db
      .insert(incidentRoomsTable)
      .values({ name: name.trim(), description, severity, createdBy: req.user.id })
      .returning();

    // Auto-add creator as member
    await db.insert(incidentMembersTable).values({ roomId: room.id, userId: req.user.id }).onConflictDoNothing();

    // Fred posts an opening message
    const fredGreeting = `🚨 **Incident room open** — ${name}\n\nI'm here. Tell me what's happening or ask me to check Azure health, run a DNS lookup, pull a switch config, or anything else. Tag me with @fred anytime.`;
    const [fredMsg] = await db
      .insert(incidentMessagesTable)
      .values({ roomId: room.id, authorName: "Fred", isFred: true, content: fredGreeting })
      .returning();

    broadcast(room.id, "message", fredMsg);
    res.status(201).json(room);
  } catch (err) {
    logger.error("incidents create", err);
    res.status(500).json({ error: "Failed to create room" });
  }
});

// ── Get room + messages ───────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  try {
    const [room] = await db.select().from(incidentRoomsTable).where(eq(incidentRoomsTable.id, id));
    if (!room) return res.status(404).json({ error: "Room not found" });

    const messages = await db
      .select()
      .from(incidentMessagesTable)
      .where(eq(incidentMessagesTable.roomId, id))
      .orderBy(incidentMessagesTable.createdAt);

    const members = await db
      .select({ userId: incidentMembersTable.userId, name: usersTable.name, email: usersTable.email })
      .from(incidentMembersTable)
      .innerJoin(usersTable, eq(incidentMembersTable.userId, usersTable.id))
      .where(eq(incidentMembersTable.roomId, id));

    res.json({ ...room, messages, members });
  } catch (err) {
    logger.error("incidents get", err);
    res.status(500).json({ error: "Failed to get room" });
  }
});

// ── Update room (resolve / rename) ────────────────────────────────────────────
router.patch("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const { status, name, severity, description } = req.body ?? {};

  try {
    const updates: Record<string, any> = {};
    if (name) updates.name = name;
    if (severity) updates.severity = severity;
    if (description !== undefined) updates.description = description;
    if (status === "resolved") {
      updates.status = "resolved";
      updates.resolvedBy = req.user.id;
      updates.resolvedAt = new Date();
    }

    const [room] = await db
      .update(incidentRoomsTable)
      .set(updates)
      .where(eq(incidentRoomsTable.id, id))
      .returning();

    if (status === "resolved") {
      const resolvedMsg = `✅ Incident marked resolved by **${req.user.name ?? req.user.email}**.`;
      const [msg] = await db
        .insert(incidentMessagesTable)
        .values({ roomId: id, authorName: "System", isFred: false, content: resolvedMsg })
        .returning();
      broadcast(id, "message", msg);
      broadcast(id, "resolved", { roomId: id });
    }

    res.json(room);
  } catch (err) {
    logger.error("incidents patch", err);
    res.status(500).json({ error: "Failed to update room" });
  }
});

// ── Add member ────────────────────────────────────────────────────────────────
router.post("/:id/members", requireAuth, async (req: any, res) => {
  const roomId = parseInt(req.params.id);
  const { userId } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: "userId required" });

  try {
    await db.insert(incidentMembersTable).values({ roomId, userId }).onConflictDoNothing();

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const joinMsg = `👤 **${user?.name ?? "Someone"}** joined the room.`;
    const [msg] = await db
      .insert(incidentMessagesTable)
      .values({ roomId, authorName: "System", isFred: false, content: joinMsg })
      .returning();

    broadcast(roomId, "message", msg);
    broadcast(roomId, "member_joined", { userId, name: user?.name });
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error("incidents add member", err);
    res.status(500).json({ error: "Failed to add member" });
  }
});

// ── Post message (+ Fred trigger) ────────────────────────────────────────────
router.post("/:id/messages", requireAuth, async (req: any, res) => {
  const roomId = parseInt(req.params.id);
  const { content } = req.body ?? {};
  if (!content?.trim()) return res.status(400).json({ error: "content required" });

  try {
    // Auto-join sender if not already a member
    await db.insert(incidentMembersTable).values({ roomId, userId: req.user.id }).onConflictDoNothing();

    const [msg] = await db
      .insert(incidentMessagesTable)
      .values({ roomId, userId: req.user.id, authorName: req.user.name ?? req.user.email, isFred: false, content: content.trim() })
      .returning();

    broadcast(roomId, "message", msg);
    res.status(201).json(msg);

    // Trigger Fred asynchronously if @fred is mentioned
    if (/@fred/i.test(content)) {
      triggerFred(roomId, req.user.id).catch(err => logger.error("Fred trigger failed", err));
    }
  } catch (err) {
    logger.error("incidents post message", err);
    res.status(500).json({ error: "Failed to post message" });
  }
});

// ── SSE stream ────────────────────────────────────────────────────────────────
router.get("/:id/stream", requireAuth, (req: any, res) => {
  const roomId = parseInt(req.params.id);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Register this client
  if (!roomStreams.has(roomId)) roomStreams.set(roomId, new Set());
  roomStreams.get(roomId)!.add(res);

  // Keepalive ping every 25s
  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(ping); }
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    roomStreams.get(roomId)?.delete(res);
  });
});

// ── Fred async responder ──────────────────────────────────────────────────────
async function triggerFred(roomId: number, triggeredByUserId: number) {
  const [room] = await db.select().from(incidentRoomsTable).where(eq(incidentRoomsTable.id, roomId));

  // Last 30 messages for context
  const recentMsgs = await db
    .select()
    .from(incidentMessagesTable)
    .where(eq(incidentMessagesTable.roomId, roomId))
    .orderBy(desc(incidentMessagesTable.createdAt))
    .limit(30);
  recentMsgs.reverse();

  // Last user message that triggered Fred (strip @fred mention)
  const triggerMsg = [...recentMsgs].reverse().find(m => !m.isFred && /@fred/i.test(m.content));
  const prompt = (triggerMsg?.content ?? "").replace(/@fred/gi, "").trim() || "What's the status?";

  // Build chat history for the AI (all messages before the trigger)
  const priorMessages = recentMsgs
    .filter(m => m.id !== triggerMsg?.id)
    .map(m => ({
      role: (m.isFred ? "assistant" : "user") as "assistant" | "user",
      content: m.isFred ? m.content : `[${m.authorName}]: ${m.content}`,
    }));

  const knowledgeContext = await getKnowledgeContext(undefined, triggeredByUserId);

  const systemPrompt = `You are Fred, the SCCC IT ops assistant. You are active in an incident room: "${room?.name}" (severity: ${room?.severity?.toUpperCase()}).

Be direct and terse — this is a live incident. No corporate hedging. If you can run a diagnostic, run it and share the result. If you don't know something, say so plainly.

You have access to: Azure VM status, Azure health/security/policy, DNS lookup, traceroute, HTTP check, SSL check, SNMP, device config search.
${knowledgeContext ? `\n# SCCC Environment Knowledge\n${knowledgeContext}` : ""}`;

  let fullResponse = "";
  try {
    const result = await runChatWithMemory(getOpenAI(), {
      model: "gpt-5.2",
      maxCompletionTokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        ...priorMessages,
        { role: "user", content: `[${triggerMsg?.authorName ?? "User"}]: ${prompt}` },
      ],
      userId: triggeredByUserId,
      allowTaskCapture: false,
    });
    fullResponse = result.reply;
  } catch (err) {
    fullResponse = `I hit an error trying to respond: ${String(err)}`;
  }

  if (!fullResponse.trim()) return;

  const [fredMsg] = await db
    .insert(incidentMessagesTable)
    .values({ roomId, authorName: "Fred", isFred: true, content: fullResponse.trim() })
    .returning();

  broadcast(roomId, "message", fredMsg);
}

export default router;
