// Character traits: what each person is like, from data/traits.json. Only the head's traits act on
// the business; an heir's matter once they take over.
import type { Rng } from "./rng";
import type { GameData, TraitEffects, TraitType } from "./tuning";
import type { Person } from "./types";

const STAT_EFFECTS = ["acumen", "prudence", "connections"] as const;
const MULTIPLIERS = ["death_chance", "venture_failure", "withdrawals", "family_cost", "reputation_gain"] as const;

export function traitById(id: string, data: GameData): TraitType | undefined {
  return data.traits.find((t) => t.id === id);
}

/** The traits a person could still gain: not already held, and not the opposite of one held. */
export function openTraits(held: string[], data: GameData): TraitType[] {
  const blocked = new Set(held.flatMap((id) => [id, traitById(id, data)?.opposite].filter((x): x is string => !!x)));
  return data.traits.filter((t) => !blocked.has(t.id) && !(t.opposite && held.includes(t.opposite)));
}

/** One trait drawn at random from those still open to the person (one roll), or null if none is. */
export function drawTrait(held: string[], rng: Rng, data: GameData): string | null {
  const open = openTraits(held, data);
  if (!open.length) return null;
  return open[Math.floor(rng.next() * open.length)]!.id;
}

/**
 * A newborn's trait: with inherit_chance, one of the parent's traits still open to the child
 * (picked at random), otherwise a random trait. Two rolls.
 */
export function birthTrait(parentTraits: string[], rng: Rng, data: GameData): string | null {
  const inherit = rng.next() < data.tuning.family.traits.inherit_chance;
  const fromParent = openTraits([], data).filter((t) => parentTraits.includes(t.id));
  if (inherit && fromParent.length) return fromParent[Math.floor(rng.next() * fromParent.length)]!.id;
  return drawTrait([], rng, data);
}

/** The combined effects of a person's traits: stat effects add up, multipliers multiply. */
export function traitEffects(p: Pick<Person, "traits">, data: GameData): Required<TraitEffects> {
  const out: Required<TraitEffects> = { acumen: 0, prudence: 0, connections: 0, death_chance: 1, venture_failure: 1, withdrawals: 1, family_cost: 1, reputation_gain: 1 };
  for (const id of p.traits) {
    const t = traitById(id, data);
    if (!t) continue;
    for (const k of STAT_EFFECTS) out[k] += t.effects[k] ?? 0;
    for (const k of MULTIPLIERS) out[k] *= t.effects[k] ?? 1;
  }
  return out;
}

/** Problems with data/traits.json and the traits named in data/family.json, as readable lines. */
export function checkTraitData(data: GameData): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const known = new Set<string>([...STAT_EFFECTS, ...MULTIPLIERS]);
  for (const t of data.traits) {
    const p = (msg: string) => problems.push(`${t.id}: ${msg}`);
    if (ids.has(t.id)) p("duplicate id");
    ids.add(t.id);
    if (!t.name || !t.description) p("needs a name and a description");
    if (/[—–]/.test(t.name + t.description)) p("uses a dash; the writing style forbids em dashes");
    for (const k of Object.keys(t.effects)) if (!known.has(k)) p(`unknown effect "${k}"`);
    for (const k of MULTIPLIERS) if (t.effects[k] !== undefined && !(t.effects[k]! > 0)) p(`${k} must be above zero`);
    if (t.opposite) {
      const o = data.traits.find((x) => x.id === t.opposite);
      if (!o) p(`opposite "${t.opposite}" is not a trait`);
      else if (o.opposite !== t.id) p(`opposite "${t.opposite}" does not name it back`);
    }
    if (t.virtue_for && !(STAT_EFFECTS as readonly string[]).includes(t.virtue_for)) p(`virtue_for "${t.virtue_for}" is not a stat`);
  }
  for (const stat of STAT_EFFECTS) {
    if (data.traits.filter((t) => t.virtue_for === stat).length !== 1) problems.push(`stat ${stat}: needs exactly one virtue`);
  }
  for (const [who, traits] of [["founder", data.family.head.traits], ["cousin", data.family.cousin.traits]] as const) {
    for (const id of traits) if (!ids.has(id)) problems.push(`${who}: unknown trait "${id}"`);
    if (traits.some((id) => traits.includes(traitById(id, data)?.opposite ?? ""))) problems.push(`${who}: holds opposite traits`);
  }
  return problems;
}
