import * as THREE from "three";
import { TOWN_STYLE as S } from "./demoTownStyle";
import type { TownWorld } from "./worldTypes";
import { DEMO_PLACES, RESIDENTIAL_BLOCKS, RAILWAY } from "./demoTownMap";

/** Purpose-built demo district. Its visual forms are independent of the ledger schema. */
export function buildDemoTown(scene: THREE.Scene): TownWorld {
  const root = new THREE.Group(); root.name = "north-bank-demo"; scene.add(root);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const geometries: THREE.BufferGeometry[] = [];
  const textures: THREE.Texture[] = [];
  const cube = new THREE.BoxGeometry(1, 1, 1); geometries.push(cube);
  const sphere = new THREE.IcosahedronGeometry(1, 2); geometries.push(sphere);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10); geometries.push(cylinder);
  const batches = new Map<string, { geometry: THREE.BufferGeometry; color: string; matrices: THREE.Matrix4[] }>();
  const material = (color: string) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: color === S.glass ? .48 : S.roughness }));
    return materials.get(color)!;
  };
  function shape(geometry: THREE.BufferGeometry, x: number, y: number, z: number, w: number, h: number, d: number, color: string, rz = 0, ry = 0) {
    const key = geometry.uuid + color;
    if (!batches.has(key)) batches.set(key, { geometry, color, matrices: [] });
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz));
    batches.get(key)!.matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),q,new THREE.Vector3(w,h,d)));
  }
  const box = (x: number,y: number,z: number,w: number,h: number,d: number,c: string,rz=0,ry=0) => shape(cube,x,y,z,w,h,d,c,rz,ry);
  const ball = (x: number,y: number,z: number,r: number,c: string) => shape(sphere,x,y,z,r,r,r,c);
  const post = (x: number,y: number,z: number,r: number,h: number,c: string) => shape(cylinder,x,y,z,r,h,r,c);
  const cream = S.wall, timber = S.timber, glass = S.glass, trim = S.trim, slate = S.metal;
  function sign(text: string, x: number,y: number,z: number,w: number,h: number,color: string) {
    const canvas = document.createElement("canvas"); canvas.width=512; canvas.height=128;
    const ctx=canvas.getContext("2d")!; ctx.fillStyle=color; ctx.fillRect(0,0,512,128);
    ctx.fillStyle=trim; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.font='500 42px "Microsoft YaHei", sans-serif'; ctx.fillText(text,256,66,475);
    const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace; textures.push(texture);
    const geo=new THREE.PlaneGeometry(w,h); geometries.push(geo);
    const mat=new THREE.MeshStandardMaterial({map:texture,roughness:.8}); materials.set("sign"+textures.length,mat);
    const mesh=new THREE.Mesh(geo,mat); mesh.position.set(x,y,z); root.add(mesh);
  }
  function window(x: number,y: number,z: number,w=1,h=1.4) {
    box(x,y,z,w+.2,h+.2,.16,S.masonry);
    box(x,y,z+.1,w+.08,h+.08,.06,trim);
    box(x,y,z+.14,w,h,.04,glass);
    box(x,y,z+.18,.055,h,.03,trim);
    box(x,y+h*.16,z+.18,w,.045,.03,trim);
    box(x,y-h/2-.08,z+.15,w+.3,.12,.29,trim);
    box(x,y+h/2+.11,z+.07,w+.3,.12,.2,trim);
  }
  function door(x: number,z: number,w=1.6,h=2.4) {
    box(x,.27+h/2,z,w+.22,h+.18,.18,timber); box(x,.27+h/2,z+.12,w,h,.07,glass);
    box(x,.27+h/2,z+.18,.06,h,.025,trim); box(x+.18,1.15,z+.2,.045,.42,.05,trim);
    box(x,.27,z+.4,w+.65,.15,.8,"#c5c4b1");
  }
  function pitched(x: number,y: number,z: number,w: number,d: number,color: string) {
    const angle=.48, half=w/2;
    box(x-half/2,y,z,half/Math.cos(angle)+.15,.22,d,color,angle);
    box(x+half/2,y,z,half/Math.cos(angle)+.15,.22,d,color,-angle);
    box(x,y+Math.tan(angle)*half/2,z,.18,.16,d+.12,S.roofEdge);
    for(let dz=-d/2+.35;dz<d/2;dz+=.62) {
      box(x-half/2,y+.125,z+dz,half/Math.cos(angle),.028,.035,S.roofEdge,angle);
      box(x+half/2,y+.125,z+dz,half/Math.cos(angle),.028,.035,S.roofEdge,-angle);
    }
    for(const dx of [-half,half])box(x+dx,y-Math.tan(angle)*half/2,z,.14,.18,d+.08,trim);
    // Solid gable end: no roof floating above an unfinished rectangular wall.
    const triangle=new THREE.BufferGeometry();
    triangle.setAttribute("position",new THREE.Float32BufferAttribute([-.5,0,0,.5,0,0,0,1,0],3));
    triangle.computeVertexNormals();geometries.push(triangle);
    shape(triangle,x,y-Math.tan(angle)*half/2,z+d/2-.1,w,Math.tan(angle)*half,1,cream);
    shape(triangle,x,y-Math.tan(angle)*half/2,z-d/2+.1,w,Math.tan(angle)*half,1,cream,0,Math.PI);
  }
  function tree(x: number,z: number,r=1) {
    post(x,1.3,z,.13,2.6,timber); ball(x,2.8,z,r,"#679875"); ball(x-.5,2.5,z+.3,r*.7,"#93ac68"); ball(x+.55,2.8,z-.2,r*.65,"#3f7c68");
    box(x,.25,z,1.5,.18,1.5,"#b3bfa0");
  }
  function bench(x: number,z: number) {
    box(x,.68,z,2,.12,.55,timber); box(x,1.02,z-.25,2,.6,.1,timber);
    for(const dx of [-.75,.75]) box(x+dx,.4,z,.09,.55,.45,slate);
  }
  function awning(x: number,y: number,z: number,w: number,color: string) {
    for(let i=0;i<12;i++) {box(x-w/2+(i+.5)*w/12,y,z,w/12,.13,1.5,i%2?trim:color);box(x-w/2+(i+.5)*w/12,y-.18,z+.74,w/12,.3,.06,i%2?trim:color);}
  }
  function path(points: [number, number][], width: number, color = "#d9d2bf") {
    for(let i=1;i<points.length;i++) {
      const [ax,az]=points[i-1], [bx,bz]=points[i];
      box((ax+bx)/2,.245,(az+bz)/2,width,.07,Math.hypot(bx-ax,bz-az)+.08,color,0,Math.atan2(bx-ax,bz-az));
    }
  }
  function upperHome(x:number,z:number,w:number,d:number,base:number,color:string) {
    box(x,base+1.3,z,w,2.6,d,color);
    box(x,base,z,w+.18,.18,d+.18,trim);
    for(let i=0;i<3;i++) {
      const wx=x+(i-1)*w/3.5;
      window(wx,base+1.25,z+d/2+.05,1.1,1.55);
      box(wx,base+.34,z+d/2+.33,1.3,.25,.45,timber);
      for(let j=0;j<3;j++)ball(wx-.4+j*.4,base+.55,z+d/2+.33,.2,"#77936b");
      for(const dx of [-.76,.76])box(wx+dx,base+1.25,z+d/2+.1,.27,1.55,.1,S.accent);
    }
    for(const dx of [-w/2+.15,w/2-.15])box(x+dx,base+1.3,z+d/2+.06,.22,2.6,.15,trim);
    box(x,base+2.6,z,w+.3,.18,d+.3,trim);
  }
  // The south bank is a park, not a secondary building strip.
  box(0,-.55,-5,70,1.2,76,"#bfcbbd");
  box(0,.1,-14,68,.15,47,"#aebfa0");
  box(0,.16,-14,65,.12,11,"#dcd6c5");
  box(0,.16,-.8,65,.12,11,"#dcd6c5");
  box(0,.12,-8,68,.16,4,"#84969b");
  box(0,.13,6,68,.14,3,"#d6cfbb");
  box(0,.08,9.8,68,.16,3.8,"#ddd9c8");
  box(0,-.02,15.5,68,.2,7.2,"#79bbc0");
  box(0,.12,25.5,68,.2,12,"#c1cba8");
  box(0,.25,23,67,.1,2,"#e5ddc8");
  for(let x=-32;x<=32;x+=4) {box(x,.24,-8,1.7,.025,.08,trim);box(x,.15,15,1.5,.03,.035,"#bce1d8");}
  for(const x of [-18,19]) {
    box(x,.3,15.5,3.8,.45,8.7,"#d7d5c4");
    for(const dx of [-1.9,1.9]) {
      box(x+dx,1.2,15.5,.07,.07,9,slate);
      for(let z=11;z<=20;z+=1)post(x+dx,.85,z,.035,.8,slate);
    }
  }
  // Irregular groves leave clear bridge approaches and an open walking spine.
  for(const [x,z,r] of [[-30,25,1.2],[-27,24.7,.85],[-23,25.2,1],[-11,25,1.3],[-8,25.2,.8],[0,25,1],[4,25.2,1.3],[8,25,.9],[25,25,1.25],[29,24.8,.95]])tree(x,z,r);
  for(const x of [-28,-10,5,27]) {bench(x,21.4);path([[x-2,23],[x,21.2],[x+2,23]],.8);}
  for(const x of [-30,-23,-12,-5,13,25,31])tree(x,10,.75);
  path([[-32,28],[-24,29],[-15,27.5],[-4,29.5],[6,28],[17,29],[25,27],[33,28]],1.1);
  for(const x of [-18,19])path([[x,20],[x,23],[x+2,28]],1.2);
  for(const [x,z,r] of [[-29,30.5,1],[-20,30.7,.8],[-8,31,1.1],[2,30.5,.9],[13,31,1.2],[29,30.5,1]])tree(x,z,r);
  for(const x of [-24,-3,24])bench(x,30);
  for(const z of [11.8,19.3])box(0,.12,z,68,.5,.35,S.masonry);
  for(const [start,end] of [[-34,-20],[-16,17],[21,34]]) {
    for(let x=start;x<end;x+=1.4)post(x,.83,11.7,.035,1.05,slate);
    box((start+end)/2,1.3,11.7,end-start,.06,.06,slate);
  }
  for(const x of [-32,-17,-1,15,32]) {tree(x,-21,1.15);tree(x,-5,.75);}
  // Residential lane, side connections and crossings make blocks into a walkable town.
  box(0,.14,-22,68,.14,2.5,"#d3cfbf");
  for(const x of [-32,32])box(x,.15,-9,2.3,.14,28,"#d3cfbf");
  for(const x of [-18,19]) {
    for(let i=0;i<6;i++)box(x,.235,-9.4+i*.55,2,.025,.24,trim);
    box(x,.16,5,2.2,.13,7,"#d8d1be");
  }
  // Railway belongs to the permanent town, independent of transaction volume.
  const railZ = RAILWAY.z;
  box(0,RAILWAY.deckY,railZ,69,.48,4.4,"#aeb9b4");
  for(let x=-31;x<=31;x+=9) {
    box(x,1.7,railZ,.85,3.4,2.5,"#aeb9b4");
    box(x,3.3,railZ,2.6,.3,3.6,"#aeb9b4");
  }
  for(let x=-33;x<=33;x+=.8)box(x,3.89,railZ,.22,.1,2.8,timber);
  for(const dz of [-.85,.85])box(0,4,railZ+dz,68,.12,.095,slate);
  for(const dz of [-2.1,2.1]) {
    box(0,4.6,railZ+dz,69,.065,.065,slate);
    for(let x=-34;x<=34;x+=1.8)post(x,4.25,railZ+dz,.025,.8,slate);
  }
  for(let x=-31;x<=31;x+=10) {
    post(x,6.5,railZ-1.65,.065,5.1,slate);
    box(x,8.85,railZ,.08,.08,3.6,slate);
  }
  box(0,8.73,railZ,66,.025,.025,slate);
  // Two quiet mid-rise residential clusters; balconies, laundry and roof gardens show inhabitation.
  for(const b of RESIDENTIAL_BLOCKS) {
    const height=b.floors*1.8+.5, front=b.z+b.d/2;
    box(b.x,height/2+.25,b.z,b.w,height,b.d,b.color);
    box(b.x,.5,b.z,b.w+.1,.52,b.d+.1,S.base);
    box(b.x,2.45,front+.065,b.w+.08,.1,.17,S.masonry);
    box(b.x,height+.23,front+.08,b.w+.25,.18,.23,trim);
    box(b.x,height+.42,b.z,b.w+.25,.18,b.d+.25,trim);
    box(b.x,height+.54,b.z,b.w-.25,.09,b.d-.25,S.roof);
    // A few tiled roofs vary the skyline within the same construction language.
    if(b.floors===3 && b.w>5)pitched(b.x,height+1.32,b.z,b.w+.5,b.d+.6,S.roof);
    const frontLane=b.z < -20 ? -22 : -8;
    path([[b.x,front+.4],[b.x,frontLane]],1.4);
    for(const dx of [-b.w/2+.3,b.w/2-.3]) {
      box(b.x+dx,.55,front+.85,.5,.55,.6,S.masonry);
      ball(b.x+dx,1,front+.85,.38,"#789364");
    }
    for(const dx of [-b.w/2+.1,b.w/2-.1])box(b.x+dx,height+.72,b.z,.12,.45,b.d,trim);
    const columns=b.w>5?3:2;
    for(let f=0;f<b.floors;f++) {
      const y=1.5+f*1.8;
      for(let c=0;c<columns;c++) {
        const x=b.x-b.w/2+(c+.5)*b.w/columns;
        window(x,y,front+.05,b.w>5?1.3:1,1.2);
        if(f>0) {
          box(x,y-.67,front+.45,1.65,.13,.9,trim);
          box(x,y-.06,front+.87,1.6,.055,.055,slate);
          for(let bar=0;bar<5;bar++)box(x-.72+bar*.36,y-.35,front+.87,.035,.62,.035,slate);
          if((c+f)%2===0){box(x-.45,y-.48,front+.5,.6,.24,.3,timber);ball(x-.45,y-.21,front+.5,.27,"#6c985b");}
          else {box(x+.25,y-.1,front+.64,.45,.5,.025,S.trim);box(x-.22,y-.2,front+.65,.33,.35,.025,"#b9cbc8");}
        }
      }
      for(let k=0;k<3;k++) {
        const z=b.z-2+k*1.8;
        box(b.x+b.w/2+.03,y,z,.09,1.15,1.08,trim);box(b.x+b.w/2+.085,y,z,.025,.99,.91,glass);
      }
    }
    door(b.x,front+.14,1.15,2.1);
    if(b.floors!==3 || b.w<=5) {
    box(b.x,height+1,b.z-1.5,1.9,.95,1.8,b.color);
    box(b.x,height+1.51,b.z-1.5,2.1,.12,2,trim);
    for(const dx of [-1,1]){box(b.x+dx,height+.88,b.z+.5,.7,.55,.7,"#bec8c6");post(b.x+dx,height+1.18,b.z+.5,.21,.035,slate);}
    for(let i=0;i<3;i++)ball(b.x-b.w/2+.6+i*.6,height+.9,front-.4,.28,"#7ba167");
    }
    if(b.shop){awning(b.x,2.45,front+.65,b.w-.25,S.accent);sign(b.shop,b.x,2.85,front+.16,b.w-.45,.45,S.accent);}
  }
  // Courtyards rather than more commercial objects: playground, communal tables and bike parking.
  {
    const x=30,z=-28;
    box(x,.25,z,5,.2,7,"#c0c6a0");
    for(const dx of [-1.6,1.6])for(const dz of [-1,1])post(x+dx,1.6,z+dz,.065,2.7,timber);
    box(x,2.95,z,3.7,.13,2.4,timber);
    for(const dx of [-.7,.7]){for(const a of [-.25,.25])post(x+dx+a,1.95,z,.02,1.7,slate);box(x+dx,1.05,z,.7,.12,.45,"#b77e55");}
    bench(x,-23.8);tree(32,-32,.8);
  }
  for(const x of [-21,-1,19]) {
    post(x,.85,-20.7,.6,.12,timber);post(x,.5,-20.7,.07,.6,slate);
    for(const dx of [-1,1])bench(x+dx*1.6,-20.7);
  }
  // A shaded civic forecourt, off the event route, joins the cinema and cafe.
  box(6.5,.24,3.9,8,.08,7,"#c8c5b5");
  for(let x=3;x<=10;x+=.8)box(x,.287,3.9,.025,.012,6.7,"#e4ddcc");
  for(let z=.8;z<=7;z+=.8)box(6.5,.287,z,7.7,.012,.025,"#e4ddcc");
  for(const x of [5,10]) {tree(x,1,1.15);bench(x,2.6);}
  for(const x of [6,10])for(const z of [3.8,5.8])post(x,1.7,z,.065,2.8,timber);
  for(let x=5.7;x<=10.3;x+=.4)box(x,3.15,4.8,.12,.16,2.7,timber);
  bench(8,5.4);
  // Shared rear gardens connect homes to the residential lane.
  for(const x of [-22,-12,7,17]) {
    box(x,.22,-24,1.3,.1,2.5,"#9cb08d");tree(x,-24.5,.7);
  }
  // Lamp-lit pocket square beside the cinema and planter-lined pedestrian passages.
  for(const x of [-16.8,-4.8,9.5,22]) {
    box(x,.2,2.5,1.4,.18,4,"#ccc8b6");
    for(const z of [-3.8,4.2]) {box(x,.45,z,.7,.45,.7,"#a9ab8b");ball(x,.9,z,.42,"#729263");}
  }
  const bikeGeo=new THREE.TorusGeometry(.3,.035,6,12);geometries.push(bikeGeo);
  for(const x of [-29,-28,-27,21,22]) {
    for(const dx of [-.45,.45])shape(bikeGeo,x+dx,.63,7.4,1,1,1,slate);
    box(x,.8,7.4,.9,.035,.04,"#78918b",.45);box(x,.8,7.4,.9,.035,.04,"#78918b",-.45);
    post(x+.4,1,7.4,.025,.5,slate);box(x+.42,1.25,7.4,.32,.035,.04,slate);
  }
  // Residential courtyard: two gabled houses, porch, chimney and private garden.
  {
    const {x,z}=DEMO_PLACES.home.footprints[0];
    for(const dx of [-2.65,2.65]) {
      box(x+dx,2.6,z,4.5,4.8,6.5,cream); pitched(x+dx,5.25,z,5.15,7.2,S.roof);
      box(x+dx+1.2,5.7,z-1.3,.7,2,.8,timber);
      window(x+dx,3.65,z+3.3,2.1,1.35);door(x+dx,z+3.32,1.2,2.1);
      box(x+dx,2.55,z+4,3,.17,1.6,S.roof);
      for(const a of [-1.3,1.3])post(x+dx+a,1.35,z+4.55,.055,2.2,trim);
    }
    for(let i=0;i<10;i++)box(x-4.6+i, .7,z+4.5,.1,.9,.13,trim);
    sign("青川里",x,1.3,z+4.65,1.1,.38,"#537a69");
  }
  // Office: stepped glass tower + lower entrance wing, no residential balconies.
  {
    const {x,z}=DEMO_PLACES.office.footprints[0];
    box(x-1.4,5.5,z-1,5.5,10.5,5.8,S.wallSage);box(x+2.5,2.1,z+1,3.2,3.7,5.5,S.wallSage);
    for(let f=0;f<6;f++) {
      box(x-1.4,1.25+f*1.55,z+1.96,4.9,1.25,.12,glass);
      for(let k=0;k<5;k++)box(x-3.8+k*1.2,1.25+f*1.55,z+2.04,.055,1.35,.055,trim);
      box(x-1.4,1.95+f*1.55,z+2.05,5.6,.12,.2,trim);
    }
    box(x-1.4,10.9,z-1,5.8,.3,6.1,slate);door(x+2.3,z+3.8,2.5,2.8);
    box(x+2.3,3.4,z+4.1,3.9,.15,1.7,slate);sign("AOI WORKS",x-1.4,10.3,z+2.08,4.3,.45,slate);
    for(let i=0;i<3;i++)ball(x-3+i,11.2,z-2,.4,"#74965a");
  }
  // Clinic: L-shaped civic building, glazed waiting room and accessible porch.
  {
    const {x,z}=DEMO_PLACES.clinic.footprints[0];
    box(x-2.7,3,z,3.6,5.5,7.5,S.wall);box(x+1.5,1.85,z-1.1,5.5,3.2,5.2,S.wall);
    box(x-2.7,5.85,z,4,.25,7.9,S.roof);box(x+1.5,3.6,z-1.1,5.9,.22,5.6,S.roof);
    for(let i=0;i<3;i++){window(x-3.8+i*1.1,4.35,z+3.8,.78,1.25);window(x+.1+i*1.35,1.85,z+1.55,1.06,1.9);}
    door(x-2.7,z+3.8,2,2.5);box(x-.3,2.7,z+3.5,5.6,.16,2.5,trim);
    for(const dx of [-2.4,2.4])post(x-.3+dx,1.4,z+4.6,.06,2.4,S.roof);
    box(x-2.7,6.3,z+2.2,.24,1.1,.2,"#3f8874");box(x-2.7,6.3,z+2.2,1.1,.24,.2,"#3f8874");
    bench(x+1.5,z+3.4);sign("青川诊所",x+1.6,3.1,z+1.57,3.4,.38,S.accent);
  }
  // Parcel depot: sawtooth warehouse roof and open loading bays.
  {
    const {x,z}=DEMO_PLACES.logistics.footprints[0];
    box(x,1.9,z,8.7,3.25,7.5,S.wallSand);
    for(const dx of [-2.8,0,2.8]) {pitched(x+dx,3.85,z,2.9,8,S.roof);box(x+dx,1.6,z+3.8,2.1,2.5,.13,slate);for(let k=0;k<5;k++)box(x+dx,1.05+k*.35,z+3.9,1.95,.06,.08,"#b1b8ab");}
    box(x,3.1,z+4.2,9.2,.15,1.7,S.roof);
    for(let i=0;i<7;i++) {box(x-3+i,.55,z+4.65,.65,.6,.6,"#bc8b54");box(x-3+i,.87,z+4.65,.1,.02,.61,trim);}
    sign("青川宅配",x,3.35,z+5.08,3.1,.45,S.accent);
  }
  // Market: long gabled market hall, produce stalls and a continuous striped canopy.
  {
    const {x,z}=DEMO_PLACES.supermarket.footprints[0];
    box(x,1.85,z,9.4,3.2,6.3,S.wallSand);
    upperHome(x,z,9.4,6.3,3.45,S.wallSand);pitched(x,7.25,z,10.1,7.3,S.roof);
    for(let i=0;i<5;i++){window(x-3.6+i*1.8,1.8,z+3.23,1.45,2);if(i!==2){box(x-3.6+i*1.8,.85,z+4.1,1.3,.7,.75,timber);for(let k=0;k<4;k++)ball(x-4.05+i*1.8+k*.3,1.3,z+4.1,.17,i%2?"#d68a55":"#a1b968");}}
    door(x,z+3.33,1.45,2.25);
    awning(x,2.9,z+3.7,9.8,S.accent);sign("青叶 MARKET",x,3.4,z+3.72,4.8,.47,S.accent);
  }
  // Restaurant: broad hipped roof, timber facade and lanterns.
  {
    const {x,z}=DEMO_PLACES.restaurant.footprints[0];
    box(x,1.95,z,8,3.35,6.2,S.wallSand);
    const roof=new THREE.ConeGeometry(1,1,4);geometries.push(roof);
    upperHome(x,z,8,6.2,3.65,"#c6a590");
    shape(roof,x,7.2,z,6.2,2,5,S.roof,0,Math.PI/4);
    box(x+2.3,7.35,z-1.5,.7,1.9,.7,S.masonry);
    for(let i=0;i<5;i++)window(x-3+i*1.5,1.85,z+3.18,1.05,1.9);
    door(x,z+3.28,1.4,2.3);box(x,2.95,z+3.55,8.3,.15,1.1,timber);
    for(const dx of [-3.2,3.2]){post(x+dx,2.3,z+4,.23,.55,"#d59a68");post(x+dx,2.65,z+4,.025,.3,slate);}
    sign("小镇食堂",x,3.25,z+3.78,3.1,.55,S.accent);
  }
  // Cinema: tiered art-deco silhouette, arched hall, marquee and poster vitrines.
  {
    const {x,z}=DEMO_PLACES.leisure.footprints[0];
    box(x,2.8,z-1,9.5,5,6.5,S.wallSand);
    box(x,4.1,z+2.6,6.5,7.7,1.9,S.wall);box(x,4.8,z+2.6,3.4,9.1,1.9,S.wallSand);
    for(const dx of [-2.8,-2,2,2.8])box(x+dx,4.7,z+3.61,.15,5.8,.12,trim);
    for(const dx of [-1,1])door(x+dx,z+3.65,1.6,2.9);
    box(x,3.45,z+4.15,8.2,.55,2.1,S.accent);sign("RIVER PICTURE HOUSE",x,3.47,z+5.22,7.7,.38,S.accent);
    sign("映 画",x,6.2,z+3.62,2.6,1.2,S.accent);
    for(const [w,y] of [[9.7,5.4],[6.8,8.1],[3.7,9.5]])box(x,y,z+2.65,w,.2,2.15,trim);
    for(const dx of [-2.2,2.2])window(x+dx,6.65,z+3.64,.65,1.7);
    for(let k=0;k<5;k++)box(x-1+k*.5,8.1,z+3.66,.15,.8,.08,S.masonry);
    for(let i=0;i<15;i++)ball(x-3.5+i*.5,3.13,z+5.2,.055,"#ffd996");
    for(const dx of [-3.8,3.8]){box(x+dx,1.65,z+3.62,1.15,2.3,.18,timber);box(x+dx,1.65,z+3.74,.97,2.05,.05,dx<0?"#6b909a":"#bd865c");ball(x+dx,1.9,z+3.8,.3,"#eee0bb");}
  }
  // Cafe: A-frame timber pavilion, full-height glazing and outdoor tables.
  {
    const {x,z}=DEMO_PLACES.cafe.footprints[0];
    box(x,1.8,z,6.4,3,5.7,S.wallSand);
    upperHome(x,z,6.4,5.7,3.3,S.wallSage);pitched(x,6.8,z,7.1,6.3,S.roof);
    for(let i=0;i<5;i++)window(x-2.55+i*1.28,1.85,z+2.93,1.08,2.4);
    sign("RIVER COFFEE",x,3.3,z+3.47,4.4,.42,S.roof);
    for(const dx of [-2.4,2.4]) {post(x+dx,.85,z+4,.5,.12,timber);post(x+dx,.5,z+4,.06,.6,slate);for(const a of [-.8,.8]){post(x+dx+a,.58,z+4,.23,.09,timber);post(x+dx+a,.4,z+4,.04,.35,slate);}}
  }
  // Transit: lightweight vaulted pavilion, visible platform and roadside stop marker.
  {
    const {x,z}=DEMO_PLACES.transit.footprints[0];
    for(const dx of [-3,0,3]){post(x+dx,1.65,z-1.5,.065,3,slate);post(x+dx,1.65,z+1.5,.065,3,slate);}
    for(let i=0;i<8;i++) {const dx=-3.5+(i+.5)*.875;box(x+dx,3.3+.5*Math.cos(dx/3.5*Math.PI/2),z,.94,.12,4.1,S.roof,-dx*.07);}
    bench(x-1.5,z+.5);bench(x+1.1,z+.5);post(x+3.5,2,z+2,.07,3.6,slate);
    sign("BUS",x+3.5,3.2,z+2.1,.9,.85,S.accent);sign("青川站",x,3.5,z+2.1,2.5,.4,S.accent);
  }
  // Repeated construction details tie public buildings to the residential material system.
  const shells = [
    { x:-23-2.65,z:-15,w:4.5,d:6.5,h:4.8 }, { x:-23+2.65,z:-15,w:4.5,d:6.5,h:4.8 },
    { x:-8.4,z:-16,w:5.5,d:5.8,h:10.5 }, { x:-4.5,z:-14,w:3.2,d:5.5,h:3.7 },
    { x:6.3,z:-15,w:3.6,d:7.5,h:5.5 }, { x:10.5,z:-16.1,w:5.5,d:5.2,h:3.2 },
    { x:24,z:-15,w:8.7,d:7.5,h:3.25 }, { x:-25,z:-1,w:9.4,d:6.3,h:6.05 },
    { x:-13,z:-1,w:8,d:6.2,h:6.25 }, { x:0,z:-4,w:9.5,d:6.5,h:5 },
    { x:17,z:-1.5,w:6.4,d:5.7,h:5.9 },
  ];
  for(const b of shells) {
    box(b.x,.5,b.z,b.w+.12,.5,b.d+.12,S.base);
    const front=b.z+b.d/2;
    box(b.x,b.h+.15,front+.07,b.w+.14,.14,.2,trim);
    box(b.x+b.w/2+.07,b.h+.15,b.z,.2,.14,b.d,trim);
    // Modest corner masonry, shared with the window sill thickness.
    for(let y=.9;y<b.h;y+=.62) {
      for(const dx of [-b.w/2+.13,b.w/2-.13])box(b.x+dx,y,front+.045,.28,.22,.13,S.masonry);
      box(b.x+b.w/2+.045,y,b.z-b.d/2+.13,.13,.22,.28,S.masonry);
    }
    if(b.h<6 && b.w>5) {
      box(b.x+b.w/2+.13,b.h/2,b.z-b.d/2+.2,.07,b.h,.07,S.metal);
      box(b.x-1,b.h+.6,b.z-1,.85,.55,.75,S.wallStone);
      post(b.x-1,b.h+.89,b.z-1,.23,.025,S.metal);
    }
  }
  // Side elevations, street furniture and gardens complete the default oblique view.
  for (const target of ["home", "office", "clinic", "logistics", "supermarket", "restaurant", "leisure", "cafe"] as const) {
    const b = DEMO_PLACES[target].footprints[0];
    const side = target === "office" ? b.x + 1.35 : target === "clinic" ? b.x + 4.25 : target === "logistics" ? b.x + 4.35 : target === "supermarket" ? b.x + 4.7 : b.x + b.w / 2 - (target === "home" ? .1 : target === "cafe" ? .8 : target === "restaurant" ? .5 : .25);
    const mixedUse = ["supermarket", "restaurant", "cafe"].includes(target);
    const rows = target === "office" ? 5 : target === "leisure" || mixedUse ? 2 : 1;
    const floorStep = mixedUse ? 2.9 : 1.55;
    for(let f=0;f<rows;f++) for(let k=0;k<3;k++) {
      const z=b.z-2.4+k*(target === "office" || target === "clinic" ? 1.2 : 1.9);
      box(side+.03,1.7+f*floorStep,z,.09,1.16,1.3,trim);
      box(side+.09,1.7+f*floorStep,z,.04,1,1.15,glass);
      box(side+.13,1.7+f*floorStep,z,.025,1.04,.05,trim);
      box(side+.12,1.08+f*floorStep,z,.25,.12,1.42,trim);
      box(side+.08,2.34+f*floorStep,z,.2,.12,1.42,trim);
    }
    for(const dx of [-b.w/2+.3,b.w/2-.3]) {
      box(b.x+dx,.55,b.z+b.d/2+.3,.7,.6,.7,"#a7aa81");
      ball(b.x+dx,1,b.z+b.d/2+.3,.43,"#688851");
    }
  }
  for(let x=-30;x<=30;x+=7.5) {
    post(x,1.8,8.6,.055,3.2,slate);box(x,3.3,8.6,.48,.13,.48,slate);box(x,3.08,8.6,.3,.35,.3,"#f7e4b1");
  }
  for(const x of [-30,-6,7,29]) {bench(x,8.8);tree(x+1.7,8.5,.7);}
  // Small planted beds frame the civic courtyard without occupying the river edge.
  for(const x of [-15,0,17]) {
    box(x,.35,-4.8,2.5,.35,1.1,"#b4b5a0");
    for(let i=0;i<5;i++){ball(x-1+i*.5,.75,-4.8,.35,"#84996a");ball(x-1+i*.5,1,-4.8,.09,"#e4c886");}
  }
  // Everyday street objects sit at the curb, leaving the walking lanes open.
  for(const [x,z,color] of [[-28,-6.6,"#d5c9ac"],[-17,-6.6,"#8da8a5"],[15,-6.6,"#bca18d"],[29,-6.6,"#e5ded0"]] as const) {
    box(x,.7,z,2.9,.65,1.2,color);box(x-.15,1.17,z,1.55,.52,1.08,color);
    box(x-.15,1.2,z+.55,1.3,.35,.025,glass);
    for(const dx of [-.95,.95])for(const dz of [-.59,.59])ball(x+dx,.45,z+dz,.25,slate);
    box(x+1.46,.7,z,.03,.18,.9,trim);
  }
  for(const [x,z] of [[-20,3.3],[-8,3],[21,2.3]]) {
    box(x,.65,z,.65,.95,.6,S.accent);box(x,1.15,z,.72,.12,.65,slate);
    box(x+1,.8,z,.7,1.2,.07,timber);box(x+1,.82,z+.05,.56,.8,.025,slate);
  }
  for(const batch of batches.values()) {
    const mesh=new THREE.InstancedMesh(batch.geometry,material(batch.color),batch.matrices.length);
    batch.matrices.forEach((matrix,index)=>mesh.setMatrixAt(index,matrix));mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();root.add(mesh);
  }
  const train=new THREE.Group();root.add(train);
  const trainPart=(x:number,y:number,z:number,w:number,h:number,d:number,c:string)=>{
    const mesh=new THREE.Mesh(cube,material(c));mesh.position.set(x,y,z);mesh.scale.set(w,h,d);mesh.castShadow=true;train.add(mesh);
  };
  for(let car=0;car<3;car++) {
    const x=(car-1)*6.3;
    trainPart(x,5.12,railZ,5.8,1.95,2.1,S.trim);trainPart(x,6.15,railZ,5.85,.18,2.13,S.metal);
    trainPart(x,4.82,railZ+1.065,5.8,.28,.055,"#558f87");
    for(let w=0;w<5;w++)trainPart(x-2.2+w*1.08,5.53,railZ+1.075,.8,.75,.04,S.glass);
    for(const dx of [-1.8,1.8])trainPart(x+dx,4.03,railZ,.65,.4,1.7,slate);
    trainPart(x,5.13,railZ-1.065,5.5,1.1,.04,S.glass);
  }
  return { update(_visual, dusk) {
    const windows=material(S.glass); windows.emissive.set(dusk ? "#f6be76" : "#000000"); windows.emissiveIntensity=dusk ? .45 : 0;
    const lamps=material("#f7e4b1"); lamps.emissive.set(dusk ? "#ffcc88" : "#000000"); lamps.emissiveIntensity=dusk ? 1.1 : 0;
  }, tick(seconds) { train.position.x = Math.sin(seconds * .085) * 23; }, dispose() {scene.remove(root);root.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());} };
}
