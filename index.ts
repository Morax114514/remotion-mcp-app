import {MCPServer} from "mcp-use";
import {z} from "zod";
import fs from "node:fs/promises";
import {createRequire} from "node:module";
import {getCapabilityReport} from "./capabilities.js";
import {compileProjectBundle, normalizeVirtualPath} from "./compiler.js";
import {projectStore} from "./project-store.js";
import {assetStore, normalizeAssetPath} from "./asset-store.js";
import {getOutput, outputDirectory, outputUrl, registerOutput} from "./output-store.js";
import {prepareRenderProject, renderProjectStills, renderProjectVideo} from "./render-executor.js";
import {serveFile} from "./file-response.js";
import * as Rules from "./rules/index.js";
import {DEFAULT_META, compileAndRespondWithProject, failProject, formatZodIssues, getSessionProject, sessionIdFromContext} from "./utils.js";

const require=createRequire(import.meta.url);
const CANVASKIT_JS=require.resolve("canvaskit-wasm/bin/full/canvaskit.js");
const CANVASKIT_WASM=require.resolve("canvaskit-wasm/bin/full/canvaskit.wasm");
const CROSS_ORIGIN_HEADERS={"Access-Control-Allow-Origin":"*","Cross-Origin-Resource-Policy":"cross-origin"} as const;

const server=new MCPServer({name:"remotion-ultimate-mcp",title:"Remotion Ultimate",version:"0.1.2",host:"0.0.0.0",description:"Remotion 4.0.507 live ChatGPT Player + shared-source full render runtime."});
const text=(name:string,description:string,value:string)=>server.tool({name,description},async()=>({content:[{type:"text" as const,text:value}]}));

export const readMe=text("read_me","IMPORTANT: Call FIRST for real Remotion work.",Rules.RULE_INDEX);
export const ruleReactCode=text("rule_react_code","React/project structure",Rules.RULE_REACT_CODE);
export const ruleRemotionAnimations=text("rule_remotion_animations","Frame-driven animation",Rules.RULE_REMOTION_ANIMATIONS);
export const ruleRemotionTiming=text("rule_remotion_timing","Timing and easing",Rules.RULE_REMOTION_TIMING);
export const ruleRemotionSequencing=text("rule_remotion_sequencing","Sequence/Series timing",Rules.RULE_REMOTION_SEQUENCING);
export const ruleRemotionTransitions=text("rule_remotion_transitions","Transitions",Rules.RULE_REMOTION_TRANSITIONS);
export const ruleRemotionTextAnimations=text("rule_remotion_text_animations","Typography motion",Rules.RULE_REMOTION_TEXT_ANIMATIONS);
export const ruleRemotionTrimming=text("rule_remotion_trimming","Trimming",Rules.RULE_REMOTION_TRIMMING);
export const ruleDirectorQuality=text("rule_director_quality","Director and visual quality gate",Rules.RULE_DIRECTOR_QUALITY);
export const ruleGraphicsRuntime=text("rule_graphics_runtime","TRUE 3D, Skia, WebGL/WebGPU verification",Rules.RULE_GRAPHICS_RUNTIME);
export const ruleMediaAssets=text("rule_media_assets","Asset/media workflow",Rules.RULE_MEDIA_ASSETS);
export const ruleUltimateCapabilities=text("rule_ultimate_capabilities","Ultimate capability boundaries",Rules.RULE_ULTIMATE_CAPABILITIES);

export const getCapabilities=server.tool({name:"get_capabilities",description:"Return runtime capability map."},async()=>({content:[{type:"text" as const,text:JSON.stringify(getCapabilityReport(),null,2)}],structuredContent:{capabilities:getCapabilityReport()}}));

const projectSchema=z.object({
 title:z.string().optional().default(DEFAULT_META.title),compositionId:z.string().optional().default(DEFAULT_META.compositionId),
 width:z.number().optional().default(DEFAULT_META.width),height:z.number().optional().default(DEFAULT_META.height),fps:z.number().optional().default(DEFAULT_META.fps),durationInFrames:z.number().optional().default(DEFAULT_META.durationInFrames),
 entryFile:z.string().optional().default("/src/Video.tsx"),files:z.record(z.string(),z.string()),defaultProps:z.record(z.string(),z.unknown()).optional().default({}),inputProps:z.record(z.string(),z.unknown()).optional().default({})
});
const createSchema=z.object({
 files:z.string().describe('JSON string of {path: code}. Changed files merge into the current project.'),deleteFiles:z.array(z.string()).optional(),entryFile:z.string().optional(),title:z.string().optional(),compositionId:z.string().optional(),
 durationInFrames:z.number().positive().optional(),fps:z.number().positive().optional(),width:z.number().positive().optional(),height:z.number().positive().optional(),defaultProps:z.record(z.string(),z.unknown()).optional(),inputProps:z.record(z.string(),z.unknown()).optional()
});
const videoOut=z.object({videoProject:z.string()});

export const createVideo=server.tool({
 name:"create_video",description:"Create/patch the current multi-file project and mount/update its live Player.",inputSchema:createSchema,outputSchema:videoOut,
 view:{name:"remotion-player",description:"Interactive Remotion video player",prefersBorder:false,csp:{resourceDomains:["https://images.unsplash.com","https://picsum.photos","https://fonts.googleapis.com","https://fonts.gstatic.com"]}}
},async(raw:z.infer<typeof createSchema>,ctx)=>{
 const sessionId=sessionIdFromContext(ctx); let changed:Record<string,string>;
 try{const p=JSON.parse(raw.files);if(!p||typeof p!=="object"||Array.isArray(p))return failProject("files must be a JSON object");changed=p;}catch{return failProject("files must be valid JSON");}
 if(!Object.keys(changed).length&&!raw.deleteFiles?.length)return failProject("Provide changed files or deleteFiles.");
 const prev=await getSessionProject(sessionId);const files=prev?{...prev.files,...changed}:{...changed};for(const p of raw.deleteFiles??[])delete files[normalizeVirtualPath(p)];
 const parsed=projectSchema.safeParse({title:raw.title??prev?.title,compositionId:raw.compositionId??prev?.compositionId,width:raw.width??prev?.width,height:raw.height??prev?.height,fps:raw.fps??prev?.fps,durationInFrames:raw.durationInFrames??prev?.durationInFrames,entryFile:raw.entryFile??prev?.entryFile,files,defaultProps:raw.defaultProps??prev?.defaultProps,inputProps:raw.inputProps??prev?.inputProps});
 if(!parsed.success)return failProject(`Invalid input: ${formatZodIssues(parsed.error)}`);
 return compileAndRespondWithProject(parsed.data,sessionId,prev?["Merged with previous project."]:[],prev?"update_video":"create_video");
});

function need<T>(v:T|null):T{if(!v)throw new Error("No current project. Call create_video first.");return v;}
async function current(ctx:any){return need(await getSessionProject(sessionIdFromContext(ctx)));}
async function rewrite(ctx:any,mutate:(files:Record<string,string>)=>void){const p=await current(ctx);const files={...p.files};mutate(files);const parsed=projectSchema.parse({...p,files});return compileAndRespondWithProject(parsed,sessionIdFromContext(ctx),["Project source updated."],"update_video");}

export const listProjectFiles=server.tool({name:"list_project_files",description:"List current project files."},async(_p,ctx)=>{const p=await current(ctx);const files=Object.keys(p.files).sort();return{content:[{type:"text" as const,text:files.join("\n")}],structuredContent:{projectId:p.projectId,revision:p.revision,files}};});
export const readProjectFile=server.tool({name:"read_project_file",description:"Read a source file.",inputSchema:z.object({path:z.string()})},async({path},ctx)=>{const p=await current(ctx);const n=normalizeVirtualPath(path);if(typeof p.files[n]!=="string")throw new Error(`File not found: ${n}`);return{content:[{type:"text" as const,text:p.files[n]}],structuredContent:{path:n,revision:p.revision}};});
export const writeProjectFile=server.tool({name:"write_project_file",description:"Create or fully replace one source file.",inputSchema:z.object({path:z.string(),content:z.string()})},async({path,content},ctx)=>{const n=normalizeVirtualPath(path);return rewrite(ctx,f=>{f[n]=content;});});
export const replaceProjectFile=server.tool({name:"replace_project_file",description:"Exact text replacement in one source file.",inputSchema:z.object({path:z.string(),oldText:z.string(),newText:z.string(),replaceAll:z.boolean().optional().default(false)})},async({path,oldText,newText,replaceAll},ctx)=>{const n=normalizeVirtualPath(path);return rewrite(ctx,f=>{const s=f[n];if(typeof s!=="string")throw new Error(`File not found: ${n}`);if(!s.includes(oldText))throw new Error("oldText not found");f[n]=replaceAll?s.split(oldText).join(newText):s.replace(oldText,newText);});});
export const deleteProjectFile=server.tool({name:"delete_project_file",description:"Delete one source file.",inputSchema:z.object({path:z.string()})},async({path},ctx)=>{const n=normalizeVirtualPath(path);return rewrite(ctx,f=>{if(!(n in f))throw new Error(`File not found: ${n}`);delete f[n];});});

export const uploadAsset=server.tool({name:"upload_asset",description:"Store binary/media/model/font asset for the current project.",inputSchema:z.object({path:z.string(),dataBase64:z.string(),contentType:z.string().optional()})},async({path,dataBase64,contentType},ctx)=>{const p=await current(ctx);const n=normalizeAssetPath(path);const data=Buffer.from(dataBase64,"base64");if(!data.length)throw new Error("Empty asset");const asset=await assetStore.put(p.projectId,n,data,contentType);return{content:[{type:"text" as const,text:`Stored ${asset.path} (${asset.size} bytes). Use staticFile(${JSON.stringify(asset.path)}).`}],structuredContent:{asset}};});
export const listAssets=server.tool({name:"list_assets",description:"List current project assets."},async(_p,ctx)=>{const p=await current(ctx);const assets=await assetStore.list(p.projectId);return{content:[{type:"text" as const,text:JSON.stringify(assets,null,2)}],structuredContent:{assets}};});
export const deleteAsset=server.tool({name:"delete_asset",description:"Delete one project asset.",inputSchema:z.object({path:z.string()})},async({path},ctx)=>{const p=await current(ctx);const n=normalizeAssetPath(path);if(!await assetStore.delete(p.projectId,n))throw new Error(`Asset not found: ${n}`);return{content:[{type:"text" as const,text:`Deleted ${n}.`}]};});

export const validateProject=server.tool({name:"validate_project",description:"Validate preview, render, or both executors.",inputSchema:z.object({executor:z.enum(["preview","render","both"]).optional().default("preview")})},async({executor},ctx)=>{const p=await current(ctx);const lines=[] as string[];if(executor!=="render"){const r=await compileProjectBundle(p.files,p.entryFile);lines.push(`Preview VALID: ${Object.keys(r.normalizedFiles).length} files.`);}if(executor!=="preview"){const r=await prepareRenderProject(p);try{lines.push(`Render VALID: ${r.composition.id} ${r.composition.width}x${r.composition.height} ${r.composition.fps}fps ${r.composition.durationInFrames}f GL=${r.gl??"default"}.`);}finally{await r.cleanup();}}return{content:[{type:"text" as const,text:[`VALID ${p.projectId} r${p.revision}`,...lines].join("\n")}],structuredContent:{valid:true,executor,projectId:p.projectId,revision:p.revision}};});
export const listCompositions=server.tool({name:"list_compositions",description:"Resolve current composition through Render Executor."},async(_p,ctx)=>{const p=await current(ctx);const r=await prepareRenderProject(p);try{const c=r.composition;const composition={id:c.id,width:c.width,height:c.height,fps:c.fps,durationInFrames:c.durationInFrames,gl:r.gl??"default"};return{content:[{type:"text" as const,text:JSON.stringify(composition,null,2)}],structuredContent:{compositions:[composition]}};}finally{await r.cleanup();}});

export const renderStillTool=server.tool({name:"render_still",description:"Render one real PNG still.",inputSchema:z.object({frame:z.number().nonnegative().optional().default(0)})},async({frame},ctx)=>{const p=await current(ctx);const [s]=await renderProjectStills(p,[frame],outputDirectory());const o=await registerOutput(s.outputPath,s.contentType);return{content:[{type:"text" as const,text:`Frame ${s.frame} GL=${s.gl??"default"}: ${outputUrl(o)}`},{type:"image" as const,data:s.buffer.toString("base64"),mimeType:s.contentType}],structuredContent:{frame:s.frame,gl:s.gl??"default",outputId:o.id,url:outputUrl(o)}};});
export const renderStillsTool=server.tool({name:"render_stills",description:"Render representative PNG stills for visual review.",inputSchema:z.object({frames:z.array(z.number().nonnegative()).min(1).max(12)})},async({frames},ctx)=>{const p=await current(ctx);const stills=await renderProjectStills(p,frames,outputDirectory());const content:any[]=[];const outputs:any[]=[];for(const s of stills){const o=await registerOutput(s.outputPath,s.contentType);content.push({type:"text",text:`Frame ${s.frame} GL=${s.gl??"default"}: ${outputUrl(o)}`},{type:"image",data:s.buffer.toString("base64"),mimeType:s.contentType});outputs.push({frame:s.frame,gl:s.gl??"default",outputId:o.id,url:outputUrl(o)});}return{content,structuredContent:{outputs}};});
export const renderVideoTool=server.tool({name:"render_video",description:"Render real H.264/H.265/VP8/VP9/ProRes media.",inputSchema:z.object({codec:z.enum(["h264","h265","vp8","vp9","prores"]).optional().default("h264"),crf:z.number().min(0).max(63).optional(),concurrency:z.union([z.number().positive(),z.string()]).optional()})},async({codec,crf,concurrency},ctx)=>{const p=await current(ctx);const r=await renderProjectVideo(p,outputDirectory(),{codec,crf,concurrency});const o=await registerOutput(r.outputPath,r.contentType);return{content:[{type:"text" as const,text:`Rendered ${codec} GL=${r.gl??"default"}: ${outputUrl(o)}`}],structuredContent:{gl:r.gl??"default",outputId:o.id,fileName:o.fileName,contentType:o.contentType,url:outputUrl(o)}};});
export const resetProject=server.tool({name:"reset_project",description:"Destructively reset current project and assets."},async(_p,ctx)=>{const id=sessionIdFromContext(ctx);const p=await getSessionProject(id);await projectStore.delete(id);if(p)await assetStore.purgeProject(p.projectId);return{content:[{type:"text" as const,text:"Project reset."}]};});

server.get("/project-assets/:projectId/*",async c=>{try{const a=await assetStore.get(c.req.param("projectId"),c.req.param("*") ?? "");if(!a)return c.text("Not found",404);return serveFile(a.filePath,{contentType:a.contentType,size:a.size,etag:`\"${a.sha256}\"`,cacheControl:"private, max-age=3600",rangeHeader:c.req.header("Range")});}catch(e){return c.text((e as Error).message,400);}});
server.get("/canvaskit.js",async c=>c.body(new Uint8Array(await fs.readFile(CANVASKIT_JS)),200,{"Content-Type":"text/javascript; charset=utf-8","Cache-Control":"public, max-age=31536000, immutable",...CROSS_ORIGIN_HEADERS}));
server.get("/canvaskit.wasm",async c=>c.body(new Uint8Array(await fs.readFile(CANVASKIT_WASM)),200,{"Content-Type":"application/wasm","Cache-Control":"public, max-age=31536000, immutable",...CROSS_ORIGIN_HEADERS}));
server.get("/renders/:id/:filename",async c=>{const o=getOutput(c.req.param("id"));if(!o)return c.text("Not found",404);try{return serveFile(o.filePath,{contentType:o.contentType,cacheControl:"private, max-age=3600",disposition:`inline; filename=\"${o.fileName.replace(/\"/g,"")}\"`,rangeHeader:c.req.header("Range")});}catch{return c.text("Unavailable",404);}});
server.get("/.well-known/openai-apps-challenge",c=>c.text("remotion-ultimate-mcp-app"));
export default server;
