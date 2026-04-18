import { Router } from "express";
import { db, networkSwitchesTable, vlansTable } from "@workspace/db";
import { eq, and, or, ilike, desc } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

router.get("/switches", requireAuth, async (req: any, res) => {
  const { q, building, status } = req.query;
  let switches;
  if (q) {
    switches = await db.select().from(networkSwitchesTable).where(
      or(
        ilike(networkSwitchesTable.hostname, `%${q}%`),
        ilike(networkSwitchesTable.building, `%${q}%`),
        ilike(networkSwitchesTable.ipAddress, `%${q}%`),
        ilike(networkSwitchesTable.model, `%${q}%`)
      )
    ).orderBy(networkSwitchesTable.building);
  } else {
    const conditions: any[] = [];
    if (building) conditions.push(ilike(networkSwitchesTable.building, `%${building}%`));
    if (status) conditions.push(eq(networkSwitchesTable.status, status as string));
    switches = conditions.length > 0
      ? await db.select().from(networkSwitchesTable).where(and(...conditions)).orderBy(networkSwitchesTable.building)
      : await db.select().from(networkSwitchesTable).orderBy(networkSwitchesTable.building);
  }
  return res.json(switches);
});

router.post("/switches", requireAuth, async (req: any, res) => {
  const schema = z.object({
    hostname: z.string().min(1),
    building: z.string().min(1),
    ipAddress: z.string().min(1),
    model: z.string().optional(),
    status: z.enum(["online", "offline", "unknown"]).optional(),
    configFile: z.string().optional(),
    notes: z.string().optional(),
    location: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [sw] = await db.insert(networkSwitchesTable).values(parsed.data).returning();
  return res.status(201).json(sw);
});

router.get("/switches/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const [sw] = await db.select().from(networkSwitchesTable).where(eq(networkSwitchesTable.id, id));
  if (!sw) return res.status(404).json({ error: "Not found" });
  return res.json(sw);
});

router.patch("/switches/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const schema = z.object({
    hostname: z.string().optional(),
    building: z.string().optional(),
    ipAddress: z.string().optional(),
    model: z.string().optional(),
    status: z.enum(["online", "offline", "unknown"]).optional(),
    configFile: z.string().optional(),
    notes: z.string().optional(),
    location: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [sw] = await db.update(networkSwitchesTable).set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(networkSwitchesTable.id, id)).returning();
  if (!sw) return res.status(404).json({ error: "Not found" });
  return res.json(sw);
});

router.get("/vlans", requireAuth, async (req: any, res) => {
  const { q, building, type } = req.query;
  let vlans;
  if (q) {
    vlans = await db.select().from(vlansTable).where(
      or(
        ilike(vlansTable.name, `%${q}%`),
        ilike(vlansTable.building, `%${q}%`),
        ilike(vlansTable.description, `%${q}%`),
        ilike(vlansTable.subnet, `%${q}%`)
      )
    ).orderBy(vlansTable.vlanId);
  } else {
    const conditions: any[] = [];
    if (building) conditions.push(ilike(vlansTable.building, `%${building}%`));
    if (type) conditions.push(eq(vlansTable.type, type as string));
    vlans = conditions.length > 0
      ? await db.select().from(vlansTable).where(and(...conditions)).orderBy(vlansTable.vlanId)
      : await db.select().from(vlansTable).orderBy(vlansTable.vlanId);
  }
  return res.json(vlans);
});

router.post("/vlans", requireAuth, async (req: any, res) => {
  const schema = z.object({
    vlanId: z.number().int(),
    name: z.string().min(1),
    description: z.string().optional(),
    building: z.string().min(1),
    type: z.enum(["data", "voice", "ospf", "management", "security", "other"]),
    subnet: z.string().optional(),
    gateway: z.string().optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [vlan] = await db.insert(vlansTable).values(parsed.data).returning();
  return res.status(201).json(vlan);
});

export default router;
