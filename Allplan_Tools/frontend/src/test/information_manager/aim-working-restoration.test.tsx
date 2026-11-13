import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import loaded from "../fixtures/aim-update/01-project-loaded.json";
import repeated from "../fixtures/aim-update/12-add-repeated-occurrence-updated.json";
import identity from "../fixtures/aim-update/21-host-identity-update.json";
import { classifyProjects } from "@/modules/information_manager/lib/manager-classification";
import { parseManager, assignmentAvailable, type ManagerEntry } from "@/modules/information_manager/lib/aim-manager-contract";
import { workingAvailable, isWorkingState, parseWorking, parseWorkingPresentation } from "@/modules/information_manager/lib/aim-working-contract";
import { AimEditor } from "@/modules/information_manager/AimEditor";
import { ProjectManager } from "@/modules/information_manager/components/project-manager";
import { useAppDialog } from "@/lib/app-dialog";
const host = vi.hoisted(() => ({ info: null as unknown }));
vi.mock("@/shared/transport/native-binding", async original => ({...await original<object>(),getVerifiedAppInfo: () => host.info }));
const flush = async () => { await act(async () => {for(let i=0;i<30;i++) await Promise.resolve();}); };
const workInfo = {...identity,read_only:false,working_state_contract:1};
function initialWork() {
  const p = structuredClone(repeated.presentation);
  return {revision:0, source:structuredClone(loaded),data:structuredClone(loaded.data),draftValues:{} as Record<string,string|null>,pendingImport:false,presentation:{...p,model:{...p.model,readOnly:false}},dirty:{values:false,presentation:false,any:false},fileSaveAvailable:false,prjtoolsAvailable:false};
}
function entry(name:string, installation?: ManagerEntry["projectInstallation"]): ManagerEntry {
  return {path:`D:\\Clients\\${name}.prj`,name,source:{status:"resolved",version:"2025",verificationVersion:false,reason:null},sourceFreshness:"last_read",...(installation ? {projectInstallation:installation} : {})};
}
beforeEach(() => {host.info=workInfo;localStorage.clear();localStorage.setItem("information_manager:lang","fr");globalThis.ResizeObserver ??= class {observe(){} unobserve(){} disconnect(){}};});
afterEach(() => {cleanup();vi.unstubAllGlobals();useAppDialog.setState({queue:[]});});
it("classifies associated, external and unknown projects exactly once using projectInstallation, not source.version", () => {
  const associated=entry("Associated",{status:"associated",version:"2026",verificationVersion:false,prjPath:"C:\\Allplan\\PRJ"});
  const external=entry("External",{status:"unassociated"});
  const unknown=entry("Unknown",{status:"unknown",reason:"legacy_entry"});
  const {groups,versions}=classifyProjects([associated,external,unknown]);
  expect(versions).toEqual(["2026"]);
  expect(groups[0]?.entries).toEqual([external,unknown]);
  expect(groups[1]?.entries).toEqual([associated]);
  expect(groups.flatMap(g=>g.entries)).toHaveLength(3);
  expect(classifyProjects([associated,external,unknown],"Associated","2026").groups.map(g=>g.entries.length)).toEqual([0,1]);
});
it("separates installations sharing the same version and does not infer assignment without the marker", () => {
  const a=entry("A",{status:"associated",version:"2026",verificationVersion:false,prjPath:"C:\\PRJ"});
  const b=entry("B",{status:"associated",version:"2026",verificationVersion:true,prjPath:"D:\\PRJ"});
  expect(classifyProjects([a,b]).groups.map(g=>g.entries.length)).toEqual([0,1,1]);
  expect(classifyProjects([entry("Old")]).groups).toMatchObject([{key:"user",entries:[{name:"Old"}]}]);
  expect(classifyProjects([entry("Old")]).versions).toEqual([]);
});
it("assignment marker is an exact integer; strict list/add/preview schemas stay opt-in", () => {
  const info={...identity,project_manager_contract:1,project_manager_assignment_contract:1};
  expect(assignmentAvailable(info)).toBe(true);
  for(const marker of [undefined,true,"1",0,2]) expect(assignmentAvailable({...info,project_manager_assignment_contract:marker})).toBe(false);
  const project=entry("A",{status:"unknown",reason:"ambiguous"});
  expect(parseManager("project.manager.list",{ok:true,projects:[project]},{assignment:true}).kind).toBe("list");
  expect(parseManager("project.manager.list",{ok:true,projects:[project]}).kind).toBe("invalid");
  expect(parseManager("project.manager.list",{ok:true,projects:[entry("Old")]},{assignment:true}).kind).toBe("invalid");
  expect(parseManager("project.manager.add",{ok:true,status:"added",project},{assignment:true}).kind).toBe("added");
  const preview={project:{path:project.path,name:project.name},source:project.source,readOnly:true,valuesStatus:"read",mode:"attributes_without_presentation",items:[],projectInstallation:project.projectInstallation};
  expect(parseManager("project.manager.preview",{ok:true,status:"preview",preview},{assignment:true}).kind).toBe("preview");
  expect(parseManager("project.manager.preview",{ok:true,status:"preview",preview}).kind).toBe("invalid");
});
it("list keeps memorized resolution and active selection never automatically rereads preview", async () => {
  host.info={...identity,project_manager_contract:1,project_manager_assignment_contract:1};
  const p=entry("Old",{status:"unknown",reason:"legacy_entry"});
  const call=vi.fn(async()=>({ok:true,projects:[p]}));vi.stubGlobal("pywebview",{api:{call}});
  render(<ProjectManager activePath={p.path} onOpen={async()=>{}} onClose={()=>{}}/>);await flush();
  expect(call.mock.calls).toEqual([["project.manager.list",{}]]);
  expect(screen.getAllByRole("button",{name:"Old"})).toHaveLength(1);
  expect(screen.getByText("Appartenance inconnue")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Old"})).toHaveAttribute("aria-pressed","true");
});
it("working marker is strict; validates full state, empty/zero/false/null strings without conversion", () => {
  expect(workingAvailable(workInfo)).toBe(true);
  for(const marker of [undefined,true,"1",0,2]) expect(workingAvailable({...workInfo,working_state_contract:marker})).toBe(false);
  const w=initialWork();expect(isWorkingState(w)).toBe(true);
  for(const value of ["","0","false",null]) expect(isWorkingState({...w,draftValues:{"7":value}})).toBe(true);
  expect(isWorkingState({...w,draftValues:{"007":"0"}})).toBe(false);
  expect(isWorkingState({...w,fileSaveAvailable:true})).toBe(false);
  expect(isWorkingState({...w,revision:"0"})).toBe(false);
  expect(isWorkingState({...w,extra:true})).toBe(false);
  expect(parseWorking("work.get",{ok:true,status:"current",work:w})).toBeTruthy();
  expect(parseWorking("work.get",{ok:true,status:"current",work:w,extra:true})).toBeNull();
  expect(parseWorking("work.transition",{ok:true,status:"cancelled",data:loaded})).toBeTruthy();
  expect(parseWorkingPresentation("presentation.get",{ok:true,status:"current",presentation:w.presentation})).toBeTruthy();
  expect(parseWorkingPresentation("presentation.update",{ok:true,status:"updated",presentation:w.presentation,extra:true})).toBeNull();
  expect(parseWorkingPresentation("presentation.import.prepare",{ok:true,status:"prepared",token:"token",candidate:w.presentation})).toBeTruthy();
});
const cells=()=>screen.getAllByRole("textbox",{name:"Modifier la valeur 7"});
const values=()=>cells().map(e=>(e as HTMLInputElement).value);
async function mountWork(stale = false) {
  let w=initialWork();
  const call=vi.fn(async(command:string,payload:Record<string,any>)=>{
    if(command==="work.get") return {ok:true,status:"current",work:structuredClone(w)};
    if(command==="work.value.set") {
      if (stale) { w.revision=5; return {ok:false,error:{code:"stale_work",message:"Révision périmée"}}; }
      expect(payload["revision"]).toBe(w.revision);
      w.revision++;w.draftValues={"7":payload["value"]};w.dirty={values:true,presentation:w.dirty.presentation,any:true};
      for(const a of w.data.attributes) {a.value=payload["value"];a.valueState=payload["value"]===null ? "unset" : "set";}
      for(const c of w.presentation.model.categories) for(const g of c.groups) for(const r of g.rows) {r.value=payload["value"];r.valueState=payload["value"]===null ? "unset" : "set";}
      return {ok:true,status:"updated",work:structuredClone(w)};
    }
    if(command==="presentation.update") {w.revision++;w.dirty={values:w.dirty.values,presentation:true,any:true};return {ok:true,status:"updated",presentation:structuredClone(w.presentation)};}
    if(command==="presentation.import.prepare") {w.pendingImport=true;return {ok:true,status:"prepared",token:"working-import-token",candidate:structuredClone(w.presentation)};}
    if(command==="presentation.import.cancel") {w.pendingImport=false;return {ok:true,status:"cancelled"};}
    if(command==="work.discard") {w=initialWork();return {ok:true,status:"discarded",work:structuredClone(w)};}
    if(command==="work.transition") {
      if(payload["command"]==="presentation.import.apply") {w.revision++;w.pendingImport=false;w.dirty.presentation=false;w.dirty.any=w.dirty.values;return {ok:true,status:"transitioned",work:structuredClone(w),result:{ok:true,status:"applied",presentation:structuredClone(w.presentation)}};}
      return {ok:true,status:"cancelled",data:loaded};
    }
    if(command==="work.close") return {ok:true,status:"close_requested"};
    throw Error(command);
  });
  vi.stubGlobal("pywebview",{api:{get_initial_data:async()=>loaded,call}});
  render(<AimEditor hostEnabled={false} limitedHost/>);await flush();
  return {call,getWork:()=>w};
}
it("mounted draft applies via exact revisioned command, source stays unchanged and repeated rows share Python's result", async () => {
  const {call,getWork}=await mountWork();
  expect(screen.getByLabelText("État des modifications")).toHaveAttribute("data-edit-state", "clean");
  const cell=cells()[0] as HTMLInputElement;
  fireEvent.change(cell,{target:{value:"Draft"}});fireEvent.keyDown(cell,{key:"Enter"});fireEvent.blur(cell);await flush();
  expect(call).toHaveBeenCalledWith("work.value.set",{revision:0,number:"7",value:"Draft"});
  expect(getWork().source.data.attributes[0]?.value).toBe("0");
  expect(screen.getByLabelText("État des modifications")).toHaveAttribute("data-edit-state", "modified");
  expect(values()).toEqual(["Draft","Draft"]);
  expect(call.mock.calls.map(c=>c[0])).toEqual(["work.get","work.value.set","work.get"]);
  fireEvent.click(screen.getByRole("button",{name:/Tout replier.*Synthetic group/}));await flush();
  expect(getWork().draftValues).toEqual({"7":"Draft"});
  expect(call.mock.calls.slice(-2).map(c=>c[0])).toEqual(["presentation.update","work.get"]);
  expect(call.mock.calls.some(([c])=>/export|prjtool|save/.test(c))).toBe(false);
});
it("cancelled value editing sends nothing and cancelled project selection preserves work", async () => {
  const {call}=await mountWork();
  const cell=cells()[0] as HTMLInputElement;
  fireEvent.change(cell,{target:{value:"Typed"}});fireEvent.keyDown(cell,{key:"Escape"});fireEvent.blur(cell);await flush();
  expect(values()).toEqual(["0","0"]);
  fireEvent.change(cell,{target:{value:"0"}});fireEvent.keyDown(cell,{key:"Enter"});fireEvent.blur(cell);await flush();
  expect(call.mock.calls.map(c=>c[0])).toEqual(["work.get"]);
  fireEvent.click(screen.getByRole("button",{name:"Choisir un projet Allplan"}));await flush();
  expect(call).toHaveBeenCalledWith("work.transition",{revision:0,discard:false,command:"project.select",payload:{}});
  expect(cells()).toHaveLength(2);
});
it("dirty close offers cancel/discard only and sends the current revision only after explicit discard", async () => {
  const {call}=await mountWork();
  const cell=cells()[0] as HTMLInputElement;
  fireEvent.change(cell,{target:{value:"Dirty"}});fireEvent.keyDown(cell,{key:"Enter"});await flush();
  fireEvent.click(screen.getAllByRole("button",{name:"Quitter"})[0] as HTMLElement);await flush();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Annuler"}));await flush();
  expect(call.mock.calls.some(([c])=>c==="work.close")).toBe(false);
  fireEvent.click(screen.getAllByRole("button",{name:"Quitter"})[0] as HTMLElement);await flush();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Abandonner"}));await flush();
  expect(call).toHaveBeenCalledWith("work.close",{revision:1,discard:true});
});
it("stale_work rereads the host and keeps the user's unsent input rather than retrying the mutation", async () => {
  const {call}=await mountWork(true);
  const cell=cells()[0] as HTMLInputElement;
  fireEvent.change(cell,{target:{value:"Not lost"}});fireEvent.keyDown(cell,{key:"Enter"});await flush();
  expect(call.mock.calls.map(c=>c[0])).toEqual(["work.get","work.value.set","work.get"]);
  expect(values()).toEqual(["Not lost","0"]);
});
it("working import applies only via revisioned transition and preserves draft values", async () => {
  const {call,getWork}=await mountWork();
  getWork().draftValues={"7":"Draft"};getWork().dirty={values:true,presentation:false,any:true};
  fireEvent.click(screen.getByRole("button",{name:"Importer une présentation"}));await flush();
  expect(getWork().pendingImport).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Écraser"}));await flush();
  expect(call).toHaveBeenCalledWith("work.transition",{revision:0,discard:false,command:"presentation.import.apply",payload:{token:"working-import-token"}});
  expect(call.mock.calls.some(([c])=>c==="presentation.import.apply")).toBe(false);
  expect(getWork().draftValues).toEqual({"7":"Draft"});
  expect(getWork().pendingImport).toBe(false);
});
it("without working marker even presentation.update never sends work commands", async () => {
  host.info=identity;const call=vi.fn();vi.stubGlobal("pywebview",{api:{get_initial_data:async()=>loaded,call}});
  render(<AimEditor hostEnabled={false} limitedHost/>);await flush();
  expect(screen.queryAllByRole("textbox",{name:"Modifier la valeur 7"})).toHaveLength(0);
  expect(screen.getByLabelText("État des modifications")).toHaveAttribute("data-edit-state", "unknown");
  expect(call.mock.calls.some(([c])=>String(c).startsWith("work."))).toBe(false);
});