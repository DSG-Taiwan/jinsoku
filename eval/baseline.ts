import { caseSpecs, inPeriod, loadFacts, type CaseSpec, type IssueFact } from "./derive.ts";
import { type Attempt } from "./score.ts";

function rowSentence(row: IssueFact): string {
  const hazard =
    row.kind === "HAZARD" && row.closed_at == null ? " This HAZARD stays open for a human." : "";
  return `${row.issue_id} ${row.asset_id} ${row.kind} opened ${row.opened_at} actor ${row.actor_key} ${row.fix_outcome} reason ${row.reason}.${hazard}`;
}

export function baselineText(spec: CaseSpec): string {
  const facts = loadFacts();
  if (spec.expect === "refusal") {
    return spec.status === "DENIED"
      ? "This command needs lead or higher. A tech cannot run it."
      : "Unprocessed. Allowed phrases: CAUSE <asset>, PATTERNS thisweek|lastweek, NEXT <asset>.";
  }
  if (spec.phrase === "PATTERNS" && spec.period) {
    const rows = facts.issues.filter((row) => inPeriod(row.opened_at, spec.period!));
    const extra = facts.openHazards.filter((row) => !rows.some((item) => item.issue_id === row.issue_id));
    return [...rows, ...extra].map(rowSentence).join(" ");
  }
  if (spec.phrase === "NEXT" && spec.asset) {
    const asset = facts.assets.find((item) => item.asset_id === spec.asset);
    if (!asset) throw new Error(`missing ${spec.asset}`);
    const lines = [rowSentence(asset.next.event)];
    if (asset.open_hazards.length > 0) lines.push(...asset.open_hazards.map(rowSentence));
    else lines.push("Open HAZARD count 0.");
    return lines.join(" ");
  }
  if (spec.asset) {
    const asset = facts.assets.find((item) => item.asset_id === spec.asset);
    if (!asset) throw new Error(`missing ${spec.asset}`);
    const lines = asset.issues.map(rowSentence);
    if (asset.open_hazards.length === 0) lines.push("Open HAZARD count 0.");
    return lines.join(" ");
  }
  throw new Error(`no baseline for ${spec.id}`);
}

export function baselineAttempts(specs = caseSpecs()): Attempt[] {
  return specs.map((spec) => {
    if (spec.expect === "refusal") {
      return {
        case_id: spec.id,
        status: spec.status ?? "UNPROCESSED",
        agents_used: ["ingest"],
        text: baselineText(spec),
        reason_code: spec.reason_code,
      };
    }
    return {
      case_id: spec.id,
      status: "ok",
      agents_used: ["baseline"],
      text: baselineText(spec),
      reason_code: null,
    };
  });
}
