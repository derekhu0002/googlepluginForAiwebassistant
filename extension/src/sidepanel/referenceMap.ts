export interface OpenCodeReferenceInput {
  path: string;
  zone: "shell" | "header" | "stage" | "transcript" | "styles" | "panels" | "visual";
  adaptation: string;
}

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-SHELL */
export const OPENCODE_REFERENCE_INPUTS: OpenCodeReferenceInput[] = [
  {
    path: "anomalyco/opencode@dev/packages/console/app/src/app.tsx",
    zone: "shell",
    adaptation: "Copied the split entry ownership pattern so App.tsx only orchestrates shell zones."
  },
  {
    path: "anomalyco/opencode@dev/packages/console/app/src/app.css",
    zone: "styles",
    adaptation: "Reused the app.css -> style/index.css entry pattern for sidepanel styling."
  },
  {
    path: "anomalyco/opencode@dev/packages/console/app/src/component/header.tsx",
    zone: "header",
    adaptation: "Borrowed the prominent branded top section, metadata strip, and dense nav layout language."
  },
  {
    path: "anomalyco/opencode@dev/packages/console/app/src/component/spotlight.tsx",
    zone: "visual",
    adaptation: "Adapted the luminous spotlight mood into CSS-only shell gradients suitable for an extension sidepanel."
  },
  {
    path: "anomalyco/opencode@dev/packages/console/app/src/component/",
    zone: "panels",
    adaptation: "Used the console component directory as the module-boundary reference for header/panels/composer decomposition."
  },
  {
    path: "anomalyco/opencode@dev/packages/web/src/components/Header.astro",
    zone: "header",
    adaptation: "Used the web header's centered link grouping and compact metadata framing for the shell header."
  },
  {
    path: "anomalyco/opencode@dev/packages/web/src/components/Lander.astro",
    zone: "visual",
    adaptation: "Adapted the framed hero/CTA grid rhythm into sidepanel cards, rails, and section dividers."
  },
  {
    path: "anomalyco/opencode@dev/packages/web/src/components/Share.tsx",
    zone: "stage",
    adaptation: "Used as the primary contract for header -> message list -> summary stage framing and for keeping transcript rendering centered on messages[] with nested parts[]."
  },
  {
    path: "anomalyco/opencode@dev/packages/web/src/components/share.module.css",
    zone: "transcript",
    adaptation: "Used as the primary styling contract for stacked part framing, decoration gutters, and summary-tail density without restoring role shells."
  },
  {
    path: "anomalyco/opencode@dev/packages/web/src/components/share/part.tsx",
    zone: "transcript",
    adaptation: "Used as the primary rendering contract for keeping part decoration inside each message and avoiding any avatar or side-swapped chat shell."
  },
  {
    path: "anomalyco/opencode@dev/packages/web/src/components/share/common.tsx",
    zone: "transcript",
    adaptation: "Used as the primary contract for lightweight decoration utilities and compact footer conventions adapted to the sidepanel width."
  },
  {
    path: "anomalyco/opencode@dev/packages/console/app/src/component/dropdown.tsx",
    zone: "panels",
    adaptation: "Used as a secondary reference for dense overlay action affordances and trigger spacing, without changing transcript message-part structure."
  },
  {
    path: "anomalyco/opencode@dev/packages/console/app/src/component/dropdown.css",
    zone: "styles",
    adaptation: "Used as a secondary reference for compact interactive density and menu-trigger hover treatment."
  },
  {
    path: "anomalyco/opencode@dev/packages/console/app/src/component/header.tsx",
    zone: "header",
    adaptation: "Used as a secondary reference for dense metadata grouping around the stage header while leaving Share.tsx as the transcript contract."
  },
  {
    path: "anomalyco/opencode@dev/packages/console/app/src/component/spotlight.tsx",
    zone: "visual",
    adaptation: "Used as a secondary reference for restrained panel atmosphere only, not for transcript structure."
  },
  {
    path: "anomalyco/opencode@dev/packages/web/src/assets/lander/*",
    zone: "visual",
    adaptation: "Referenced the asset family's monochrome product-mark language and converted it into text-first sidepanel branding."
  }
] as const;

export const OPENCODE_ZONE_MAP = [
  { key: "header", label: "header", note: "top branding + session meta" },
  { key: "main-stage", label: "main stage", note: "summary + transcript + follow-up" },
  { key: "aux-panels", label: "auxiliary panels", note: "sessions / context / permissions / rules" },
  { key: "composer", label: "composer", note: "prompt dock + utilities" },
  { key: "status-rail", label: "status rail", note: "live run + reference digest" }
] as const;
