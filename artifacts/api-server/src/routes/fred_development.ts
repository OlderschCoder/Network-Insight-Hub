import { Router } from "express";
import { requireAuth, requireCIO } from "./auth";
import { developmentRequest } from "../lib/fred_development";
const router=Router();
router.use(requireAuth,requireCIO);
router.get("/:view", async(req,res)=>{
  if(!["status","diff"].includes(String(req.params.view)))return res.status(404).json({error:"Not found"});
  try { res.json(await developmentRequest({action:req.params.view},(req as any).user)); }
  catch(error){res.status(503).json({error:error instanceof Error?error.message:"Development controller unavailable"});}
});
// No model tool exposes these actions. Approval comes from the CIO's authenticated UI request.
router.post("/publish",async(req,res)=>{
  if(req.body?.confirmed!==true||!/^[a-f0-9]{64}$/.test(req.body?.revision||""))return res.status(400).json({error:"Exact validated revision and confirmation required"});
  try{res.json(await developmentRequest({action:"publish",revision:req.body.revision},(req as any).user));}
  catch(error){res.status(400).json({error:error instanceof Error?error.message:"Release failed"});}
});
router.post("/rollback",async(req,res)=>{
  if(req.body?.confirmed!==true)return res.status(400).json({error:"Confirmation required"});
  try{res.json(await developmentRequest({action:"rollback"},(req as any).user));}
  catch(error){res.status(400).json({error:error instanceof Error?error.message:"Rollback failed"});}
});
export default router;
