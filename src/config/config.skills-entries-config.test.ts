import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

describe("skills entries config schema", () => {
  it("accepts custom fields under config", () => {
    const res = OpenClawSchema.safeParse({
      skills: {
        entries: {
          "custom-skill": {
            enabled: true,
            config: {
              url: "https://example.invalid",
              token: "abc123",
            },
          },
        },
      },
    });

    expect(res.success).toBe(true);
  });

  it("rejects unknown top-level fields", () => {
    const res = OpenClawSchema.safeParse({
      skills: {
        entries: {
          "custom-skill": {
            url: "https://example.invalid",
          },
        },
      },
    });

    expect(res.success).toBe(false);
    if (res.success) {
      return;
    }

    expect(
      res.error.issues.some(
        (issue) =>
          issue.path.join(".") === "skills.entries.custom-skill" &&
          issue.message.toLowerCase().includes("unrecognized"),
      ),
    ).toBe(true);
  });

  it("accepts valid skills.policy agent overrides", () => {
    const res = OpenClawSchema.safeParse({
      agents: {
        list: [{ id: "writer" }, { id: "reviewer" }],
      },
      skills: {
        policy: {
          globalEnabled: ["github", "weather"],
          agentOverrides: {
            writer: { enabled: ["docs-search"] },
            reviewer: { disabled: ["weather"] },
          },
        },
      },
    });

    expect(res.success).toBe(true);
  });

  it("accepts skills.policy override for the implicit main agent", () => {
    const res = OpenClawSchema.safeParse({
      skills: {
        policy: {
          agentOverrides: {
            main: { enabled: ["docs-search"] },
          },
        },
      },
    });

    expect(res.success).toBe(true);
  });

  it("rejects unknown skills.policy agent overrides", () => {
    const res = OpenClawSchema.safeParse({
      agents: {
        list: [{ id: "writer" }],
      },
      skills: {
        policy: {
          agentOverrides: {
            reviewer: { enabled: ["docs-search"] },
          },
        },
      },
    });

    expect(res.success).toBe(false);
    if (res.success) {
      return;
    }

    expect(
      res.error.issues.some(
        (issue) =>
          issue.path.join(".") === "skills.policy.agentOverrides.reviewer" &&
          issue.message.includes('Unknown agent id "reviewer"'),
      ),
    ).toBe(true);
  });

  it("rejects overlapping enabled and disabled skills for one agent override", () => {
    const res = OpenClawSchema.safeParse({
      agents: {
        list: [{ id: "writer" }],
      },
      skills: {
        policy: {
          agentOverrides: {
            writer: {
              enabled: ["docs_search"],
              disabled: ["docs.search"],
            },
          },
        },
      },
    });

    expect(res.success).toBe(false);
    if (res.success) {
      return;
    }

    expect(
      res.error.issues.some(
        (issue) =>
          issue.path.join(".") === "skills.policy.agentOverrides.writer" &&
          issue.message.includes("cannot be both enabled and disabled"),
      ),
    ).toBe(true);
  });
});
