// Multi-stage approval workflow pure logic (Creator → Editor → Brand Manager → Client).
// Stage index semantics:
//   0         = awaiting Creator's sign-off
//   1         = awaiting Editor
//   2         = awaiting Brand Manager
//   3         = awaiting Client
//   stage N+1 = all N stages approved → the post is fully approved.
// Each transition appends an entry to the item's approval log (history + comments).

export const APPROVAL_STAGES = [
  "Creator",
  "Editor",
  "Brand Manager",
  "Client",
] as const
export type ApprovalStage = typeof APPROVAL_STAGES[number]

export type ApprovalAction = "approved" | "rejected" | "resubmitted" | "commented"

export interface ApprovalLogEntry {
  id: number
  stage: ApprovalStage
  action: ApprovalAction
  by: string
  at: string
  note?: string
}

export interface ApprovalState {
  stage: number
  log: ApprovalLogEntry[]
}

let seq = 1
const nextId = () => Date.now() * 100 + (seq++ % 100)

export function approvalStageLabel(stage: number): ApprovalStage {
  return APPROVAL_STAGES[
    Math.min(Math.max(stage, 0), APPROVAL_STAGES.length - 1)
  ]
}

export function isFullyApproved(stage: number): boolean {
  return stage >= APPROVAL_STAGES.length
}

/** Advance one stage. Returns the new state and whether the post is now fully approved. */
export function approve(
  state: ApprovalState | undefined,
  by: string,
  note?: string,
): { state: ApprovalState; done: boolean } {
  const cur = state ?? { stage: 0, log: [] }
  const done = isFullyApproved(cur.stage)
  if (done) return { state: cur, done: true }
  const entry: ApprovalLogEntry = {
    id: nextId(),
    stage: approvalStageLabel(cur.stage),
    action: "approved",
    by,
    at: new Date().toISOString(),
    note,
  }
  return {
    state: { stage: cur.stage + 1, log: [...cur.log, entry] },
    done: isFullyApproved(cur.stage + 1),
  }
}

/** Reject at the current stage — sends the post back to Draft and resets the flow. */
export function reject(
  state: ApprovalState | undefined,
  by: string,
  note?: string,
): ApprovalState {
  const cur = state ?? { stage: 0, log: [] }
  const entry: ApprovalLogEntry = {
    id: nextId(),
    stage: approvalStageLabel(cur.stage),
    action: "rejected",
    by,
    at: new Date().toISOString(),
    note,
  }
  return { stage: 0, log: [...cur.log, entry] }
}

/** Resubmit a rejected post for review — restarts at the Creator stage. */
export function resubmit(
  state: ApprovalState | undefined,
  by: string,
): ApprovalState {
  const cur = state ?? { stage: 0, log: [] }
  const entry: ApprovalLogEntry = {
    id: nextId(),
    stage: approvalStageLabel(cur.stage),
    action: "resubmitted",
    by,
    at: new Date().toISOString(),
  }
  return { stage: 0, log: [...cur.log, entry] }
}

/** Append a comment at the current stage. */
export function comment(
  state: ApprovalState | undefined,
  by: string,
  text: string,
): ApprovalState {
  const cur = state ?? { stage: 0, log: [] }
  const entry: ApprovalLogEntry = {
    id: nextId(),
    stage: approvalStageLabel(cur.stage),
    action: "commented",
    by,
    at: new Date().toISOString(),
    note: text,
  }
  return { stage: cur.stage, log: [...cur.log, entry] }
}
