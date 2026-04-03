import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

let listSkillCommandsForAgents: typeof import("./skill-commands.js").listSkillCommandsForAgents;
let resolveSkillCommandInvocation: typeof import("./skill-commands.js").resolveSkillCommandInvocation;
let skillCommandsTesting: typeof import("./skill-commands.js").__testing;

type SkillCommandMockRegistrar = (path: string, factory: () => unknown) => void;
type MockSkillEntry = {
  skill: {
    name: string;
    filePath: string;
  };
  description: string;
  metadata?: {
    skillKey?: string;
  };
};

function resolveUniqueSkillCommandName(base: string, used: Set<string>): string {
  let name = base;
  let suffix = 2;
  while (used.has(name.toLowerCase())) {
    name = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

function createMockSkillEntry(
  workspaceDir: string,
  dirName: string,
  params: {
    skillName: string;
    description: string;
    skillKey?: string;
  },
): MockSkillEntry {
  return {
    skill: {
      name: params.skillName,
      filePath: path.join(workspaceDir, "skills", dirName, "SKILL.md"),
    },
    description: params.description,
    ...(params.skillKey ? { metadata: { skillKey: params.skillKey } } : {}),
  };
}

function resolveWorkspaceSkillEntries(workspaceDir: string): MockSkillEntry[] {
  const dirName = path.basename(workspaceDir);
  if (dirName === "main") {
    return [
      createMockSkillEntry(workspaceDir, "demo-skill", {
        skillName: "demo-skill",
        description: "Demo skill",
      }),
    ];
  }
  if (dirName === "research") {
    return [
      createMockSkillEntry(workspaceDir, "demo-skill", {
        skillName: "demo-skill",
        description: "Demo skill 2",
      }),
      createMockSkillEntry(workspaceDir, "extra-skill", {
        skillName: "extra-skill",
        description: "Extra skill",
      }),
    ];
  }
  if (dirName === "shared-policy") {
    return [
      createMockSkillEntry(workspaceDir, "alpha-skill", {
        skillName: "alpha-skill",
        description: "Alpha skill",
      }),
      createMockSkillEntry(workspaceDir, "beta-skill", {
        skillName: "beta-skill",
        description: "Beta skill",
      }),
      createMockSkillEntry(workspaceDir, "hidden-skill", {
        skillName: "hidden-skill",
        description: "Hidden skill",
      }),
    ];
  }
  if (dirName === "shared-policy-keys") {
    return [
      createMockSkillEntry(workspaceDir, "hidden-shared", {
        skillName: "shared-skill",
        description: "Hidden shared skill",
        skillKey: "shared-hidden",
      }),
      createMockSkillEntry(workspaceDir, "visible-shared", {
        skillName: "shared-skill",
        description: "Visible shared skill",
        skillKey: "shared-visible",
      }),
    ];
  }
  if (dirName === "shared-policy-alias") {
    return [
      createMockSkillEntry(workspaceDir, "alpha-dot", {
        skillName: "alpha.skill",
        description: "Hidden alias skill",
      }),
      createMockSkillEntry(workspaceDir, "alpha-dash", {
        skillName: "alpha-skill",
        description: "Visible alias skill",
      }),
    ];
  }
  return [];
}

function buildWorkspaceSkillCommandSpecs(
  workspaceDir: string,
  opts?: {
    reservedNames?: Set<string>;
    skillFilter?: string[];
    agentId?: string;
    entries?: MockSkillEntry[];
    skipFiltering?: boolean;
    config?: {
      skills?: {
        policy?: {
          globalEnabled?: string[];
          agentOverrides?: Record<string, { enabled?: string[]; disabled?: string[] }>;
        };
      };
    };
  },
) {
  const used = new Set<string>();
  for (const reserved of opts?.reservedNames ?? []) {
    used.add(String(reserved).toLowerCase());
  }
  const allEntries = opts?.entries ?? resolveWorkspaceSkillEntries(workspaceDir);
  const policy = opts?.config?.skills?.policy;
  const override =
    (opts?.agentId ? policy?.agentOverrides?.[opts.agentId] : undefined) ?? undefined;
  const effectivePolicySkills = policy
    ? Array.from(
        new Set([
          ...(policy.globalEnabled ?? []).filter(
            (name) => !(override?.disabled ?? []).includes(name),
          ),
          ...(override?.enabled ?? []),
        ]),
      )
    : undefined;
  const entries = opts?.skipFiltering
    ? allEntries
    : allEntries.filter((entry) => {
        if (
          opts?.skillFilter !== undefined &&
          !opts.skillFilter.some((skillName) => skillName === entry.skill.name)
        ) {
          return false;
        }
        if (
          effectivePolicySkills &&
          !effectivePolicySkills.includes(entry.metadata?.skillKey ?? entry.skill.name)
        ) {
          return false;
        }
        return true;
      });

  return entries.map((entry) => {
    const base = entry.skill.name.replace(/[^a-z0-9_]+/gi, "_").toLowerCase();
    const name = resolveUniqueSkillCommandName(base, used);
    return {
      name,
      skillName: entry.skill.name,
      description: entry.description,
      sourceFilePath: entry.skill.filePath,
    };
  });
}

function loadWorkspaceSkillEntries(workspaceDir: string) {
  return resolveWorkspaceSkillEntries(workspaceDir);
}

function installSkillCommandTestMocks(registerMock: SkillCommandMockRegistrar) {
  // Avoid importing the full chat command registry for reserved-name calculation.
  registerMock("./commands-registry.js", () => ({
    listChatCommands: () => [],
  }));

  registerMock("../infra/skills-remote.js", () => ({
    getRemoteSkillEligibility: () => ({}),
  }));

  // Avoid filesystem-driven skill scanning for these unit tests; we only need command naming semantics.
  registerMock("../agents/skills.js", () => ({
    buildWorkspaceSkillCommandSpecs,
    loadWorkspaceSkillEntries,
  }));
}

const registerDynamicSkillCommandMock: SkillCommandMockRegistrar = (modulePath, factory) => {
  vi.doMock(modulePath, factory as Parameters<typeof vi.doMock>[1]);
};

async function loadFreshSkillCommandsModuleForTest() {
  vi.resetModules();
  installSkillCommandTestMocks(registerDynamicSkillCommandMock);
  ({
    listSkillCommandsForAgents,
    resolveSkillCommandInvocation,
    __testing: skillCommandsTesting,
  } = await import("./skill-commands.js"));
}

beforeEach(async () => {
  await loadFreshSkillCommandsModuleForTest();
});

describe("resolveSkillCommandInvocation", () => {
  it("matches skill commands and parses args", () => {
    const invocation = resolveSkillCommandInvocation({
      commandBodyNormalized: "/demo_skill do the thing",
      skillCommands: [{ name: "demo_skill", skillName: "demo-skill", description: "Demo" }],
    });
    expect(invocation?.command.skillName).toBe("demo-skill");
    expect(invocation?.args).toBe("do the thing");
  });

  it("supports /skill with name argument", () => {
    const invocation = resolveSkillCommandInvocation({
      commandBodyNormalized: "/skill demo_skill do the thing",
      skillCommands: [{ name: "demo_skill", skillName: "demo-skill", description: "Demo" }],
    });
    expect(invocation?.command.name).toBe("demo_skill");
    expect(invocation?.args).toBe("do the thing");
  });

  it("normalizes /skill lookup names", () => {
    const invocation = resolveSkillCommandInvocation({
      commandBodyNormalized: "/skill demo-skill",
      skillCommands: [{ name: "demo_skill", skillName: "demo-skill", description: "Demo" }],
    });
    expect(invocation?.command.name).toBe("demo_skill");
    expect(invocation?.args).toBeUndefined();
  });

  it("returns null for unknown commands", () => {
    const invocation = resolveSkillCommandInvocation({
      commandBodyNormalized: "/unknown arg",
      skillCommands: [{ name: "demo_skill", skillName: "demo-skill", description: "Demo" }],
    });
    expect(invocation).toBeNull();
  });
});

describe("listSkillCommandsForAgents", () => {
  const tempDirs: string[] = [];
  const makeTempDir = async (prefix: string) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  };
  afterAll(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("deduplicates by skillName across agents, keeping the first registration", async () => {
    const baseDir = await makeTempDir("openclaw-skills-");
    const mainWorkspace = path.join(baseDir, "main");
    const researchWorkspace = path.join(baseDir, "research");
    await fs.mkdir(mainWorkspace, { recursive: true });
    await fs.mkdir(researchWorkspace, { recursive: true });

    const commands = listSkillCommandsForAgents({
      cfg: {
        agents: {
          list: [
            { id: "main", workspace: mainWorkspace },
            { id: "research", workspace: researchWorkspace },
          ],
        },
      },
    });
    const names = commands.map((entry) => entry.name);
    expect(names).toContain("demo_skill");
    expect(names).not.toContain("demo_skill_2");
    expect(names).toContain("extra_skill");
  });

  it("scopes to specific agents when agentIds is provided", async () => {
    const baseDir = await makeTempDir("openclaw-skills-filter-");
    const researchWorkspace = path.join(baseDir, "research");
    await fs.mkdir(researchWorkspace, { recursive: true });

    const commands = listSkillCommandsForAgents({
      cfg: {
        agents: {
          list: [{ id: "research", workspace: researchWorkspace, skills: ["extra-skill"] }],
        },
      },
      agentIds: ["research"],
    });

    expect(commands.map((entry) => entry.name)).toEqual(["extra_skill"]);
    expect(commands.map((entry) => entry.skillName)).toEqual(["extra-skill"]);
  });

  it("prevents cross-agent skill leakage when each agent has an allowlist", async () => {
    const baseDir = await makeTempDir("openclaw-skills-leak-");
    const mainWorkspace = path.join(baseDir, "main");
    const researchWorkspace = path.join(baseDir, "research");
    await fs.mkdir(mainWorkspace, { recursive: true });
    await fs.mkdir(researchWorkspace, { recursive: true });

    const commands = listSkillCommandsForAgents({
      cfg: {
        agents: {
          list: [
            { id: "main", workspace: mainWorkspace, skills: ["demo-skill"] },
            { id: "research", workspace: researchWorkspace, skills: ["extra-skill"] },
          ],
        },
      },
      agentIds: ["main", "research"],
    });

    expect(commands.map((entry) => entry.skillName)).toEqual(["demo-skill", "extra-skill"]);
    expect(commands.map((entry) => entry.name)).toEqual(["demo_skill", "extra_skill"]);
  });

  it("merges allowlists for agents that share one workspace", async () => {
    const baseDir = await makeTempDir("openclaw-skills-shared-");
    const sharedWorkspace = path.join(baseDir, "research");
    await fs.mkdir(sharedWorkspace, { recursive: true });

    const commands = listSkillCommandsForAgents({
      cfg: {
        agents: {
          list: [
            { id: "main", workspace: sharedWorkspace, skills: ["demo-skill"] },
            { id: "research", workspace: sharedWorkspace, skills: ["extra-skill"] },
          ],
        },
      },
      agentIds: ["main", "research"],
    });

    expect(commands.map((entry) => entry.skillName)).toEqual(["demo-skill", "extra-skill"]);
    expect(commands.map((entry) => entry.name)).toEqual(["demo_skill", "extra_skill"]);
  });

  it("deduplicates overlapping allowlists for shared workspace", async () => {
    const baseDir = await makeTempDir("openclaw-skills-overlap-");
    const sharedWorkspace = path.join(baseDir, "research");
    await fs.mkdir(sharedWorkspace, { recursive: true });

    const commands = listSkillCommandsForAgents({
      cfg: {
        agents: {
          list: [
            { id: "agent-a", workspace: sharedWorkspace, skills: ["extra-skill"] },
            { id: "agent-b", workspace: sharedWorkspace, skills: ["extra-skill", "demo-skill"] },
          ],
        },
      },
      agentIds: ["agent-a", "agent-b"],
    });

    // Both agents allowlist "extra-skill"; it should appear once, not twice.
    expect(commands.map((entry) => entry.skillName)).toEqual(["demo-skill", "extra-skill"]);
    expect(commands.map((entry) => entry.name)).toEqual(["demo_skill", "extra_skill"]);
  });

  it("keeps workspace unrestricted when one co-tenant agent has no skills filter", async () => {
    const baseDir = await makeTempDir("openclaw-skills-unfiltered-");
    const sharedWorkspace = path.join(baseDir, "research");
    await fs.mkdir(sharedWorkspace, { recursive: true });

    const commands = listSkillCommandsForAgents({
      cfg: {
        agents: {
          list: [
            { id: "restricted", workspace: sharedWorkspace, skills: ["extra-skill"] },
            { id: "unrestricted", workspace: sharedWorkspace },
          ],
        },
      },
      agentIds: ["restricted", "unrestricted"],
    });

    const skillNames = commands.map((entry) => entry.skillName);
    expect(skillNames).toContain("demo-skill");
    expect(skillNames).toContain("extra-skill");
  });

  it("merges empty allowlist with non-empty allowlist for shared workspace", async () => {
    const baseDir = await makeTempDir("openclaw-skills-empty-");
    const sharedWorkspace = path.join(baseDir, "research");
    await fs.mkdir(sharedWorkspace, { recursive: true });

    const commands = listSkillCommandsForAgents({
      cfg: {
        agents: {
          list: [
            { id: "locked", workspace: sharedWorkspace, skills: [] },
            { id: "partial", workspace: sharedWorkspace, skills: ["extra-skill"] },
          ],
        },
      },
      agentIds: ["locked", "partial"],
    });

    expect(commands.map((entry) => entry.skillName)).toEqual(["extra-skill"]);
  });

  it("does not leak policy-hidden skills when agents share one workspace", async () => {
    const baseDir = await makeTempDir("openclaw-skills-policy-");
    const sharedWorkspace = path.join(baseDir, "shared-policy");
    await fs.mkdir(sharedWorkspace, { recursive: true });

    const commands = listSkillCommandsForAgents({
      cfg: {
        agents: {
          list: [
            { id: "alpha", workspace: sharedWorkspace },
            { id: "beta", workspace: sharedWorkspace },
          ],
        },
        skills: {
          policy: {
            globalEnabled: ["alpha-skill", "beta-skill", "hidden-skill"],
            agentOverrides: {
              alpha: { disabled: ["beta-skill", "hidden-skill"] },
              beta: { disabled: ["alpha-skill", "hidden-skill"] },
            },
          },
        },
      },
      agentIds: ["alpha", "beta"],
    });

    expect(commands.map((entry) => entry.skillName)).toEqual(["alpha-skill", "beta-skill"]);
  });

  it("keeps hidden same-name skills out of merged shared-workspace commands", async () => {
    const baseDir = await makeTempDir("openclaw-skills-policy-keys-");
    const sharedWorkspace = path.join(baseDir, "shared-policy-keys");
    await fs.mkdir(sharedWorkspace, { recursive: true });

    const commands = listSkillCommandsForAgents({
      cfg: {
        agents: {
          list: [
            { id: "alpha", workspace: sharedWorkspace },
            { id: "beta", workspace: sharedWorkspace },
          ],
        },
        skills: {
          policy: {
            globalEnabled: ["shared-hidden", "shared-visible"],
            agentOverrides: {
              alpha: { disabled: ["shared-hidden"] },
              beta: { disabled: ["shared-hidden"] },
            },
          },
        },
      },
      agentIds: ["alpha", "beta"],
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]?.skillName).toBe("shared-skill");
    expect(commands[0]?.description).toBe("Visible shared skill");
  });

  it("does not suffix visible commands because of policy-hidden alias collisions", async () => {
    const baseDir = await makeTempDir("openclaw-skills-policy-alias-");
    const sharedWorkspace = path.join(baseDir, "shared-policy-alias");
    await fs.mkdir(sharedWorkspace, { recursive: true });

    const commands = listSkillCommandsForAgents({
      cfg: {
        agents: {
          list: [
            { id: "alpha", workspace: sharedWorkspace },
            { id: "beta", workspace: sharedWorkspace },
          ],
        },
        skills: {
          policy: {
            globalEnabled: ["alpha-skill", "alpha.skill"],
            agentOverrides: {
              alpha: { disabled: ["alpha.skill"] },
              beta: { disabled: ["alpha.skill"] },
            },
          },
        },
      },
      agentIds: ["alpha", "beta"],
    });

    expect(commands.map((entry) => entry.skillName)).toEqual(["alpha-skill"]);
    expect(commands.map((entry) => entry.name)).toEqual(["alpha_skill"]);
  });

  it("skips agents with missing workspaces gracefully", async () => {
    const baseDir = await makeTempDir("openclaw-skills-missing-");
    const validWorkspace = path.join(baseDir, "research");
    const missingWorkspace = path.join(baseDir, "nonexistent");
    await fs.mkdir(validWorkspace, { recursive: true });

    const commands = listSkillCommandsForAgents({
      cfg: {
        agents: {
          list: [
            { id: "valid", workspace: validWorkspace },
            { id: "broken", workspace: missingWorkspace },
          ],
        },
      },
      agentIds: ["valid", "broken"],
    });

    // The valid agent's skills should still be listed despite the broken one.
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.map((entry) => entry.skillName)).toContain("demo-skill");
  });
});

describe("dedupeBySkillName", () => {
  it("keeps the first entry when multiple commands share a skillName", () => {
    const input = [
      { name: "github", skillName: "github", description: "GitHub" },
      { name: "github_2", skillName: "github", description: "GitHub" },
      { name: "weather", skillName: "weather", description: "Weather" },
      { name: "weather_2", skillName: "weather", description: "Weather" },
    ];
    const output = skillCommandsTesting.dedupeBySkillName(input);
    expect(output.map((e) => e.name)).toEqual(["github", "weather"]);
  });

  it("matches skillName case-insensitively", () => {
    const input = [
      { name: "ClawHub", skillName: "ClawHub", description: "ClawHub" },
      { name: "clawhub_2", skillName: "clawhub", description: "ClawHub" },
    ];
    const output = skillCommandsTesting.dedupeBySkillName(input);
    expect(output).toHaveLength(1);
    expect(output[0]?.name).toBe("ClawHub");
  });

  it("passes through commands with an empty skillName", () => {
    const input = [
      { name: "a", skillName: "", description: "A" },
      { name: "b", skillName: "", description: "B" },
    ];
    expect(skillCommandsTesting.dedupeBySkillName(input)).toHaveLength(2);
  });

  it("returns an empty array for empty input", () => {
    expect(skillCommandsTesting.dedupeBySkillName([])).toEqual([]);
  });
});
