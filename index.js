import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Resend } from 'resend';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = Number(process.env.PORT || 8787);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.APP_ORIGIN || 'http://localhost:5173', methods: ['GET','POST'], allowedHeaders: ['Content-Type','x-admin-token'] }));
app.use(express.json({ limit: '150kb' }));
const generalLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Please wait a little and try again.' } });
const contactLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many messages from this connection. Please try again later.' } });
app.use('/api', generalLimit);
const clean = (s, max=5000) => typeof s === 'string' ? s.trim().slice(0,max) : '';
const emailOk = s => /^[^\s<>(),;:"\[\]]+@[^\s<>(),;:"\[\]]+\.[^\s<>(),;:"\[\]]+$/.test(s) && s.length <= 254;
const plain = s => clean(s).replace(/[\r\n\t]+/g,' ').replace(/<[^>]*>/g,'');
const resend = () => process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const ai = () => process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
app.get('/api/health', (_req,res) => res.json({ ok:true, service:'Ivy6 API', integrations:{ email:!!(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL), ai:!!process.env.OPENAI_API_KEY, supabase:!!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY), adzuna:!!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) } }));

app.post('/api/contact', contactLimit, async (req,res) => {
  const body = req.body || {};
  if (body.website) return res.status(200).json({ ok:true }); // honeypot: quietly drop bots
  const name=plain(body.name,100), email=clean(body.email,254), category=plain(body.category,80), subject=plain(body.subject,150), message=clean(body.message,5000);
  if (name.length < 2 || !emailOk(email) || !subject || message.length < 10 || !['General enquiry','Technical support','Job listing issue','Employer enquiry','Partnership','Feedback','Other'].includes(category)) return res.status(400).json({ error:'Please check your name, email, category, subject, and message, then try again.' });
  if (body.consent !== true) return res.status(400).json({ error:'Please confirm that Ivy6 can use these details to respond.' });
  const mailer = resend();
  if (!mailer || !process.env.RESEND_FROM_EMAIL) return res.status(503).json({ error:'Email delivery is not configured yet. Add RESEND_API_KEY and a verified RESEND_FROM_EMAIL on the server.' });
  const submitted = new Date().toISOString();
  try {
    const result = await mailer.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: [process.env.CONTACT_TO_EMAIL || 'Glowwithivyx@gmail.com'],
      replyTo: email,
      subject: `[Ivy6 ${category}] ${subject}`,
      text: `New Ivy6 contact enquiry\n\nName: ${name}\nEmail: ${email}\nCategory: ${category}\nSubject: ${subject}\nSubmitted at: ${submitted}\n\nMessage:\n${message}\n`,
      html: `<h2>New Ivy6 contact enquiry</h2><p><b>Name:</b> ${escapeHtml(name)}</p><p><b>Email:</b> ${escapeHtml(email)}</p><p><b>Category:</b> ${escapeHtml(category)}</p><p><b>Subject:</b> ${escapeHtml(subject)}</p><p><b>Submitted at:</b> ${escapeHtml(submitted)}</p><hr/><p>${escapeHtml(message).replace(/\n/g,'<br/>')}</p>`
    });
    if (result.error) { console.error('Resend error', result.error); return res.status(502).json({ error:'The email service could not accept your message. Please try again later.' }); }
    return res.status(200).json({ ok:true, id:result.data?.id || null });
  } catch (err) { console.error('Contact delivery failed', err?.message || err); return res.status(502).json({ error:'We could not send your message right now. Please try again later.' }); }
});
function escapeHtml(value='') { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

const SYSTEM = `You are Ivy6 Career Companion, a warm, practical, honest career-support assistant. Help with job searching, CVs, cover letters, interview preparation, career paths, professional communication, and understanding job descriptions. Never invent a user's credentials, employers, qualifications, or job listings. Never claim to have checked live listings unless real listings are supplied. Never guarantee hiring outcomes. Offer manageable next steps and kind constructive feedback. Keep advice clear and accessible.`;
async function completion(messages, max_tokens=900) {
  const client=ai(); if(!client) { const e=new Error('AI service is not configured. Add OPENAI_API_KEY to the server environment.'); e.status=503; throw e; }
  const cleanMessages=Array.isArray(messages)?messages.slice(-14).map(m=>({role:['assistant','user'].includes(m.role)?m.role:'user',content:clean(m.content ?? m.text,8000)})).filter(m=>m.content):[];
  const result=await client.chat.completions.create({model:process.env.OPENAI_MODEL || 'gpt-4.1-mini',messages:[{role:'system',content:SYSTEM},...cleanMessages],max_tokens,temperature:0.6});
  return result.choices?.[0]?.message?.content || 'I couldn’t prepare a reply just now. Please try again.';
}
app.post('/api/ai/chat', async (req,res) => { try { const messages=Array.isArray(req.body?.messages)?req.body.messages:[]; if(!messages.length) return res.status(400).json({error:'Add a message to start the conversation.'}); const reply=await completion(messages.map(m=>({role:m.role,content:m.text}))); res.json({reply}); } catch(e) { res.status(e.status||502).json({error:e.status===503?e.message:'The AI assistant is having trouble right now. Please try again.'}); } });
app.post('/api/ai/cv-review', async (req,res) => { const {cv,jobDescription,consent}=req.body||{}; if(consent!==true) return res.status(400).json({error:'Consent is required before sending CV text for review.'}); if(!clean(cv,30000)) return res.status(400).json({error:'Please provide CV text to review.'}); try {const reply=await completion([{role:'user',content:`Review the following CV for clarity, formatting, skills relevance, keywords, and improvement opportunities. Be constructive and specific. Do not invent or rewrite facts as if they were true; mark suggested wording as a draft. If a job description is provided, compare it carefully without predicting hiring outcomes.\n\nCV:\n${clean(cv,30000)}\n\nJob description:\n${clean(jobDescription,12000)||'Not provided'}`}],1200);res.json({reply});}catch(e){res.status(e.status||502).json({error:e.status===503?e.message:'CV review is temporarily unavailable.'});} });
app.post('/api/ai/cover-letter', async(req,res)=>{const d=req.body||{};try{const reply=await completion([{role:'user',content:`Draft a tailored cover letter using only these user-provided details. Do not fabricate experience or qualifications. If a field is missing, use a neutral formulation or an obvious editable placeholder. Tone: ${clean(d.tone,80)}. Name: ${clean(d.name,150)}. Role: ${clean(d.role,150)}. Company: ${clean(d.company,150)}. Relevant skills: ${clean(d.skills,1000)}. Experience/projects: ${clean(d.experience,4000)}. Produce only the draft and a short reminder to verify all claims.`}],900);res.json({reply});}catch(e){res.status(e.status||502).json({error:e.status===503?e.message:'Cover letter generation is temporarily unavailable.'});}});
app.post('/api/ai/interview-feedback', async(req,res)=>{const q=clean(req.body?.question,1000),a=clean(req.body?.answer,8000);if(!q||!a)return res.status(400).json({error:'A question and answer are required.'});try{const reply=await completion([{role:'user',content:`Give kind, specific interview practice feedback on this answer. Mention one strength, two concrete improvements, and a concise structure or sample direction based only on their answer. Do not invent facts. Question: ${q}\nAnswer: ${a}`}],650);res.json({reply});}catch(e){res.status(e.status||502).json({error:e.status===503?e.message:'Interview feedback is temporarily unavailable.'});}});

// Job feed adapters. Provider results are source-attributed and never mixed with demo listings.
app.get('/api/jobs', async (req,res) => {
  const q=clean(req.query.q,100), location=clean(req.query.location,100), limit=Math.min(50,Math.max(1,Number(req.query.limit)||20));
  const output=[]; const errors=[];
  try {
    const url=new URL('https://remotive.com/api/remote-jobs'); if(q)url.searchParams.set('search',q);
    const r=await fetch(url,{signal:AbortSignal.timeout(7000)}); if(r.ok){const d=await r.json(); for(const j of (d.jobs||[]).slice(0,limit)){output.push({id:`remotive-${j.id}`,title:j.title,company:j.company_name,location:j.candidate_required_location||'Remote',country:j.candidate_required_location||'Worldwide',type:j.job_type||'Not specified',mode:'Remote',level:j.job_type||'Not specified',category:j.category||'Other',salary:j.salary||undefined,posted:j.publication_date,description:j.description,applyUrl:j.url,source:'Remotive',demo:false});}} else errors.push('Remotive returned a non-success status');
  } catch { errors.push('Remotive feed unavailable'); }
  try {
    const url=new URL('https://www.arbeitnow.com/api/job-board-api'); if(q)url.searchParams.set('search',q);
    const r=await fetch(url,{signal:AbortSignal.timeout(7000)}); if(r.ok){const d=await r.json(); for(const j of (d.data||[])){if(output.length>=limit)break;const id=`arbeitnow-${j.slug||j.url}`;if(output.some(x=>x.id===id))continue;output.push({id,title:j.title,company:j.company_name||j.company,location:j.location||'Not specified',country:j.location||'Not specified',type:j.job_types?.[0]||'Not specified',mode:j.remote?'Remote':'Not specified',level:'Not specified',category:j.tags?.[0]||'Other',posted:j.created_at,description:j.description,applyUrl:j.url,source:'Arbeitnow',demo:false});}} else errors.push('Arbeitnow returned a non-success status');
  } catch { errors.push('Arbeitnow feed unavailable'); }
  const filtered=output.filter(j=>!location||`${j.location} ${j.country}`.toLowerCase().includes(location.toLowerCase())||j.location==='Worldwide');
  res.json({jobs:filtered.slice(0,limit),sources:[...new Set(filtered.map(j=>j.source))],demo:false,warning:filtered.length?null:'No live results were returned by the configured public feeds.',errors:filtered.length?[]:errors});
});

app.post('/api/employers/submit', async(req,res)=>{
 const b=req.body||{}; const fields=['company','contact','email','title','location','url','description']; for(const f of fields) if(!clean(b[f],f==='description'?10000:500).trim()) return res.status(400).json({error:'Please complete all required fields.'});
 if(!emailOk(clean(b.email,254)))return res.status(400).json({error:'Enter a valid work email.'}); try{const u=new URL(b.url);if(!['http:','https:'].includes(u.protocol))throw new Error()}catch{return res.status(400).json({error:'Enter a valid application URL.'});}
 const sb=process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY):null;
 if(!sb)return res.status(503).json({error:'Employer submissions are not connected. Configure Supabase before accepting listings.'});
 const {error}=await sb.from('employer_submissions').insert({company:plain(b.company,200),contact_name:plain(b.contact,150),email:clean(b.email,254),job_title:plain(b.title,200),location:plain(b.location,200),application_url:clean(b.url,1000),description:clean(b.description,10000),status:'pending_review'});
 if(error){console.error(error.message);return res.status(502).json({error:'We could not save this submission. Please try again later.'});}res.json({ok:true,status:'pending_review'});
});
app.get('/api/admin/overview', async(req,res)=>{
 const expected=process.env.ADMIN_API_TOKEN; if(!expected||!req.get('x-admin-token')||req.get('x-admin-token')!==expected)return res.status(401).json({error:'Not authorized.'});
 const sb=process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY):null;
 if(!sb)return res.status(503).json({error:'Admin database is not configured.'});
 const [subs,reports]=await Promise.all([sb.from('employer_submissions').select('id,status,created_at',{count:'exact'}).limit(10),sb.from('job_reports').select('id,status,created_at',{count:'exact'}).limit(10)]);
 if(subs.error||reports.error)return res.status(502).json({error:'Could not load moderation data.'});res.json({employerSubmissions:subs.count??subs.data?.length??0,reports:reports.count??reports.data?.length??0,latestSubmissions:subs.data||[],latestReports:reports.data||[]});
});
// In production, serve the built Vite app and provide SPA fallback for direct route refreshes.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath, { index: false, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err && !res.headersSent) next(err);
  });
});
app.listen(port, '0.0.0.0', () => console.log(`Ivy6 web app and API listening on :${port}`));
