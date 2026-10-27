import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROJECT_ROOT } from "../config.ts";
import { ASSETS, ISSUES } from "../data/seed.ts";

type GraphEntity = {
  id: string;
  type: string;
  name?: string;
  attrs: Record<string, unknown>;
};

type WorldModel = {
  upsertEntity(input: {
    type: string;
    externalKey?: { system: string; id: string };
    name?: string;
    attrs?: Record<string, unknown>;
    source: { kind: string; at: string };
    state?: "active";
  }): Promise<GraphEntity>;
  relate(input: {
    from: string;
    type: string;
    to: string;
    source: { kind: string; at: string };
  }): Promise<{ id: string }>;
  view(name: "graph"): {
    query(opts: { type?: string }): GraphEntity[];
    neighborsOf(id: string, opts?: { via?: string }): GraphEntity[];
  };
};

const SOURCE = { kind: "synthetic", at: "2026-10-21T00:00:00.000Z" };
let model: WorldModel | null = null;
let seeded = false;

async function getModel(): Promise<WorldModel> {
  if (model) return model;
  const entry = path.join(PROJECT_ROOT, "vendor", "world-model", "reference", "src", "index.ts");
  const loaded = await import(pathToFileURL(entry).href);
  model = new loaded.WorldModel({
    namespace: "hvac-d3",
    storage: "local",
    directory: path.join(PROJECT_ROOT, "data", "world"),
  }) as WorldModel;
  return model;
}

export async function seedUnitState(): Promise<void> {
  if (seeded) return;
  const wm = await getModel();
  const existing = wm.view("graph").query({ type: "unit" });
  const hazards = wm.view("graph").query({ type: "hazard" });
  if (existing.length >= ASSETS.length && hazards.length > 0) {
    seeded = true;
    return;
  }
  for (const asset of ASSETS) {
    const entity = await wm.upsertEntity({
      type: "unit",
      externalKey: { system: "hvac", id: asset.asset_id },
      name: asset.asset_id,
      attrs: { asset_id: asset.asset_id, model: asset.model, zone: asset.zone, location: asset.location },
      source: SOURCE,
      state: "active",
    });
    const openHazards = ISSUES.filter(
      (row) => row.asset_id === asset.asset_id && row.kind === "HAZARD" && row.closed_at === null,
    );
    for (const issue of openHazards) {
      const hazard = await wm.upsertEntity({
        type: "hazard",
        externalKey: { system: "hvac", id: issue.issue_id },
        name: issue.issue_id,
        attrs: { asset_id: asset.asset_id, issue_id: issue.issue_id, open: true },
        source: SOURCE,
        state: "active",
      });
      await wm.relate({ from: entity.id, type: "has_hazard", to: hazard.id, source: SOURCE });
    }
  }
  seeded = true;
}

export interface UnitState {
  id: string;
  content: string;
}

export async function queryUnits(assetId?: string): Promise<UnitState[]> {
  await seedUnitState();
  const wm = await getModel();
  const units = wm.view("graph").query({ type: "unit" });
  const matched = assetId ? units.filter((unit) => unit.name === assetId || unit.attrs.asset_id === assetId) : units;
  return matched.map((unit) => {
    const count = wm
      .view("graph")
      .neighborsOf(unit.id, { via: "has_hazard" })
      .filter((entity) => entity.type === "hazard").length;
    return {
      id: String(unit.id),
      content: `Unit ${unit.name} model ${unit.attrs.model} zone ${unit.attrs.zone} location ${unit.attrs.location}. Open HAZARD count ${count}, read from the world-model graph.`,
    };
  });
}
