import { describe, expect, it } from "vitest";
import fixture from "../../tests/fixtures/town-visual-demo.json";
import { validateTownEvents } from "../src/town/adapter/townEvents";
import { ReplayEngine } from "../src/town/replay/replayEngine";
import { DemoWalkways, DEMO_PLACES, RESIDENTIAL_BLOCKS, RAILWAY } from "../src/showcase/town3d/demoTownMap";
import periods from "../../tests/fixtures/town-period-demo.json";

describe("transaction town demo", () => {
  it("plays every synthetic scene with behavior-specific movement", () => {
    const document = validateTownEvents(fixture);
    for (const event of document.events) {
      const engine = new ReplayEngine({ routes: new DemoWalkways() });
      engine.loadDocument({ ...document, events: [{ ...event, schedule_seconds: 0 }] });
      engine.selectBusiestDay(); engine.play(); engine.tick(.05);
      const snapshot = engine.getSnapshot();
      expect(snapshot.firedCount).toBe(1);
      if (["CREDIT", "PASSIVE"].includes(event.behavior)) expect(snapshot.actors).toHaveLength(0);
      else expect(snapshot.actors.length).toBeGreaterThan(0);
      if (event.behavior === "DELIVERY") expect(snapshot.actors[0].role).toBe("courier");
      engine.setFrozen(true);
      const paused = JSON.stringify(engine.getSnapshot());
      engine.tick(.1);
      expect(JSON.stringify(engine.getSnapshot())).toBe(paused);
    }
  });
});

describe("period demo layout and scope", () => {
  it("keeps all buildings north of the river and movement out of footprints", () => {
    const footprints = Object.values(DEMO_PLACES).flatMap(p => p.footprints);
    expect(footprints.every(b => b.z + b.d / 2 < 8)).toBe(true);
    const routes = new DemoWalkways();
    for (const event of validateTownEvents(fixture).events) {
      const route = routes.routeForEvent(event, 0);
      if (!route) continue;
      const points = [route.spawn, ...route.path];
      for (let i=1;i<points.length;i++) for (let step=0;step<=20;step++) {
        const t=step/20; const x=points[i-1].x*(1-t)+points[i].x*t; const z=points[i-1].z*(1-t)+points[i].z*t;
        expect(footprints.some(b => Math.abs(x-b.x)<b.w/2 && Math.abs(z-b.z)<b.d/2)).toBe(false);
      }
    }
  });
  it("replays an entire month or year and safely reloads an empty period", () => {
    const engine = new ReplayEngine({ routes: new DemoWalkways(), periodMontage: true });
    for (const period of [periods.periods["2026-05"], periods.periods["2026"]]) {
      const document = validateTownEvents(period.document);
      engine.loadDocument(document);engine.selectBusiestDay();engine.play();
      expect(engine.getSnapshot().totalEvents).toBe(period.summary.count);
      for(let step=0;step<1900;step++)engine.tick(.1);
      expect(engine.getSnapshot().firedCount).toBe(period.summary.count);
      expect(engine.getSnapshot().status).toBe("finished");
    }
    engine.loadDocument({ ...validateTownEvents(fixture), events: [] });
    expect(engine.getSnapshot().totalEvents).toBe(0);
    expect(engine.currentDay()).toBe(null);
  });
  it("uses integer precomputed totals matching the synthetic period facts", () => {
    for (const period of Object.values(periods.periods)) {
      const events=period.document.events;
      expect(period.summary.income_minor).toBe(events.filter(e=>e.direction==="income").reduce((sum,e)=>sum+e.amount_minor,0));
      expect(period.summary.expense_minor).toBe(events.filter(e=>e.direction==="expense").reduce((sum,e)=>sum+e.amount_minor,0));
    }
  });
});

describe("permanent residential town plan", () => {
  it("retains a residential majority and separates buildings from each other and the railway", () => {
    expect(RESIDENTIAL_BLOCKS.length + 2).toBeGreaterThan(Object.keys(DEMO_PLACES).length - 2);
    const buildings=Object.values(DEMO_PLACES).flatMap(p=>p.footprints);
    for(let i=0;i<buildings.length;i++) {
      const a=buildings[i];
      expect(a.z-a.d/2).toBeGreaterThan(RAILWAY.z+2.2);
      for(let j=i+1;j<buildings.length;j++) {
        const b=buildings[j];
        expect(Math.abs(a.x-b.x)<(a.w+b.w)/2 && Math.abs(a.z-b.z)<(a.d+b.d)/2).toBe(false);
      }
    }
  });
  it("takes residents to residential front doors without crossing buildings", () => {
    const routes=new DemoWalkways();
    const buildings=Object.values(DEMO_PLACES).flatMap(p=>p.footprints);
    for(let seed=0;seed<RESIDENTIAL_BLOCKS.length;seed++) {
      const route=routes.ambientPlaceRoute("home",seed)!;
      const points=[route.spawn,...route.path];
      for(let i=1;i<points.length;i++) for(let k=0;k<=30;k++) {
        const t=k/30;const x=points[i-1].x*(1-t)+points[i].x*t;const z=points[i-1].z*(1-t)+points[i].z*t;
        expect(buildings.some(b=>Math.abs(x-b.x)<b.w/2 && Math.abs(z-b.z)<b.d/2)).toBe(false);
      }
    }
  });
});
