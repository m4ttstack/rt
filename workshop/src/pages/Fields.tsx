import { FIELD_PARTS, RadioGroup, TextArea, TextField } from "@mattstack/tui-kit";
import { useState } from "react";

/**
 * The Field family's workshop page (TextField, TextArea, RadioGroup).
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule Switches.tsx/Badges.tsx follow.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what the input chrome and focus accent follow through the
 * theme.
 */

const OAUTH_OPTIONS = [
  { value: "domains", label: "Anyone at these domains" },
  { value: "emails", label: "These people" },
] as const;

const column = { display: "flex", flexDirection: "column", gap: "0.8rem", marginTop: "1rem", maxWidth: "22rem" } as const;

export function Fields() {
  const [name, setName] = useState("mr-board");
  const [slug, setSlug] = useState("mr board");
  const [password, setPassword] = useState("");
  const [allowedEmails, setAllowedEmails] = useState("a@example.com\nb@example.com");
  const [oauthMode, setOauthMode] = useState<string>("domains");

  const slugError = /^[a-z0-9][a-z0-9.-]*$/.test(slug) ? null : "lowercase letters, digits, dots, hyphens only";

  return (
    <div>
      <h1>Field family</h1>
      <p>
        TextField, TextArea and RadioGroup — three form-control recipes
        sharing one CSS shape and one <code>FIELD_PARTS</code> selector
        surface, the way Segmented/LabeledSeg share theirs.
      </p>

      <h2 style={{ marginTop: "2rem" }}>a working form</h2>
      <form style={column} onSubmit={(ev) => ev.preventDefault()}>
        <TextField
          label="Name"
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          placeholder="myapp"
          required
        />
        <TextField
          label="Slug"
          value={slug}
          onChange={(ev) => setSlug(ev.target.value)}
          placeholder="myapp"
          pattern="[a-z0-9][a-z0-9.-]*"
          title="lowercase letters, digits, dots, hyphens"
          error={slugError}
        />
        <TextField
          type="password"
          value={password}
          onChange={(ev) => setPassword(ev.target.value)}
          aria-label="new password"
          placeholder="new password"
        />
        <TextArea
          label="Allowed emails"
          rows={4}
          value={allowedEmails}
          onChange={(ev) => setAllowedEmails(ev.target.value)}
          placeholder="one per line"
        />
        <RadioGroup
          name="oauth-mode"
          value={oauthMode}
          onChange={setOauthMode}
          options={OAUTH_OPTIONS}
        />
      </form>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Each root carries <code>data-part="{FIELD_PARTS.root}"</code>; a
        visible label span carries{" "}
        <code>data-part="{FIELD_PARTS.label}"</code>; the input/textarea
        carries <code>data-part="{FIELD_PARTS.input}"</code>; an error line
        carries <code>data-part="{FIELD_PARTS.error}"</code> with{" "}
        <code>role="alert"</code>; each radio row carries{" "}
        <code>data-part="{FIELD_PARTS.option}"</code> — the tui-kit
        convention that replaces the hashed CSS-module class name as the
        kit's cross-boundary selector hook.
      </p>
    </div>
  );
}
