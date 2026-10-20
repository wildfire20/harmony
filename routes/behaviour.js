const express=require('express');
const {authenticate,authorize}=require('../middleware/auth');
const service=require('../services/behaviourService');
const router=express.Router();
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.use(authenticate,authorize('parent','teacher','admin','super_admin'));
router.use((req,res,next)=>{
  if(['POST','PATCH'].includes(req.method)&&!req.is('application/json'))return res.status(415).json({message:'Please submit the form as JSON.'});
  next();
});
const handle=fn=>async(req,res)=>{
  try{await fn(req,res);}catch(e){
    if(['42P01','42703'].includes(e.code))return res.status(503).json({message:'Merits & Demerits is not available yet. Please contact the school office.'});
    if(e.code==='23505')return res.status(409).json({message:'That code already exists. Refresh and try again.'});
    if(e.status)return res.status(e.status).json({message:e.message});
    console.error('Behaviour request failed',{code:e.code||'UNEXPECTED'});
    res.status(500).json({message:'Unable to save or load this record. Please try again.'});
  }
};
router.get('/alerts',handle(async(req,res)=>res.json(await service.adminAlerts(req.user,req.query))));
router.get('/learners',handle(async(req,res)=>res.json(await service.listLearners(req.user,req.query.q||''))));
router.get('/catalogue',handle(async(req,res)=>res.json(await service.catalogue(req.user))));
router.post('/catalogue',handle(async(req,res)=>res.status(201).json(await service.saveType(req.user,req.body))));
router.patch('/catalogue/:id',handle(async(req,res)=>res.json(await service.saveType(req.user,req.body,req.params.id))));
router.get('/records',handle(async(req,res)=>res.json(await service.records(req.user,req.query))));
router.post('/records',handle(async(req,res)=>{const r=await service.createRecord(req.user,req.body);res.status(r.duplicate?200:201).json(r);}));
router.post('/records/:id/void',handle(async(req,res)=>res.json(await service.voidRecord(req.user,req.params.id,req.body))));
module.exports=router;
