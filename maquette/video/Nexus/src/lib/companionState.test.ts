import { describe, expect, it } from "vitest";
import { characterState, diffStats, parseUnifiedDiff, type CharInput } from "./companionState";

const base: CharInput = { status: "IDLE", stopped: false, pendingApprovals: 0, freshOutcome: null, listening: false };

describe("characterState", () => {
  it("mirrors execution states", () => {
    expect(characterState(base)).toBe("IDLE");
    expect(characterState({ ...base, status: "THINKING" })).toBe("THINKING");
    expect(characterState({ ...base, status: "PLANNING" })).toBe("PLANNING");
    expect(characterState({ ...base, status: "EXECUTING" })).toBe("EXECUTING");
    expect(characterState({ ...base, status: "VERIFYING" })).toBe("EXECUTING");
    expect(characterState({ ...base, status: "ERROR" })).toBe("ERROR");
  });

  it("never shows success unless the backend verdict is success", () => {
    expect(characterState({ ...base, status: "COMPLETED" })).toBe("IDLE");
    expect(characterState({ ...base, status: "COMPLETED", freshOutcome: "warnings" })).toBe("ERROR");
    expect(characterState({ ...base, status: "COMPLETED", freshOutcome: "answered" })).toBe("IDLE");
    expect(characterState({ ...base, status: "COMPLETED", freshOutcome: "success" })).toBe("SUCCESS");
    // An outcome never overrides a live run.
    expect(characterState({ ...base, status: "EXECUTING", freshOutcome: "success" })).toBe("EXECUTING");
  });

  it("prioritises stop and pending approvals", () => {
    expect(characterState({ ...base, status: "EXECUTING", stopped: true })).toBe("STOPPED");
    expect(characterState({ ...base, status: "EXECUTING", pendingApprovals: 1 })).toBe("WAITING_PERMISSION");
    expect(characterState({ ...base, listening: true })).toBe("LISTENING");
  });
});

describe("parseUnifiedDiff", () => {
  it("classifies lines from a real unified diff", () => {
    const d = "--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n one\n-two\n+2\n three\n";
    const l = parseUnifiedDiff(d);
    expect(l.map((x) => x.kind)).toEqual(["meta", "meta", "hunk", "ctx", "del", "add", "ctx"]);
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 });
  });
});
