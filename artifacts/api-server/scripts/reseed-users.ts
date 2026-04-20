import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const PASSWORD = "Seward#1";

const targets = [
  { email: "mark.bojeun@sccc.edu", name: "Mark Bojeun", role: "cio", department: "IT Leadership" },
  { email: "tracy.compaan@sccc.edu", name: "Tracy Compaan", role: "helpdesk", department: "Help Desk" },
  { email: "cecil.stoll@sccc.edu", name: "Cecil Stoll", role: "network_engineer", department: "Network" },
  { email: "craig.dusek@sccc.edu", name: "Craig Dusek", role: "helpdesk", department: "Help Desk" },
  { email: "matt_song@oculusit.com", name: "Matt Song", role: "staff", department: "Project Management" },
  { email: "illia.ivanov@sccc.edu", name: "Illia Ivanov", role: "helpdesk", department: "Help Desk" },
  { email: "lucas.gonzalezram81@sccc.edu", name: "Lucas Gonzales", role: "security_engineer", department: "Network Security" },
];

const hash = await bcrypt.hash(PASSWORD, 10);
const existing = await db.select().from(usersTable);
const byEmail = new Map(existing.map((u) => [u.email, u]));

const desiredEmails = new Set(targets.map((t) => t.email));

// Repurpose the legacy cio@sccc.edu (if present and not in target list) into Mark Bojeun
// This preserves all FK references (entries, reports, etc.) tied to the original CIO.
const legacyCio = byEmail.get("cio@sccc.edu");
const markTarget = targets.find((t) => t.email === "mark.bojeun@sccc.edu")!;
if (legacyCio && !byEmail.has(markTarget.email)) {
  await db
    .update(usersTable)
    .set({
      email: markTarget.email,
      name: markTarget.name,
      role: markTarget.role,
      department: markTarget.department,
      passwordHash: hash,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, legacyCio.id));
  console.log(`  ~ rewrote ${legacyCio.email} (id=${legacyCio.id}) -> ${markTarget.email}`);
  byEmail.delete(legacyCio.email);
  byEmail.set(markTarget.email, { ...legacyCio, ...markTarget });
}

for (const t of targets) {
  const found = byEmail.get(t.email);
  if (found) {
    await db
      .update(usersTable)
      .set({
        name: t.name,
        role: t.role,
        department: t.department,
        passwordHash: hash,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, found.id));
    console.log(`  ~ updated ${t.email} (${t.role})`);
  } else {
    await db.insert(usersTable).values({ ...t, passwordHash: hash });
    console.log(`  + inserted ${t.email} (${t.role})`);
  }
}

// Try to remove any leftover users not in the target list (only if they have no FK refs)
for (const u of existing) {
  if (desiredEmails.has(u.email)) continue;
  if (u.email === "cio@sccc.edu" && legacyCio) continue; // already rewritten
  try {
    await db.delete(usersTable).where(eq(usersTable.id, u.id));
    console.log(`  - deleted ${u.email}`);
  } catch (e: any) {
    console.log(`  ! kept ${u.email} (still referenced)`);
  }
}

const final = await db.select().from(usersTable);
console.log(`\n${final.length} users total. Password for all: ${PASSWORD}`);
process.exit(0);
