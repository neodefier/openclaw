import { beforeEach, describe, expect, it, vi } from "vitest";

const buildWorkspaceSkillSnapshotMock = vi.fn();
const getSkillsSnapshotVersionMock = vi.fn();
const resolveAgentSkillsFilterMock = vi.fn();
const resolveSkillPolicySnapshotMock = vi.fn();
const getRemoteSkillEligibilityMock = vi.fn();

vi.mock("../../agents/skills.js", () => ({
  buildWorkspaceSkillSnapshot: buildWorkspaceSkillSnapshotMock,
}));

vi.mock("../../agents/skills/refresh.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/skills/refresh.js")>(
    "../../agents/skills/refresh.js",
  );
  return {
    ...actual,
    getSkillsSnapshotVersion: getSkillsSnapshotVersionMock,
  };
});

vi.mock("../../agents/agent-scope.js", () => ({
  resolveAgentSkillsFilter: resolveAgentSkillsFilterMock,
}));

vi.mock("../../agents/skills/policy.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/skills/policy.js")>(
    "../../agents/skills/policy.js",
  );
  return {
    ...actual,
    resolveSkillPolicySnapshot: resolveSkillPolicySnapshotMock,
  };
});

vi.mock("../../infra/skills-remote.js", () => ({
  getRemoteSkillEligibility: getRemoteSkillEligibilityMock,
}));

const { resolveCronSkillsSnapshot } = await import("./skills-snapshot.js");

describe("resolveCronSkillsSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSkillsSnapshotVersionMock.mockReturnValue(0);
    resolveAgentSkillsFilterMock.mockReturnValue(undefined);
    resolveSkillPolicySnapshotMock.mockReturnValue(undefined);
    getRemoteSkillEligibilityMock.mockReturnValue({
      platforms: [],
      hasBin: () => false,
      hasAnyBin: () => false,
    });
    buildWorkspaceSkillSnapshotMock.mockReturnValue({ prompt: "fresh", skills: [] });
  });

  it("refreshes when the cached policy snapshot changes", () => {
    resolveSkillPolicySnapshotMock.mockReturnValue({
      agentId: "writer",
      globalEnabled: ["github"],
      agentEnabled: ["docs-search"],
      agentDisabled: [],
      effective: ["docs-search", "github"],
    });

    const result = resolveCronSkillsSnapshot({
      workspaceDir: "/tmp/workspace",
      config: {} as never,
      agentId: "writer",
      existingSnapshot: {
        prompt: "old",
        skills: [{ name: "github" }],
        policy: {
          agentId: "writer",
          globalEnabled: ["github"],
          agentEnabled: [],
          agentDisabled: [],
          effective: ["github"],
        },
        version: 0,
      },
      isFastTestEnv: false,
    });

    expect(buildWorkspaceSkillSnapshotMock).toHaveBeenCalledOnce();
    expect(buildWorkspaceSkillSnapshotMock.mock.calls[0]?.[1]).toMatchObject({
      agentId: "writer",
      snapshotVersion: 0,
    });
    expect(result).toEqual({ prompt: "fresh", skills: [] });
  });

  it("refreshes when the process version resets to 0 but the cached snapshot is stale", () => {
    getSkillsSnapshotVersionMock.mockReturnValue(0);

    resolveCronSkillsSnapshot({
      workspaceDir: "/tmp/workspace",
      config: {} as never,
      agentId: "writer",
      existingSnapshot: {
        prompt: "old",
        skills: [{ name: "github" }],
        version: 42,
      },
      isFastTestEnv: false,
    });

    expect(buildWorkspaceSkillSnapshotMock).toHaveBeenCalledOnce();
  });
});
