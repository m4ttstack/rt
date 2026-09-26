import type { ReactNode } from 'react';
import { Invadr } from 'invadrs/react';

/** A person as the sheets name them everywhere: their invader and their
    name in the author colour, one inline unit. */
export function PersonTag({
  id,
  name,
}: {
  /** The username the invader is generated from. */
  id: string;
  name: string;
}) {
  return (
    <span className="tui-person">
      <Invadr id={id} palette="css-vars" className="tui-person-avatar" />
      <strong className="tui-person-name">{name}</strong>
    </span>
  );
}

/** A card's lead line about a person: who, then what they did ("opened !12
    into main", "reviewed your merge request"), with anything `trailing`
    (the MR's links) held to the right edge. */
export function PersonLead({
  id,
  name,
  children,
  trailing,
}: {
  id: string;
  name: string;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="tui-id-card-top">
      <p className="tui-id-card-lead">
        <PersonTag id={id} name={name} /> {children}
      </p>
      {trailing}
    </div>
  );
}
