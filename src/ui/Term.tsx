// An underlined term that opens its explanation card on click (never on hover). Links inside the
// card open further cards in the same place, with Back to return, in the style of a grand-strategy
// tooltip chain. The term keeps its line height in prose; CSS widens its click area to 44 px.
import { Popover } from "radix-ui";
import { useState, type ReactNode } from "react";
import { gameData } from "../data";
import { GLOSSARY, parseGlossary } from "./glossary";
import { keepUnits } from "./format";

export function Term({ id, children }: { id: string; children: ReactNode }) {
  if (!GLOSSARY[id]) return <>{children}</>;
  return (
    <Popover.Root>
      <Popover.Trigger className="term">{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="card-pop term-card" side="bottom" align="start" sideOffset={4} collisionPadding={12}>
          <TermCard start={id} />
          <Popover.Arrow className="card-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The card for `start`, and the trail of cards opened from it. */
function TermCard({ start }: { start: string }) {
  const [trail, setTrail] = useState<string[]>([start]);
  const id = trail.at(-1)!;
  const card = GLOSSARY[id]!;
  return (
    <>
      <header className="card-head">
        {trail.length > 1 && (
          <button className="back" onClick={() => setTrail(trail.slice(0, -1))} aria-label={`Back to ${GLOSSARY[trail.at(-2)!]!.title}`}>
            Back
          </button>
        )}
        <h3>{card.title}</h3>
        <Popover.Close className="close" aria-label="Close">×</Popover.Close>
      </header>
      <p className="card-text">
        {parseGlossary(keepUnits(card.body(gameData))).map((s, i) =>
          "link" in s ? (
            <button key={i} className="term" onClick={() => setTrail([...trail, s.link])}>{s.text}</button>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </p>
      {trail.length > 1 && <p className="card-trail small">{trail.map((t) => GLOSSARY[t]!.title).join(" > ")}</p>}
    </>
  );
}
