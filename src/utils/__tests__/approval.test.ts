import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  APPROVAL_STAGES,
  approve,
  reject,
  resubmit,
  comment,
  approvalStageLabel,
  isFullyApproved,
} from "../approval"

beforeEach(() => {
  vi.useRealTimers()
})

describe("approvalStageLabel", () => {
  it("maps stage indices to chain steps", () => {
    expect(approvalStageLabel(0)).toBe("Creator")
    expect(approvalStageLabel(1)).toBe("Editor")
    expect(approvalStageLabel(2)).toBe("Brand Manager")
    expect(approvalStageLabel(3)).toBe("Client")
  })

  it("clamps out-of-range indices", () => {
    expect(approvalStageLabel(-1)).toBe("Creator")
    expect(approvalStageLabel(99)).toBe("Client")
  })

  it("exposes the full chain", () => {
    expect(APPROVAL_STAGES).toEqual([
      "Creator",
      "Editor",
      "Brand Manager",
      "Client",
    ])
  })
})

describe("approve", () => {
  it("starts an item without state at the Creator stage", () => {
    const r = approve(undefined, "Alice")
    expect(r.state.stage).toBe(1)
    expect(r.done).toBe(false)
    expect(r.state.log).toHaveLength(1)
    expect(r.state.log[0]).toMatchObject({
      stage: "Creator",
      action: "approved",
      by: "Alice",
    })
  })

  it("advances one stage per call and records who approved", () => {
    const s1 = approve(undefined, "Alice").state
    const s2 = approve(s1, "Bob").state
    expect(s2.stage).toBe(2)
    expect(s2.log.map((l) => l.stage)).toEqual(["Creator", "Editor"])
    expect(s2.log.map((l) => l.by)).toEqual(["Alice", "Bob"])
  })

  it("marks the post fully approved after the final stage", () => {
    let state = approve(undefined, "Alice").state
    state = approve(state, "Bob").state
    state = approve(state, "Carol").state
    expect(state.stage).toBe(3)
    const r = approve(state, "Dave")
    expect(r.done).toBe(true)
    expect(r.state.stage).toBe(4)
    expect(isFullyApproved(r.state.stage)).toBe(true)
  })

  it("is a no-op once fully approved", () => {
    let state = { stage: 4, log: [] }
    const r = approve(state, "Alice")
    expect(r.done).toBe(true)
    expect(state.log).toHaveLength(0)
  })
})

describe("reject", () => {
  it("resets the stage to 0 and logs the rejection with a note", () => {
    const mid = approve(approve(undefined, "Alice").state, "Bob").state
    const r = reject(mid, "Manager", "Caption too long")
    expect(r.stage).toBe(0)
    expect(r.log).toHaveLength(3)
    expect(r.log[r.log.length - 1]).toMatchObject({
      stage: "Brand Manager",
      action: "rejected",
      by: "Manager",
      note: "Caption too long",
    })
  })
})

describe("resubmit", () => {
  it("restarts at Creator and appends a resubmitted entry", () => {
    const r = resubmit(undefined, "Creator")
    expect(r.stage).toBe(0)
    expect(r.log).toHaveLength(1)
    expect(r.log[0]).toMatchObject({ action: "resubmitted", by: "Creator" })
  })
})

describe("comment", () => {
  it("appends a comment without changing the stage", () => {
    const s = approve(undefined, "Alice").state
    const c = comment(s, "Bob", "Needs more emojis")
    expect(c.stage).toBe(1)
    expect(c.log).toHaveLength(2)
    expect(c.log[1]).toMatchObject({
      stage: "Editor",
      action: "commented",
      by: "Bob",
      note: "Needs more emojis",
    })
  })
})
